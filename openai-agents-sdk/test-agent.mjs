// test-agent.mjs
// Smoke-tests the agent by sending three requests and printing what it does.
// No live Slack token required — uses a mock client that captures postMessage calls.
// Usage: node test-agent.mjs
import 'dotenv/config';

// Stub required env vars before config.js loads (agent.js imports it transitively)
process.env.SLACK_BOT_TOKEN  = process.env.SLACK_BOT_TOKEN  || 'xoxb-test-stub';
process.env.SLACK_APP_TOKEN  = process.env.SLACK_APP_TOKEN  || 'xapp-test-stub';

import { runAgent } from './agent/agent.js';
import { AgentDeps } from './agent/deps.js';

// ─── Mock Slack client ────────────────────────────────────────────────────────
// Captures postMessage calls so we can inspect what the agent actually posted.
function makeMockClient() {
  const posted = [];
  return {
    posted,
    chat: {
      postMessage: async (msg) => {
        posted.push(msg);
        console.log('  📤 chat.postMessage →', msg.channel, '|', msg.text ?? '(blocks only)');
        return { ok: true, ts: `${Date.now()}` };
      },
      update: async (msg) => {
        console.log('  📝 chat.update →', msg.channel, msg.ts);
        return { ok: true };
      },
    },
    reactions: {
      add: async ({ name }) => {
        console.log(`  ${name ? `👍 reaction :${name}:` : '(no reaction)'}`);
        return { ok: true };
      },
    },
    conversations: {
      info: async ({ channel }) => {
        // Return a plausible channel object so resolveLaunchForDeps doesn't blow up
        return { ok: true, channel: { id: channel, name: channel } };
      },
    },
  };
}

const sep = (label) => console.log(`\n${'─'.repeat(64)}\n▶  ${label}\n${'─'.repeat(64)}`);

// Real channel from test-features.mjs — launch 1 lives here
const LAUNCH_CHANNEL = 'C0BE69HCV2M';
const PM_USER        = 'U0BDY7NPU4D';

// ─── Test 1: get_launch_status ────────────────────────────────────────────────
sep('TEST 1 — get_launch_status: "what is the status of Feature S1?"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '1', '1');

  const result = await runAgent("what is the status of Feature S1?", deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 2: get_launch_report ────────────────────────────────────────────────
sep('TEST 2 — get_launch_report: "give me the full status report for this launch"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '2', '2');

  const result = await runAgent("give me the full status report for this launch", deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
  if (client.posted.length > 0) {
    console.log('  First post blocks count:', client.posted[0].blocks?.length ?? 0);
  }
}

// ─── Test 3: get_launch_portfolio ────────────────────────────────────────────
sep('TEST 3 — get_launch_portfolio: "how are all my launches doing?"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '3', '3');

  const result = await runAgent("how are all my launches doing?", deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 4: manage_kpi set ───────────────────────────────────────────────────
sep('TEST 4 — manage_kpi: "track activation rate for this launch, target 60%"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '4', '4');

  const result = await runAgent('track activation rate for this launch, target 60%', deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log('All tests complete. Check tool calls logged above.');
