import { Agent, MCPServerStreamableHttp, OpenAIChatCompletionsModel, run, setDefaultOpenAIClient, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';

import { getGitHubModelsClient } from './githubModelsClient.js';
import { addEmojiReaction } from './tools/index.js';
import * as db from '../db/index.js';
import { clusterPendingSignals } from '../services/signalClustering.js';
import { scoreCluster } from '../services/demandValidation.js';
import { draftProblemStatement } from '../services/problemStatement.js';
import { runCompetitiveScan } from '../services/competitiveScan.js';
import { sizeOpportunity } from '../services/opportunitySizing.js';
import { config } from '../config.js';

const SYSTEM_PROMPT = `\
You are LaunchBot, a Slack assistant for product discovery and signal analysis. Be concise, friendly, and helpful.

STYLE: 3 sentences max. Casual tone. Emoji reactions on every message via add_emoji_reaction.

SAFE TOOLS (call directly): cluster_signals, review_signal_cluster, draft_problem_statement, run_competitive_scan, size_opportunity.`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

// Configure GitHub Models client and disable tracing
const githubModelsClient = getGitHubModelsClient();
setDefaultOpenAIClient(githubModelsClient);
setTracingDisabled(true);

// ─── Signal intake & demand validation tools ─────────────────────────────────
// Not launch-scoped (no resolveLaunchForDeps) — signals exist to help decide
// whether a launch should exist yet, so there's no launch to resolve against.

const clusterSignalsTool = tool({
  name: 'cluster_signals',
  description:
    'Run clustering and confidence scoring over any newly captured support ticket, sales feedback, ' +
    'user interview, analytics, or churn signals, and post the resulting clusters. Use when asked to ' +
    '"check for new signals" or "see what problems are worth looking at".',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to cluster signals.';
    try {
      const newClusterIds = clusterPendingSignals();
      if (newClusterIds.length === 0) {
        return 'No new clusters met the minimum evidence threshold — nothing new worth reviewing yet.';
      }
      const clusters = newClusterIds.map(id => db.getSignalCluster(id));
      const lines = clusters.map(c =>
        `• #${c.id} ${c.problem_summary} — reach ${c.reach_count}, sources ${c.source_diversity}, ` +
        `confidence ${c.confidence_score} (${c.confidence_label})`
      );
      const targetChannel = config.SIGNAL_REVIEW_CHANNEL_ID || deps.channelId;
      await deps.client.chat.postMessage({
        channel: targetChannel,
        text: `${newClusterIds.length} new signal cluster(s) formed`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${newClusterIds.length} new signal cluster(s):*\n${lines.join('\n')}` } }],
      });
      return `Posted ${newClusterIds.length} new cluster(s). Never claim these are confirmed demand — they're candidates for a PM to validate further.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error clustering signals: ${err.message}`;
    }
  },
});

const reviewSignalClusterTool = tool({
  name: 'review_signal_cluster',
  description: 'Re-score a specific signal cluster and/or mark it validated or dismissed after a PM reviews the evidence.',
  parameters: z.object({
    cluster_id: z.number().describe('The signal cluster ID.'),
    action: z.enum(['rescore', 'validate', 'dismiss']),
  }),
  execute: async ({ cluster_id, action }) => {
    try {
      const cluster = db.getSignalCluster(cluster_id);
      if (!cluster) return `No signal cluster #${cluster_id}.`;
      
      if (action === 'rescore') {
        const { reachCount, sourceDiversity, revenueExposure, confidenceScore, confidenceLabel } = scoreCluster(cluster_id);
        db.updateClusterScore({ clusterId, reachCount, sourceDiversity, revenueExposure, confidenceScore, confidenceLabel });
        return `Re-scored cluster #${cluster_id}: reach ${reachCount}, sources ${sourceDiversity}, revenue $${revenueExposure}, confidence ${confidenceScore} (${confidenceLabel}).`;
      }
      
      if (action === 'validate') {
        db.updateClusterStatus(cluster_id, 'validated');
        return `Marked cluster #${cluster_id} as validated.`;
      }
      
      if (action === 'dismiss') {
        db.updateClusterStatus(cluster_id, 'dismissed');
        return `Dismissed cluster #${cluster_id}.`;
      }
      
      return `Unknown action: ${action}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error reviewing cluster: ${err.message}`;
    }
  },
});

// ─── Problem definition tools ─────────────────────────────────────────────────
// All three read/write cluster-scoped tables, not launch-scoped — same
// reasoning as the signal tools above.

const draftProblemStatementTool = tool({
  name: 'draft_problem_statement',
  description:
    'Draft a crisp, testable problem statement for a signal cluster, tied to a measurable outcome. ' +
    'Use when a PM asks to "draft a problem statement" or "define the problem" for a cluster.',
  parameters: z.object({
    cluster_id: z.number().describe('The signal cluster ID.'),
  }),
  execute: async ({ cluster_id }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    try {
      const { draftText, version } = draftProblemStatement(cluster_id, 'agent');
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `Problem statement draft for cluster #${cluster_id}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Problem statement draft (v${version}):*\n${draftText}` } }],
      });
      return `Posted problem statement draft for cluster #${cluster_id}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error drafting problem statement: ${err.message}`;
    }
  },
});

