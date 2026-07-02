/**
 * reset-test-env.mjs
 *
 * Archives every Slack channel tracked in the DB, then wipes all DB tables.
 * Safe to run in a test workspace. DESTRUCTIVE — do not run in production.
 *
 * Usage:
 *   node scripts/reset-test-env.mjs
 *   node scripts/reset-test-env.mjs --dry-run   (lists channels, touches nothing)
 */

import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import Database from 'better-sqlite3';

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH = process.env.DB_PATH ?? './launchbot.db';

// The bot token is only injected by `slack run`. If it's missing, check the
// .slack/apps.dev.json for the token or export it manually before running.
if (!process.env.SLACK_BOT_TOKEN) {
  console.error('❌ SLACK_BOT_TOKEN is not set.');
  console.error('   Either run this while `slack run` is active in another terminal,');
  console.error('   or export it first:');
  console.error('   export SLACK_BOT_TOKEN=xoxb-...');
  console.error('   node scripts/reset-test-env.mjs');
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const db = new Database(DB_PATH);

// ─── Collect every channel ID the bot has ever created ───────────────────────

const mainChannelIds = db
  .prepare('SELECT channel_id FROM launches')
  .all()
  .map(r => r.channel_id);

const subChannelIds = db
  .prepare('SELECT channel_id FROM stakeholder_channels')
  .all()
  .map(r => r.channel_id);

const allIds = [...new Set([...mainChannelIds, ...subChannelIds])];

console.log(`\nFound ${allIds.length} channel(s) to archive.`);
if (DRY_RUN) {
  console.log('DRY RUN — no changes will be made.\n');
}

// ─── Archive each channel ─────────────────────────────────────────────────────

let archived = 0;
let skipped = 0;

for (const channelId of allIds) {
  try {
    // Resolve name for logging
    const info = await client.conversations.info({ channel: channelId }).catch(() => null);
    const name = info?.channel?.name ?? channelId;
    const alreadyArchived = info?.channel?.is_archived ?? false;

    if (alreadyArchived) {
      console.log(`  ⏭  #${name} already archived — skipping`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  📋 would archive #${name} (${channelId})`);
      continue;
    }

    await client.conversations.archive({ channel: channelId });
    console.log(`  ✅ archived #${name} (${channelId})`);
    archived++;

    // Small delay to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 300));

  } catch (err) {
    const code = err?.data?.error ?? err.message;
    // already_archived is fine; cant_archive_general etc. are logged as warnings
    if (code === 'already_archived') {
      console.log(`  ⏭  ${channelId} already archived`);
      skipped++;
    } else {
      console.warn(`  ⚠️  ${channelId} — ${code}`);
      skipped++;
    }
  }
}

// ─── Wipe all DB tables ───────────────────────────────────────────────────────

const TABLES = [
  'gonogo_overrides',
  'gonogo_responses',
  'notified_deadlines',
  'slip_events',
  'feedback',
  'kpis',
  'comms_log',
  'budget_items',
  'cs_readiness_items',
  'risk_items',
  'content_reviews',
  'items',
  'stakeholder_channels',
  'team_rosters',
  'launches',
];

if (DRY_RUN) {
  console.log(`\nDRY RUN — would delete all rows from: ${TABLES.join(', ')}`);
} else {
  db.pragma('foreign_keys = OFF');
  const clearAll = db.transaction(() => {
    for (const table of TABLES) {
      const count = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n;
      db.prepare(`DELETE FROM ${table}`).run();
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
      console.log(`  🗑  ${table}: cleared ${count} row(s)`);
    }
  });
  clearAll();
  db.pragma('foreign_keys = ON');
  console.log('\n✅ Database wiped and auto-increment counters reset.');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Channels archived : ${archived}
  Channels skipped  : ${skipped}
  DB tables cleared : ${DRY_RUN ? '(dry run)' : TABLES.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${DRY_RUN ? 'Re-run without --dry-run to apply changes.' : 'Test environment is clean. Ready for a fresh run.'}
`);
