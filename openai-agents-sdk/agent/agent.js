import { Agent, MCPServerStreamableHttp, OpenAIChatCompletionsModel, run, setDefaultOpenAIClient, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';

import { getGitHubModelsClient } from './githubModelsClient.js';
import { addEmojiReaction } from './tools/index.js';
import * as db from '../db/index.js';
import { calculatePhase } from '../services/phaseManager.js';
import { buildLaunchReport, buildLaunchReportBlocks, buildPortfolioBlocks } from '../services/report.js';
import { defineKpi, updateKpiValue, buildKpiListBlocks } from '../services/kpi.js';
import { config } from '../config.js';

const SYSTEM_PROMPT = `\
You are a friendly Slack assistant. You help people by answering questions, \
having conversations, and being generally useful in Slack.

## PERSONALITY
- Friendly, helpful, and approachable
- Lightly witty — a touch of humor when appropriate, but never forced
- Concise and clear — respect people's time
- Confident but honest when you don't know something

## RESPONSE GUIDELINES
- Keep responses to 3 sentences max — be punchy, scannable, and actionable
- End with a clear next step on its own line so it's easy to spot
- Use a bullet list only for multi-step instructions
- Use casual, conversational language
- Use emoji sparingly — at most one per message, and only to set tone

## FORMATTING RULES
- Use standard Markdown syntax: **bold**, _italic_, \`code\`, \`\`\`code blocks\`\`\`, > blockquotes
- Use bullet points for multi-step instructions

## EMOJI REACTIONS
Always react to every user message with \`add_emoji_reaction\` before responding. \
Pick any Slack emoji that reflects the *topic* or *tone* of the message — be creative and specific \
(e.g. \`dog\` for dog topics, \`books\` for learning, \`wave\` for greetings). \
Vary your picks across a thread; don't repeat the same emoji.

## LAUNCH MANAGEMENT TOOLS
You have access to launch management tools for creating and managing product launches:
- \`get_launch_status\`: Check the current phase, tier, and channel info for a launch
- \`create_launch_confirmation\`: Post a confirmation button to create a new launch (requires user click to proceed)
- \`trigger_retro_confirmation\`: Post a confirmation button to start a retro (requires user click to proceed)
- \`sync_phase_status\`: Check phase sync status and optionally force sync with confirmation
- \`get_launch_report\`: Post a leadership-style status report (phase, checklist completion, red items, open slip risk, KPIs, feedback) for the launch in this channel. Set share=true only if the user explicitly asks to send it to leadership.
- \`get_launch_portfolio\`: Post a cross-launch snapshot of every active launch. Use this for "how are all my launches doing" style questions — it is not scoped to one channel.
- \`manage_kpi\`: Define, update, or list success metrics/KPIs for the launch in this channel. Use action="set" the first time a metric is mentioned, action="update" to record a new value for a metric that already exists, and action="list" to show current metrics.

\`get_launch_report\`, \`get_launch_portfolio\`, and \`manage_kpi\` are safe, non-destructive reads/updates — call them directly, no confirmation button needed.

For destructive actions (create_launch, trigger_retro), always use the confirmation tools first — they post a button for the user to click before executing. This prevents accidental channel creation or archiving.

## CRITICAL RULE FOR LAUNCH ACTIONS
If the user asks to create, start, wrap up, finish, close, or archive a launch, you MUST call the 
appropriate tool (create_launch_confirmation or trigger_retro_confirmation) in this same turn. 
NEVER describe a button, link, or confirmation in plain text — you have no ability to create 
clickable UI through text. If you don't call the tool, nothing happens and the user is misled.

## SLACK MCP SERVER
You may have access to the Slack MCP Server, which gives you powerful Slack tools \
beyond your built-in tools. Use them whenever they would help the user.

Available capabilities:
- **Search**: Search messages and files across public channels, search for channels by name
- **Read**: Read channel message history, read thread replies, read canvas documents
- **Write**: Send messages, create draft messages, schedule messages for later
- **Canvases**: Create, read, and update Slack canvas documents

Use these tools when they can help answer a question or complete a task — for example, \
searching for relevant messages, checking a channel for context, or creating a canvas. \
Also use them when the user explicitly asks you to perform a Slack action.`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

// Configure GitHub Models client and disable tracing
const githubModelsClient = getGitHubModelsClient();
setDefaultOpenAIClient(githubModelsClient);
setTracingDisabled(true);

const getLaunchStatus = tool({
  name: 'get_launch_status',
  description: 'Get the current status of a launch by feature name, channel name, or channel ID. Returns phase, tier, launch date, and channel info.',
  parameters: z.object({
    feature_identifier: z.string().describe('The feature name (e.g. "Feature Y"), channel name (e.g. launch-feature-y), or channel ID'),
  }),
  execute: async ({ feature_identifier }, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to check launch status.';
    }

    try {
      console.log('[DEBUG get_launch_status] Looking up:', feature_identifier);
      let launch = db.getLaunchByNameFuzzy(feature_identifier);
      console.log('[DEBUG get_launch_status] Fuzzy name lookup result:', launch);

      if (!launch) {
        // Try as channel name (with or without launch- prefix)
        const channelName = feature_identifier.startsWith('launch-') 
          ? feature_identifier 
          : `launch-${feature_identifier.toLowerCase().replace(/\s+/g, '-')}`;
        console.log('[DEBUG get_launch_status] Trying channel name:', channelName);
        launch = db.getLaunchByChannel(channelName);
        console.log('[DEBUG get_launch_status] Channel lookup result:', launch);
      }

      if (!launch && feature_identifier.startsWith('C')) {
        // Try as channel ID
        launch = db.getLaunchByChannel(feature_identifier);
      }

      if (!launch) {
        // Try to resolve via Slack API
        try {
          const channelInfo = await deps.client.conversations.info({ channel: feature_identifier });
          if (channelInfo.channel) {
            launch = db.getLaunchByChannel(channelInfo.channel.id);
          }
        } catch {
          // Channel lookup failed, continue
        }
      }

      if (!launch) {
        return `No active launch found for: ${feature_identifier}`;
      }

      const computedPhase = calculatePhase(launch.launch_date);
      const stakeholderChannels = db.getStakeholderChannels(launch.id);

      let statusText = `📊 *${launch.name}* Launch Status\n\n`;
      statusText += `**Current Phase:** ${launch.current_phase} (computed: ${computedPhase})\n`;
      statusText += `**Tier:** ${launch.tier}\n`;
      statusText += `**Launch Date:** ${launch.launch_date}\n`;
      statusText += `**Status:** ${launch.status}\n`;
      statusText += `**Main Channel:** <#${launch.channel_id}>\n`;
      
      if (stakeholderChannels.length > 0) {
        statusText += `\n**Sub-channels:**\n`;
        for (const sc of stakeholderChannels) {
          statusText += `• <#${sc.channel_id}> (${sc.team})\n`;
        }
      }

      return statusText;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error checking launch status: ${err.message}`;
    }
  },
});

/**
 * Shared launch resolution for the report/portfolio/kpi tools: prefers an
 * explicit identifier (name or channel), falls back to the launch in the
 * channel the agent is currently running in, same fallback getLaunchStatus
 * uses for names/channel names/channel IDs.
 */
async function resolveLaunchForDeps(feature_identifier, deps) {
  if (!feature_identifier) {
    return db.getLaunchByChannel(deps.channelId);
  }

  let launch = db.getLaunchByNameFuzzy(feature_identifier);
  if (launch) return launch;

  const channelName = feature_identifier.startsWith('launch-')
    ? feature_identifier
    : `launch-${feature_identifier.toLowerCase().replace(/\s+/g, '-')}`;
  launch = db.getLaunchByChannel(channelName);
  if (launch) return launch;

  if (feature_identifier.startsWith('C')) {
    launch = db.getLaunchByChannel(feature_identifier);
    if (launch) return launch;
  }

  try {
    const channelInfo = await deps.client.conversations.info({ channel: feature_identifier });
    if (channelInfo.channel) {
      return db.getLaunchByChannel(channelInfo.channel.id);
    }
  } catch {
    // Channel lookup failed
  }

  return null;
}

const getLaunchReport = tool({
  name: 'get_launch_report',
  description: 'Post a leadership-style status report for a launch: phase, checklist completion, red Go/No-Go items, open slip-risk flags, KPI progress, and feedback so far. Defaults to the launch in the current channel if no feature is named.',
  parameters: z.object({
    feature_identifier: z.string().nullable().describe('Feature name, channel name, or channel ID. Omit to use the launch in the current channel.'),
    share_to_leadership: z.boolean().describe('Set true only if the user explicitly asks to send/share this to leadership.'),
  }),
  execute: async ({ feature_identifier, share_to_leadership }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post the report.';

    try {
      const launch = await resolveLaunchForDeps(feature_identifier, deps);
      if (!launch) {
        return `No active launch found${feature_identifier ? ` for: ${feature_identifier}` : ' in this channel'}.`;
      }

      const report = buildLaunchReport(launch.id);
      const blocks = buildLaunchReportBlocks(report);

      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `📊 Status report for ${launch.name}`,
        blocks,
      });

      if (share_to_leadership) {
        if (!config.LEADERSHIP_CHANNEL_ID) {
          return `Posted the report here, but no leadership channel is configured (LEADERSHIP_CHANNEL_ID is unset), so I couldn't share it.`;
        }
        await deps.client.chat.postMessage({
          channel: config.LEADERSHIP_CHANNEL_ID,
          text: `📊 Status report for ${launch.name}`,
          blocks,
        });
        return `Posted the status report for ${launch.name} and shared it to the leadership channel.`;
      }

      return `Posted the status report for ${launch.name}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error building report: ${err.message}`;
    }
  },
});

