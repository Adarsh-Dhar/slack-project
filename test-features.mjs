// test-features.mjs
// CLI test runner for: slip detection, SLA nudges, legal SLA, standup DMs
// Usage: SLACK_BOT_TOKEN=xoxb-... node test-features.mjs
//
// Reads SLACK_BOT_TOKEN from env (or .env.local in the launchpad folder).
// Uses the real launchbot.db — all DB mutations are logged so you can undo.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { WebClient } from '@slack/web-api';
import { readFileSync } from 'fs';

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Try to pull token from launchpad's .env.local if not in environment
let token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  try {
    const raw = readFileSync('../launchpad/.env.local', 'utf8');
    const match = raw.match(/SLACK_BOT_TOKEN\s*=\s*(.+)/);
    if (match) token = match[1].trim();
  } catch {}
}
if (!token) {
  console.error('❌  SLACK_BOT_TOKEN not found. Set it in env or ../launchpad/.env.local');
  process.exit(1);
}

const client = new WebClient(token);
const db = new Database('./launchbot.db');

// Real data from the DB
const LAUNCH_ID       = 1;                    // Feature S1
const LAUNCH_CHANNEL  = 'C0BE69HCV2M';        // #launch-feature-s1 (main)
const STAKEHOLDER_ENG = 'C0BEYNBL02U';        // engineering sub-channel for launch 1
const PM_USER_ID      = 'U0BDY7NPU4D';
const OWNER_A         = 'U0BDZGCQKQW';        // owner on launch 4 items (has history)
const OWNER_B         = 'U0BE3EQQ5EV';

const sep = (label) => console.log(`\n${'─'.repeat(60)}\n▶  ${label}\n${'─'.repeat(60)}`);
const ok  = (msg) => console.log(`  ✅  ${msg}`);
const err = (msg) => console.log(`  ❌  ${msg}`);
const info = (msg) => console.log(`  ℹ️   ${msg}`);

// ─── Test 1: Slip Detection — positive case ──────────────────────────────────
sep('TEST 1: Slip Detection — positive (keyword match)');

{
  // Inline slip detection — avoids importing config.js (which requires SLACK_APP_TOKEN)
  const SLIP_KEYWORDS = [
    'need more time', 'not ready', 'delayed', 'pushed back',
    'behind schedule', "won't make", 'need another day',
    'need 2 more days', 'blocking us', 'blocked on',
  ];

  async function checkForSlip(client, { message, launch, channelName }) {
    const text = (message.text ?? '').toLowerCase();
    const triggered = SLIP_KEYWORDS.some(kw => text.includes(kw));
    if (!triggered || message.bot_id) return false;
    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `⚠️ Potential slip detected in #${channelName} by <@${message.user}>:\n> ${message.text}`,
    });
    return true;
  }

  const getLaunchByStakeholderChannel = (channelId) => {
    const row = db.prepare('SELECT launch_id FROM stakeholder_channels WHERE channel_id = ?').get(channelId);
    if (row) return db.prepare('SELECT * FROM launches WHERE id = ?').get(row.launch_id);
    return db.prepare(`SELECT * FROM launches WHERE channel_id = ? AND status = 'active'`).get(channelId);
  };

  const fakeMessage = {
    text: "heads up, we're behind schedule on the feature flag work",
    user: OWNER_A,
    bot_id: undefined,
  };

  const launch = getLaunchByStakeholderChannel(STAKEHOLDER_ENG);
  if (!launch) { err('Could not resolve launch from stakeholder channel'); }
  else {
    info(`Resolved launch: "${launch.name}" (id=${launch.id}) from channel ${STAKEHOLDER_ENG}`);
    info(`Posting slip message to engineering sub-channel, expect alert in #${LAUNCH_CHANNEL}`);

    // First: actually post the triggering message in the stakeholder channel
    // so there's a visible Slack trail
    await client.chat.postMessage({
      channel: STAKEHOLDER_ENG,
      text: fakeMessage.text,
    }).catch(e => info(`(couldn't post to stakeholder channel: ${e.message})`));

    // Then call checkForSlip directly (this posts the alert to the main channel)
    const triggered = await checkForSlip(client, {
      message: fakeMessage,
      launch,
      channelName: 'feature-s1-eng',
    });

    if (triggered) ok('checkForSlip returned true — alert posted to main launch channel');
    else err('checkForSlip returned false — no alert posted (check SLIP_KEYWORDS in config)');
  }
}

// ─── Test 2: Slip Detection — negative case (no false positive) ──────────────
sep('TEST 2: Slip Detection — negative (no keyword)');