const runCompetitiveScanTool = tool({
  name: 'run_competitive_scan',
  description:
    'Run a competitive scan for a signal cluster: mines your own sales/churn data for competitor mentions first, ' +
    'then runs targeted web searches for each competitor to check if they have the capability. Use when asked to ' +
    '"check competitors" or "run competitive scan" for a cluster.',
  parameters: z.object({
    cluster_id: z.number().describe('The signal cluster ID.'),
  }),
  execute: async ({ cluster_id }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    try {
      const cluster = db.getSignalCluster(cluster_id);
      if (!cluster) return `No signal cluster #${cluster_id}.`;
      const rows = await runCompetitiveScan(cluster_id, cluster.problem_summary.slice(0, 60));
      const lines = rows.map(r =>
        `• ${r.competitor_name}: ${r.capability_status} (${r.evidence_type}${r.source_ref ? `, ${r.source_ref}` : ', no citation'})` 
      );
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `Competitive scan for cluster #${cluster_id}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Competitive scan results:*\n${lines.join('\n')}` } }],
      });
      return `Posted competitive scan for cluster #${cluster_id}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error running competitive scan: ${err.message}`;
    }
  },
});

const sizeOpportunityTool = tool({
  name: 'size_opportunity',
  description:
    'Size the opportunity for a signal cluster as a low (observed) and high (extrapolated) dollar range. ' +
    'Use when asked to "size the opportunity" or "calculate revenue potential" for a cluster.',
  parameters: z.object({
    cluster_id: z.number().describe('The signal cluster ID.'),
  }),
  execute: async ({ cluster_id }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    try {
      const { lowEstimate, highEstimate, basisNote } = sizeOpportunity(cluster_id);
      const highText = highEstimate != null ? `$${Math.round(highEstimate).toLocaleString()}` : 'not available';
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `Opportunity size for cluster #${cluster_id}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Opportunity size:*\nLow: $${Math.round(lowEstimate).toLocaleString()}\nHigh: ${highText}\n\nMethod: ${basisNote}` } }],
      });
      return `Posted opportunity size for cluster #${cluster_id}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error sizing opportunity: ${err.message}`;
    }
  },
});

const agent = new Agent({
  name: 'LaunchBot',
  instructions: SYSTEM_PROMPT,
  tools: [
    addEmojiReaction,
    clusterSignalsTool,
    reviewSignalClusterTool,
    draftProblemStatementTool,
    runCompetitiveScanTool,
    sizeOpportunityTool,
  ],
  model: new OpenAIChatCompletionsModel(githubModelsClient, 'openai/gpt-4.1-mini'),
});

/**
 * Run the agent, optionally connecting to the Slack MCP server.
 * @param {string | import('@openai/agents').AgentInputItem[]} inputItems
 * @param {import('./deps.js').AgentDeps} deps
 * @returns {Promise<import('@openai/agents').RunResult<any, any>>}
 */
const AGENT_TIMEOUT_MS = 55_000; // 55s — under Slack's 60s ack window

export async function runAgent(inputItems, deps) {
  const inputSummary = typeof inputItems === 'string'
    ? inputItems.slice(0, 120)
    : `[history+user] ${JSON.stringify(inputItems.at(-1)).slice(0, 120)}`;

  console.log(`[agent] ▶ START | channel=${deps.channelId} user=${deps.userId} hasMcp=${!!deps.userToken}`);
  console.log(`[agent]   input: "${inputSummary}"`);

  const startMs = Date.now();

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      console.error(`[agent] ✖ TIMEOUT after ${AGENT_TIMEOUT_MS}ms — GitHub Models did not respond`);
      reject(new Error(`Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s — the LLM did not respond. Try again in a moment.`));
    }, AGENT_TIMEOUT_MS);
  });

  try {
    const resultPromise = deps.userToken
      ? runWithMcp(inputItems, deps, timeout)
      : run(agent, inputItems, { context: deps });

    const result = await Promise.race([resultPromise, timeout]);
    clearTimeout(timeoutHandle);

    const elapsedMs = Date.now() - startMs;
    console.log(`[agent] ◀ DONE | elapsed=${elapsedMs}ms`);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    const elapsedMs = Date.now() - startMs;
    console.error(`[agent] ✖ ERROR | elapsed=${elapsedMs}ms error=${err.message}`);
    throw err;
  }
}

async function runWithMcp(inputItems, deps, timeout) {
  const mcpServer = new MCPServerStreamableHttp(SLACK_MCP_URL, {
    accessToken: deps.userToken,
  });
  await mcpServer.connect();
  console.log(`[agent:mcp] Connected to Slack MCP server`);

  try {
    const agentWithMcp = agent.clone({ mcpServers: [mcpServer] });
    const result = await run(agentWithMcp, inputItems, { context: deps });
    console.log(`[agent:mcp] Run complete.`);
    return result;
  } catch (err) {
    console.error(`[agent:mcp] Error during MCP run: ${err.message}`);
    throw err;
  } finally {
    await mcpServer.close();
    console.log(`[agent:mcp] MCP server connection closed.`);
  }
}