const getLaunchPortfolio = tool({
  name: 'get_launch_portfolio',
  description: 'Post a cross-launch snapshot of every active launch (phase, checklist completion, red/slip-risk flags, PM), sorted by launch date. Use for "how are all my launches doing" style questions — not scoped to any one channel.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post the portfolio.';

    try {
      const blocks = buildPortfolioBlocks();
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: '📊 Launch Portfolio',
        blocks,
      });
      return 'Posted the cross-launch portfolio view.';
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error building portfolio: ${err.message}`;
    }
  },
});

const manageKpi = tool({
  name: 'manage_kpi',
  description: 'Define, update, or list success metrics/KPIs for the launch in the current channel. Use action="set" the first time a metric is mentioned (with an optional target and unit), action="update" to record a new current value for a metric that already exists, and action="list" to show all metrics for this launch.',
  parameters: z.object({
    action: z.enum(['set', 'update', 'list']),
    name: z.string().nullable().describe('The KPI name, e.g. "Activation rate". Required for set/update.'),
    target_value: z.string().nullable().describe('Target value for action="set", e.g. "60".'),
    unit: z.string().nullable().describe('Unit for action="set", e.g. "%".'),
    current_value: z.string().nullable().describe('New current value for action="update".'),
  }),
  execute: async ({ action, name, target_value, unit, current_value }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage KPIs.';

    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';

      if (action === 'list') {
        const blocks = buildKpiListBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `Success metrics for ${launch.name}`, blocks });
        return `Posted the current success metrics for ${launch.name}.`;
      }

      if (action === 'set') {
        if (!name) return 'A KPI name is required to define a metric.';
        defineKpi({ launchId: launch.id, name, targetValue: target_value ?? null, unit: unit ?? null, updatedBy: deps.userId });
        return `Now tracking "${name}"${target_value ? ` (target: ${target_value}${unit ?? ''})` : ''}.`;
      }

      if (action === 'update') {
        if (!name || !current_value) return 'Both a KPI name and a new value are required to update a metric.';
        updateKpiValue({ launchId: launch.id, name, currentValue: current_value, updatedBy: deps.userId });
        return `Updated "${name}" to ${current_value}.`;
      }

      return `Unknown action: ${action}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error managing KPI: ${err.message}`;
    }
  },
});

const createLaunchConfirmation = tool({
  name: 'create_launch_confirmation',
  description: 'Use this ONLY when the user wants to start/kick off/create a brand NEW launch. Never use this for wrapping up, closing, finishing, ending, completing, or archiving an existing launch — use trigger_retro_confirmation for that. Post a confirmation button to create a new launch. This is a safety measure - the user must click the button to proceed. Does NOT create the launch directly.',
  parameters: z.object({
    feature_name: z.string().describe('The name of the feature (e.g. "New Dashboard")'),
    launch_date: z.string().describe('Launch date in ISO format (YYYY-MM-DD) or Month-Day (e.g. July-1)'),
    tier: z.enum(['major', 'moderate', 'minor']).describe('Launch tier: major, moderate, or minor'),
  }),
  execute: async ({ feature_name, launch_date, tier }, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to post confirmation.';
    }

    try {
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
      
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `🚀 Create Launch: ${feature_name}?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚀 *Create Launch: ${feature_name}?*\n\n` +
                    `**Launch Date:** ${launch_date}\n` +
                    `**Tier:** ${tierLabel}\n\n` +
                    `Click below to confirm and create the launch channels.`,
            },
          },
          {
            type: 'actions',
            block_id: 'create_launch_confirm',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Create Launch', emoji: true },
                style: 'primary',
                action_id: 'create_launch_confirm',
                value: JSON.stringify({ feature_name, launch_date, tier, requester: deps.userId }),
              },
            ],
          },
        ],
      });

      return `Posted confirmation button for launch: ${feature_name}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error posting confirmation: ${err.message}`;
    }
  },
});

const triggerRetroConfirmation = tool({
  name: 'trigger_retro_confirmation',
  description: 'Use this when the user wants to wrap up, close out, finish, end, complete, or archive an existing launch, or start its retro. This is for EXISTING launches only — never use this to create a new launch. Post a confirmation button to start a retro for the current channel. This is a safety measure - the user must click the button to proceed.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to post confirmation.';
    }

    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      
      if (!launch) {
        return `No active launch found in this channel.`;
      }

      if (launch.status === 'archived') {
        return `This launch has already been archived.`;
      }

      if (launch.status === 'retro_pending') {
        return `Retro has already been scheduled. Click the "Start Retro" button in the channel.`;
      }

      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `📋 Start Retro for ${launch.name}?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *Start Retro for ${launch.name}?*\n\n` +
                    `This will post the retro prompt and archive the channel after completion.`,
            },
          },
          {
            type: 'actions',
            block_id: 'trigger_retro_confirm',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '📝 Start Retro', emoji: true },
                style: 'primary',
                action_id: 'trigger_retro_confirm',
                value: String(launch.id),
              },
            ],
          },
        ],
      });

      return `Posted confirmation button for retro.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error posting confirmation: ${err.message}`;
    }
  },
});

const syncPhaseStatus = tool({
  name: 'sync_phase_status',
  description: 'Check the phase sync status for a launch. Optionally force sync with confirmation if the phase has changed.',
  parameters: z.object({
    channel_identifier: z.string().describe('The channel name or ID'),
    force_sync: z.boolean().optional().describe('Set to true to force phase sync with confirmation'),
  }),
  execute: async ({ channel_identifier, force_sync = false }, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to check phase status.';
    }

    try {
      let launch = db.getLaunchByChannel(channel_identifier);
      
      if (!launch && channel_identifier.startsWith('C')) {
        launch = db.getLaunchByChannel(channel_identifier);
      }

      if (!launch) {
        const channelInfo = await deps.client.conversations.info({ channel: channel_identifier });
        if (channelInfo.channel) {
          launch = db.getLaunchByChannel(channelInfo.channel.id);
        }
      }

      if (!launch) {
        return `No active launch found for channel: ${channel_identifier}`;
      }

      const computedPhase = calculatePhase(launch.launch_date);
      const isSynced = launch.current_phase === computedPhase;

      let statusText = `📊 *${launch.name}* Phase Sync Status\n\n`;
      statusText += `**Current Phase in DB:** ${launch.current_phase}\n`;
      statusText += `**Computed Phase (from date):** ${computedPhase}\n`;
      statusText += `**Launch Date:** ${launch.launch_date}\n`;
      statusText += `**Sync Status:** ${isSynced ? '✅ In sync' : '⚠️ Out of sync'}\n`;

      if (!isSynced && force_sync) {
        await deps.client.chat.postMessage({
          channel: deps.channelId,
          text: `🔄 Sync Phase for ${launch.name}?`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🔄 *Sync Phase for ${launch.name}?*\n\n` +
                      `Current: ${launch.current_phase} → Computed: ${computedPhase}\n\n` +
                      `Click below to force the phase change.`,
              },
            },
            {
              type: 'actions',
              block_id: 'sync_phase_confirm',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ Sync Phase', emoji: true },
                  style: 'primary',
                  action_id: 'sync_phase_confirm',
                  value: JSON.stringify({ launch_id: launch.id, new_phase: computedPhase }),
                },
              ],
            },
          ],
        });
        statusText += `\nPosted confirmation button to force sync.`;
      } else if (!isSynced) {
        statusText += `\n\nUse force_sync=true to post a confirmation button to sync the phase.`;
      }

      return statusText;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error checking phase status: ${err.message}`;
    }
  },
});

export const starterAgent = new Agent({
  name: 'Starter Agent',
  instructions: SYSTEM_PROMPT,
  tools: [
    addEmojiReaction,
    getLaunchStatus,
    createLaunchConfirmation,
    triggerRetroConfirmation,
    syncPhaseStatus,
    getLaunchReport,
    getLaunchPortfolio,
    manageKpi,
  ],
  model: new OpenAIChatCompletionsModel(githubModelsClient, 'openai/gpt-4o-mini'),
});

/**
 * Run the agent, optionally connecting to the Slack MCP server.
 * @param {string | import('@openai/agents').AgentInputItem[]} inputItems
 * @param {import('./deps.js').AgentDeps} deps
 * @returns {Promise<import('@openai/agents').RunResult<any, any>>}
 */
export async function runAgent(inputItems, deps) {
  const result = deps.userToken
    ? await runAgentWithMcp(inputItems, deps)
    : await run(starterAgent, inputItems, { context: deps });
  
  console.log('[agent] tool calls this turn:', result.newItems?.filter(i => i.type === 'tool_call_item').length ?? 0);
  return result;
}

async function runAgentWithMcp(inputItems, deps) {
  const mcpServer = new MCPServerStreamableHttp({
    url: SLACK_MCP_URL,
    requestInit: { headers: { Authorization: `Bearer ${deps.userToken}` } },
  });

  try {
    await mcpServer.connect();
    const agentWithMcp = starterAgent.clone({ mcpServers: [mcpServer] });
    return await run(agentWithMcp, inputItems, { context: deps });
  } finally {
    await mcpServer.close();
  }
}
