// test-harness.js
//
// Runs the full test-script prompt list straight through the real agent
// (agent/index.js -> runAgent), bypassing Slack entirely. Uses the same
// AgentDeps + runAgent call the real message.js listener makes, so tool
// routing, DB reads/writes, and LLM calls are all real — only the Slack
// client is mocked (postMessage/etc. just log instead of hitting the API).
//
// USAGE:
//   SLACK_BOT_TOKEN=x SLACK_APP_TOKEN=x node test-harness.js           → all prompts
//   SLACK_BOT_TOKEN=x SLACK_APP_TOKEN=x node test-harness.js "prompt"  → single prompt
//
// Or add SLACK_BOT_TOKEN and SLACK_APP_TOKEN to your .env file.
// Set TEST_CHANNEL_ID=<real channel id> in .env to point at a real launch.

import 'dotenv/config';

// Stub required env vars before config.js loads
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'xoxb-test-stub';
process.env.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || 'xapp-test-stub';

import { AgentDeps, runAgent } from './agent/index.js';
import * as db from './db/index.js';

// ─── Mock Slack client ────────────────────────────────────────────────────────

const mockClient = {
  chat: {
    postMessage: async (args) => {
      console.log(`  [chat.postMessage → ${args.channel}]`);
      console.log(`  ${args.text ?? '(blocks only)'}`);
      if (args.blocks) {
        for (const b of args.blocks) {
          if (b.type === 'actions') {
            console.log(`  [buttons: ${b.elements.map(e => e.text?.text ?? '?').join(' | ')}]`);
          }
        }
      }
      return { ok: true, ts: String(Date.now() / 1000) };
    },
  },
  reactions: {
    add: async ({ name }) => ({ ok: true }),
  },
  conversations: {
    info: async ({ channel }) => ({ ok: true, channel: { id: channel, name: 'mock-channel' } }),
    join: async () => ({ ok: true }),
    members: async () => ({ ok: true, members: [] }),
  },
  users: {
    info: async ({ user }) => ({ ok: true, user: { id: user, real_name: 'Mock User' } }),
  },
};

// ─── Seed a test launch ───────────────────────────────────────────────────────

const TEST_USER_ID = 'U_TEST_USER';
const CHANNEL_ID = process.env.TEST_CHANNEL_ID || 'C_TEST_LAUNCH';

function ensureTestLaunch() {
  const existing = db.getLaunchByChannel(CHANNEL_ID);
  if (existing) {
    console.log(`[harness] Using existing launch: "${existing.name}" (id=${existing.id}) in ${CHANNEL_ID}\n`);
    return existing;
  }
  const launchDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const id = db.createLaunch({
    name: 'Harness Test Feature',
    channelId: CHANNEL_ID,
    launchDate,
    pmUserId: TEST_USER_ID,
    tier: 'moderate',
    githubRepo: null,
  });
  console.log(`[harness] Seeded test launch id=${id} in channel ${CHANNEL_ID}\n`);
  return db.getLaunchById(id);
}

// ─── Prompt list ──────────────────────────────────────────────────────────────

const PROMPTS = [
  'hi',
  'what can you help me with?',
  `what's the status of Harness Test Feature?`,
  'set a KPI: activation rate, target 60%',
  'update activation rate to 42%',
  'list our KPIs',
  'log a high technical risk — third-party API rate limits',
  'what risks have we logged?',
  'add a budget category: paid social, $5,000 approved',
  'record $1,200 spent on paid social',
  'show me the budget',
  'send the paid social budget for approval',
  'add a CS readiness item: FAQ doc, link https://example.com, in progress',
  `what's our CS readiness status?`,
  'give me a status report',
  'how are all my launches doing?',
  'any slip risk right now?',
  'send standups now',
  `what's the legal sign-off status?`,
  'any open PRs on the repo?',
  'submit the marketing copy for review, link: https://example.com/draft',
  `what's the review status?`,
  'what phase are we in?',
  'force the phase to gonogo',
  `what's our go/no-go status?`,
  'post the go/no-go canvas now',
  'chase the red items',
  `what do the live metrics look like?`,
  'I want to add feedback',
  // Confirmation-button flows (shows intent routing, no side effects)
  'kick off a launch for Widget Pro, minor tier, 30 days from now',
  // Edge cases
  `what's the status of a launch that doesn't exist`,
  'delete the launch',
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runPrompt(prompt, history) {
  const deps = new AgentDeps(mockClient, TEST_USER_ID, CHANNEL_ID, 'thread_1', 'ts_1', null);
  // Keep only the last 6 history items (~3 turns) to stay under the token limit
  const trimmedHistory = history ? history.slice(-6) : null;
  const inputItems = trimmedHistory ? [...trimmedHistory, { role: 'user', content: prompt }] : prompt;

  // Retry up to 3 times on 429, waiting the retry-after duration each time
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runAgent(inputItems, deps);
    } catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('rate limit');
      const retryAfterSec = e.retryAfterSec ?? null;

      if (is429 && attempt < 3) {
        if (retryAfterSec && retryAfterSec > 300) {
          // Daily quota — no point retrying, re-throw immediately
          throw e;
        }
        const waitSec = retryAfterSec ? Math.min(retryAfterSec + 5, 120) : 65;
        console.log(`  [harness] 429 — waiting ${waitSec}s then retrying (attempt ${attempt}/3)...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  const singlePrompt = process.argv[2];
  ensureTestLaunch();

  const toRun = singlePrompt ? [singlePrompt] : PROMPTS;
  let history = null;
  let passed = 0, failed = 0;

  for (const prompt of toRun) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`USER: ${prompt}`);
    console.log('─'.repeat(70));
    try {
      const result = await runPrompt(prompt, history);
      console.log(`AGENT: ${result.finalOutput}`);
      history = result.history;
      passed++;
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Done. ${passed} passed, ${failed} failed out of ${toRun.length} prompt(s).`);
  console.log('═'.repeat(70));
}

main().catch(e => {
  console.error('Harness failed:', e);
  process.exit(1);
});
