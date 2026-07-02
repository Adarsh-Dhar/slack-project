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

// ─── Test 5: create_launch with mentions (A1) ─────────────────────────────────
sep('TEST 5 — create_launch_confirmation: stakeholder mentions in payload');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '5', '5');

  const result = await runAgent(
    'kick off a launch called "Widget Pro" for 2026-09-01, minor tier, with <@U0BDY7NPU4D> as a stakeholder',
    deps
  );

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  if (client.posted.length > 0) {
    const payload = client.posted[0];
    const btnValue = payload.blocks?.find(b => b.type === 'actions')
      ?.elements?.[0]?.value;
    if (btnValue) {
      const parsed = JSON.parse(btnValue);
      console.log('  Button payload stakeholderUsers:', parsed.stakeholderUsers);
    }
  }
}

// ─── Test 6: manual phase override (A3) ──────────────────────────────────────
sep('TEST 6 — sync_phase_status: "set the phase to prelaunch"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '6', '6');

  const result = await runAgent('set the phase for this launch to prelaunch', deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 7: open_feedback_prompt (A2) ───────────────────────────────────────
sep('TEST 7 — open_feedback_prompt: "I want to leave feedback"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '7', '7');

  const result = await runAgent('I want to leave feedback on this launch', deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 8: manage_budget (B3) ──────────────────────────────────────────────
sep('TEST 8 — manage_budget: "set paid social budget to $5000"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '8', '8');

  const result = await runAgent('set the paid social ads budget to $5000 for this launch', deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
}

// ─── Test 9: manage_cs_readiness (B4) ────────────────────────────────────────
sep('TEST 9 — manage_cs_readiness: "mark support FAQ as in progress"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '9', '9');

  const result = await runAgent('mark the support FAQ doc as in progress for this launch', deps);

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
}

// ─── Test 10: trigger_comms_confirmation (B1) ────────────────────────────────
sep('TEST 10 — trigger_comms_confirmation: "send a social post"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '10', '10');

  const result = await runAgent(
    'send a social post saying "Feature S1 is now live! Check it out." for this launch',
    deps
  );

  const reply = result.finalOutput ?? '(no text reply)';
  console.log('\n  🤖 Agent reply:\n ', reply);
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 11: manage_risk (new #1) ───────────────────────────────────────────
sep('TEST 11 — manage_risk: "log a high technical risk: DB migration not tested"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '11', '11');

  const result = await runAgent(
    'log a high technical risk for this launch: DB migration not tested in staging',
    deps
  );
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
}

// ─── Test 12: get_slip_risk_status (new #4) ──────────────────────────────────
sep('TEST 12 — get_slip_risk_status: "any open slip alerts?"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '12', '12');

  const result = await runAgent('are there any open slip risk alerts for this launch?', deps);
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
}

// ─── Test 13: get_legal_status (new #8) ──────────────────────────────────────
sep('TEST 13 — get_legal_status: "what is the legal sign-off status?"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '13', '13');

  const result = await runAgent('what is the legal sign-off status for this launch?', deps);
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
}

// ─── Test 14: get_pr_status (new #9) ─────────────────────────────────────────
sep('TEST 14 — get_pr_status: "any open PRs?"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '14', '14');

  const result = await runAgent('are there any open PRs for this launch?', deps);
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
}

// ─── Test 15: manage_content_review submit (new #7) ──────────────────────────
sep('TEST 15 — manage_content_review: "submit marketing copy for review"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '15', '15');

  const result = await runAgent(
    'submit marketing copy for review, the draft is at https://docs.example.com/draft',
    deps
  );
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Test 16: escalate_item (new #5) ─────────────────────────────────────────
sep('TEST 16 — escalate_item: "escalate feature flag item"');
{
  const client = makeMockClient();
  const deps = new AgentDeps(client, PM_USER, LAUNCH_CHANNEL, '16', '16');

  const result = await runAgent('escalate the "Feature flag enabled" item for this launch', deps);
  console.log('\n  🤖 Agent reply:\n ', result.finalOutput ?? '(no text reply)');
  console.log(`  📬 Messages posted: ${client.posted.length}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log('All tests complete. Check tool calls logged above.');