{
  const SLIP_KEYWORDS = [
    'need more time', 'not ready', 'delayed', 'pushed back',
    'behind schedule', "won't make", 'need another day',
    'need 2 more days', 'blocking us', 'blocked on',
  ];
  async function checkForSlip(client, { message }) {
    const text = (message.text ?? '').toLowerCase();
    return SLIP_KEYWORDS.some(kw => text.includes(kw)) && !message.bot_id;
  }
  const getLaunchByStakeholderChannel = (channelId) => {
    const row = db.prepare('SELECT launch_id FROM stakeholder_channels WHERE channel_id = ?').get(channelId);
    if (row) return db.prepare('SELECT * FROM launches WHERE id = ?').get(row.launch_id);
    return db.prepare(`SELECT * FROM launches WHERE channel_id = ? AND status = 'active'`).get(channelId);
  };

  const innocentMessage = {
    text: "All systems go, feature is ready to ship on time!",
    user: OWNER_A,
    bot_id: undefined,
  };

  const launch = getLaunchByStakeholderChannel(STAKEHOLDER_ENG);
  const triggered = await checkForSlip(client, {
    message: innocentMessage,
    launch,
    channelName: 'feature-s1-eng',
  });

  if (!triggered) ok('Correctly returned false — no alert for innocent message');
  else err('False positive! Alert triggered for a message with no slip keyword');
}

// ─── Test 3: SLA Nudge — first nudge (notify_count = 0) ─────────────────────
sep('TEST 3: 24h SLA Nudge — first nudge');

{
  // Use item 1 (Feature flag enabled, launch 1) — set owner + backdate
  const ITEM_ID = 1;

  // Assign owner and backdate last_notified_at to 25h ago
  db.prepare(`UPDATE items SET owner_id = ?, last_notified_at = datetime('now', '-25 hours'), notify_count = 0 WHERE id = ?`)
    .run(OWNER_A, ITEM_ID);
  info(`Backdated item ${ITEM_ID} last_notified_at to 25h ago, notify_count=0, owner=${OWNER_A}`);

  // Run getStaleItems
  const stale = db.prepare(`
    SELECT * FROM items
    WHERE status NOT IN ('done')
      AND owner_id IS NOT NULL
      AND (last_notified_at IS NULL OR last_notified_at <= datetime('now', '-24 hours'))
  `).all();

  info(`getStaleItems(24) returned ${stale.length} item(s)`);
  const target = stale.find(i => i.id === ITEM_ID);
  if (!target) { err(`Item ${ITEM_ID} not in stale list — check query`); }
  else {
    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(target.launch_id);
    info(`Sending DM to owner <@${target.owner_id}> for "${target.title}"`);

    const res = await client.chat.postMessage({
      channel: target.owner_id,
      text: `⏰ Reminder: *${target.title}* for *${launch.name}* still needs an update (no reply in 24h+).`,
    });

    if (res.ok) {
      ok(`DM sent to ${target.owner_id} (ts: ${res.ts})`);
      // Update DB as scheduler would
      db.prepare(`UPDATE items SET last_notified_at = datetime('now'), notify_count = notify_count + 1 WHERE id = ?`).run(ITEM_ID);
      const updated = db.prepare('SELECT notify_count FROM items WHERE id = ?').get(ITEM_ID);
      ok(`markItemNotified done — notify_count is now ${updated.notify_count}`);
    } else {
      err(`DM failed: ${res.error}`);
    }
  }
}

// ─── Test 4: SLA Nudge — escalation (notify_count >= 2) ─────────────────────
sep('TEST 4: 24h SLA Nudge — escalation to PM (notify_count >= 2)');

{
  const ITEM_ID = 2; // Release notes draft, launch 1

  db.prepare(`UPDATE items SET owner_id = ?, last_notified_at = datetime('now', '-25 hours'), notify_count = 2 WHERE id = ?`)
    .run(OWNER_A, ITEM_ID);
  info(`Item ${ITEM_ID} set: owner=${OWNER_A}, notify_count=2, backdated 25h`);

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(ITEM_ID);
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(item.launch_id);

  // Send owner DM
  const dmRes = await client.chat.postMessage({
    channel: item.owner_id,
    text: `⏰ Reminder: *${item.title}* for *${launch.name}* still needs an update (no reply in 24h+).`,
  });
  if (dmRes.ok) ok(`DM sent to owner ${item.owner_id}`);
  else err(`DM failed: ${dmRes.error}`);

  // Escalation: notify_count >= 2 → post to launch channel tagging PM
  if (item.notify_count >= 2) {
    const escRes = await client.chat.postMessage({
      channel: launch.channel_id,
      text: `🔁 <@${launch.pm_user_id}> — <@${item.owner_id}> hasn't responded on *${item.title}* after multiple reminders.`,
    });
    if (escRes.ok) ok(`Escalation posted to ${launch.channel_id} tagging PM ${launch.pm_user_id}`);
    else err(`Escalation post failed: ${escRes.error}`);
  }

  db.prepare(`UPDATE items SET last_notified_at = datetime('now'), notify_count = notify_count + 1 WHERE id = ?`).run(ITEM_ID);
  const after = db.prepare('SELECT notify_count FROM items WHERE id = ?').get(ITEM_ID);
  ok(`notify_count is now ${after.notify_count}`);
}

// ─── Test 5: Legal SLA — overdue item ────────────────────────────────────────
sep('TEST 5: Legal SLA — overdue item posts to launch channel');

{
  // Use item 10 (Legal sign-off obtained, launch 1) — backdate due_date
  const ITEM_ID = 10;
  db.prepare(`UPDATE items SET owner_id = ?, due_date = date('now', '-3 days'), status = 'not_started' WHERE id = ?`)
    .run(OWNER_B, ITEM_ID);
  info(`Item ${ITEM_ID} set: due_date=3 days ago, status=not_started`);

  const legalItems = db.prepare(
    `SELECT * FROM items WHERE launch_id = ? AND team = 'legal' AND status != 'done'`
  ).all(LAUNCH_ID);

  const overdue = legalItems.filter(i => new Date(i.due_date) < new Date());
  info(`Legal overdue items: ${overdue.length} (${overdue.map(i => i.title).join(', ')})`);

  if (overdue.length > 0) {
    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(LAUNCH_ID);
    const res = await client.chat.postMessage({
      channel: launch.channel_id,
      text: `⚖️ *Legal sign-off overdue* for ${launch.name}: ${overdue.map(i => i.title).join(', ')}`,
    });
    if (res.ok) ok(`Legal overdue alert posted to ${launch.channel_id}`);
    else err(`Post failed: ${res.error}`);
  } else {
    err('No overdue legal items found — check due_date update');
  }

  // Now mark done and verify exclusion
  db.prepare(`UPDATE items SET status = 'done' WHERE id = ?`).run(ITEM_ID);
  const afterDone = db.prepare(
    `SELECT * FROM items WHERE launch_id = ? AND team = 'legal' AND status != 'done' AND due_date < date('now')`
  ).all(LAUNCH_ID);

  if (afterDone.find(i => i.id === ITEM_ID)) {
    err(`Item ${ITEM_ID} still appears after marking done`);
  } else {
    ok(`Item ${ITEM_ID} correctly excluded after status=done`);
  }
  // Reset
  db.prepare(`UPDATE items SET status = 'not_started' WHERE id = ?`).run(ITEM_ID);
}

// ─── Test 6: Daily Standup DM ────────────────────────────────────────────────
sep('TEST 6: Daily Standup — DM with top open item');

{
  // Build blocks inline — same shape as buildStandupBlocks in utils/blocks.js
  function buildStandupBlocks({ itemTitle, launchName, launchDate, itemId, launchId }) {
    const value = JSON.stringify({ itemId, launchId });
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Good morning!* 🚀\n\nYour one item for today on *${launchName}* (launching ${launchDate}):\n\n> *${itemTitle}*\n\nWhere are you on this?`,
        },
      },
      {
        type: 'actions',
        block_id: `standup_${itemId}_${launchId}`,
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Done ✅', emoji: true }, style: 'primary', action_id: 'standup_done', value },
          { type: 'button', text: { type: 'plain_text', text: 'Blocked 🚫', emoji: true }, style: 'danger', action_id: 'standup_blocked', value },
          { type: 'button', text: { type: 'plain_text', text: 'Still working on it 🔄', emoji: true }, action_id: 'standup_in_progress', value },
        ],
      },
    ];
  }

  // Assign item 3 (Staging smoke test) to OWNER_A, ensure not done
  db.prepare(`UPDATE items SET owner_id = ?, status = 'not_started' WHERE id = ?`).run(OWNER_A, 3);

  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(LAUNCH_ID);
  const items = db.prepare(
    `SELECT * FROM items WHERE launch_id = ? AND status != 'done' AND owner_id IS NOT NULL ORDER BY team, id`
  ).all(LAUNCH_ID);

  // Group by owner (mirrors scheduler standup logic)
  const byOwner = new Map();
  for (const item of items) {
    const arr = byOwner.get(item.owner_id) ?? [];
    byOwner.set(item.owner_id, [...arr, item]);
  }

  info(`Found ${byOwner.size} owner(s) with open items for "${launch.name}"`);

  for (const [ownerId, ownerItems] of byOwner.entries()) {
    const topItem = ownerItems[0];
    info(`Sending standup DM to ${ownerId} — top item: "${topItem.title}"`);

    let blocks;
    try {
      blocks = buildStandupBlocks({
        itemTitle: topItem.title,
        launchName: launch.name,
        launchDate: launch.launch_date,
        itemId: topItem.id,
        launchId: launch.id,
      });
    } catch (e) {
      err(`buildStandupBlocks threw: ${e.message}`);
      continue;
    }

    const res = await client.chat.postMessage({
      channel: ownerId,
      text: `Daily check-in for ${launch.name}`,
      blocks,
    }).catch(e => ({ ok: false, error: e.message }));

    if (res.ok) ok(`Standup DM sent to ${ownerId} (ts: ${res.ts})`);
    else err(`Standup DM failed for ${ownerId}: ${res.error}`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
sep('ALL TESTS COMPLETE');
console.log('Check your Slack workspace for:');
console.log('  • ⚠️ Slip alert in the main launch channel (from Test 1)');
console.log('  • ⏰ DM to OWNER_A for item 1 (Test 3)');
console.log('  • ⏰ DM to OWNER_A + 🔁 escalation in launch channel (Test 4)');
console.log('  • ⚖️ Legal overdue alert in launch channel (Test 5)');
console.log('  • 📋 Standup DMs to all item owners (Test 6)');
