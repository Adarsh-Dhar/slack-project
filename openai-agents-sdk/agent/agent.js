import { Agent, MCPServerStreamableHttp, OpenAIChatCompletionsModel, run, setDefaultOpenAIClient, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';

import { getGitHubModelsClient } from './githubModelsClient.js';
import { addEmojiReaction } from './tools/index.js';
import * as db from '../db/index.js';
import { calculatePhase } from '../services/phaseManager.js';
import { buildLaunchReport, buildLaunchReportBlocks, buildPortfolioBlocks } from '../services/report.js';
import { defineKpi, updateKpiValue, buildKpiListBlocks } from '../services/kpi.js';
import { config } from '../config.js';
import { triggerComms } from '../services/comms.js';
import { getLiveMetrics } from '../services/monitoring.js';
import { defineBudgetItem, updateSpend, buildBudgetListBlocks } from '../services/budget.js';
import { setCsReadinessItem, buildCsReadinessBlocks } from '../services/csReadiness.js';
import { setRiskItem, buildRiskBlocks } from '../services/risk.js';
import { nudgeOwnerNow, escalateItemNow } from '../services/ownership.js';
import { sendStandupForLaunch } from '../services/scheduler.js';
import { getOpenPRs } from '../services/githubPRs.js';
import { postGoNoGoCanvas, chaseRedItems, requestOverride } from '../services/gonogo.js';

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
- \`create_launch_confirmation\`: Post a confirmation button to create a new launch (requires user click to proceed). When the user @-mentions teammates or #-mentions channels while asking to create a launch, pass them as mentioned_user_ids / mentioned_channel_ids so they're invited automatically.
- \`trigger_retro_confirmation\`: Post a confirmation button to start a retro (requires user click to proceed)
- \`sync_phase_status\`: Check phase sync status, force sync with confirmation, or manually override to a specific phase (use manual_phase param when the user explicitly names a phase).
- \`get_launch_report\`: Post a leadership-style status report (phase, checklist completion, red items, open slip risk, KPIs, feedback) for the launch in this channel. Set share=true only if the user explicitly asks to send it to leadership.
- \`get_launch_portfolio\`: Post a cross-launch snapshot of every active launch. Use this for "how are all my launches doing" style questions — it is not scoped to one channel.
- \`manage_kpi\`: Define, update, or list success metrics/KPIs for the launch in this channel. Use action="set" the first time a metric is mentioned, action="update" to record a new value for a metric that already exists, and action="list" to show current metrics.
- \`open_feedback_prompt\`: Post a button so the user can submit retro feedback for the launch in this channel.
- \`trigger_comms_confirmation\`: Post a confirmation button to send an external announcement (blog, email, social, press). Never sends comms directly — always requires user confirmation.
- \`get_live_metrics\`: Fetch current error rate / key metrics for the launch from the monitoring provider.
- \`manage_budget\`: Define, update, or list budget/spend for the launch in this channel.
- \`manage_cs_readiness\`: Track CS/support readiness items (FAQ docs, macros, escalation paths) for the launch in this channel.
- \`manage_risk\`: Log or list risk assessments (technical, legal, market_timing, other) for the launch. action="set" to record, action="list" to show.
- \`request_budget_approval\`: Send a budget category to the launch PM for approve/reject sign-off.
- \`nudge_owner\`: Send an immediate reminder DM to whoever owns a specific open checklist item.
- \`escalate_item\`: Post an escalation to the launch channel tagging the PM about a stuck checklist item.
- \`send_standup_now\`: Immediately send daily check-in DMs to every item owner instead of waiting for the 9am cron.
- \`manage_content_review\`: Submit marketing/docs/sales copy for review (action="submit"), or list current review status (action="list").
- \`get_legal_status\`: Check current legal/compliance sign-off checklist status for the launch in this channel.
- \`get_slip_risk_status\`: List currently open/unresolved slip-risk alerts for the launch in this channel.
- \`get_pr_status\`: Check currently open GitHub PRs for the launch (requires linked github_repo).
- \`get_gonogo_status\`: Check current Go/No-Go readiness — green/red/pending counts per item, without posting the canvas.
- \`trigger_gonogo_canvas\`: Post (or repost) the interactive Go/No-Go checklist canvas right now, instead of waiting for the T-48h cron.
- \`chase_red_items\`: Immediately re-DM the owners of every currently-red Go/No-Go item.
- \`request_gonogo_override\`: Submit an override request to the PM for a red Go/No-Go item. Does not approve — PM still clicks the button.
- \`list_gonogo_overrides\`: List pending Go/No-Go override requests awaiting a PM decision.
- \`record_gonogo_decision\`: Record the final Go/No-Go decision (go, no_go, or hold) and announce it. PM only.
- \`confirm_feature_live\`: Mark the launch as confirmed live and announce it in the channel.

\`get_launch_report\`, \`get_launch_portfolio\`, \`manage_kpi\`, \`open_feedback_prompt\`, \`get_live_metrics\`, \`manage_budget\`, \`manage_cs_readiness\`, \`manage_risk\`, \`nudge_owner\`, \`escalate_item\`, \`send_standup_now\`, \`manage_content_review\`, \`get_legal_status\`, \`get_slip_risk_status\`, \`get_pr_status\`, \`get_gonogo_status\`, \`trigger_gonogo_canvas\`, \`chase_red_items\`, \`request_gonogo_override\`, \`list_gonogo_overrides\`, \`record_gonogo_decision\`, and \`confirm_feature_live\` are safe, non-destructive reads/updates — call them directly, no confirmation button needed.

For destructive or outbound actions (create_launch, trigger_retro, trigger_comms), always use the confirmation tools first — they post a button for the user to click before executing. This prevents accidental channel creation, archiving, or external sends.

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
    mentioned_user_ids: z.array(z.string()).nullable().describe('Slack user IDs (e.g. "U0123ABC") of any teammates the user @-mentioned as stakeholders. Extract these from <@U...> tokens in the user\'s message. Omit/empty if none were mentioned.'),
    mentioned_channel_ids: z.array(z.string()).nullable().describe('Slack channel IDs (e.g. "C0123ABC") of any channels the user #-mentioned to link as stakeholder channels. Extract from <#C...|name> tokens. Omit/empty if none were mentioned.'),
  }),
  execute: async ({ feature_name, launch_date, tier, mentioned_user_ids, mentioned_channel_ids }, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to post confirmation.';
    }

    try {
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
      const stakeholderUsers = mentioned_user_ids ?? [];
      const stakeholderChannels = mentioned_channel_ids ?? [];
      const stakeholderLine = stakeholderUsers.length
        ? `\n*Stakeholders:* ${stakeholderUsers.map(id => `<@${id}>`).join(', ')}`
        : '';

      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `🚀 Create Launch: ${feature_name}?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚀 *Create Launch: ${feature_name}?*\n\n` +
                    `*Launch Date:* ${launch_date}\n` +
                    `*Tier:* ${tierLabel}` +
                    `${stakeholderLine}\n\n` +
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
                value: JSON.stringify({
                  feature_name, launch_date, tier, requester: deps.userId,
                  stakeholderUsers, stakeholderChannels,
                }),
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
  description: 'Check the phase sync status for a launch, or manually override it to a specific phase. Optionally force sync with confirmation if the phase has changed.',
  parameters: z.object({
    channel_identifier: z.string().describe('The channel name or ID'),
    force_sync: z.boolean().optional().describe('Set to true to force phase sync with confirmation'),
    manual_phase: z.enum(['discovery', 'build', 'prelaunch', 'gonogo', 'launchday']).nullable()
      .describe('Set to manually override the phase to this exact value, regardless of the computed phase. Use when the user explicitly says e.g. "set the phase to launchday".'),
  }),
  execute: async ({ channel_identifier, force_sync = false, manual_phase }, context) => {
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

      // Manual override path — posts a confirm button regardless of computed phase
      if (manual_phase) {
        await deps.client.chat.postMessage({
          channel: deps.channelId,
          text: `🔄 Manually set phase for ${launch.name} to ${manual_phase}?`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🔄 *Manually set phase for ${launch.name}?*\n\n` +
                      `Current: ${launch.current_phase} → Requested: *${manual_phase}*\n\n` +
                      `Click below to confirm the override.`,
              },
            },
            {
              type: 'actions',
              block_id: 'sync_phase_confirm',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ Set Phase', emoji: true },
                  style: 'primary',
                  action_id: 'sync_phase_confirm',
                  value: JSON.stringify({ launch_id: launch.id, new_phase: manual_phase }),
                },
              ],
            },
          ],
        });
        return `Posted confirmation button to manually set the phase to ${manual_phase}.`;
      }

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

// ─── A2: Feedback prompt tool ─────────────────────────────────────────────────

const openFeedbackPrompt = tool({
  name: 'open_feedback_prompt',
  description: 'Post a button that lets the user (or anyone in the channel) open the launch feedback form for the launch in this channel. Use when someone wants to add feedback, e.g. "I want to leave feedback on this launch".',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post the feedback prompt.';
    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `💬 Add feedback for ${launch.name}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `💬 *Add feedback for ${launch.name}*` } },
          {
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: '💬 Add Feedback', emoji: true },
              action_id: 'feedback_add',
              value: String(launch.id),
            }],
          },
        ],
      });
      return `Posted a feedback button for ${launch.name}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error posting feedback prompt: ${err.message}`;
    }
  },
});

// ─── B1: Comms confirmation tool ─────────────────────────────────────────────

const triggerCommsConfirmation = tool({
  name: 'trigger_comms_confirmation',
  description: 'Use when the user wants to send an external announcement (blog, email, social, or press) for the launch in this channel. Posts a confirmation button — never sends comms directly.',
  parameters: z.object({
    channel: z.enum(['blog', 'email', 'social', 'press']).describe('The outbound comms channel to send to.'),
    message: z.string().describe('The announcement text to send.'),
  }),
  execute: async ({ channel, message }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post confirmation.';
    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `📣 Send ${channel} comms for ${launch.name}?`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `📣 *Send ${channel} comms for ${launch.name}?*\n\n>${message}` } },
          {
            type: 'actions',
            block_id: 'trigger_comms_confirm',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: `✅ Send ${channel}`, emoji: true },
              style: 'primary',
              action_id: 'trigger_comms_confirm',
              value: JSON.stringify({ launchId: launch.id, channel, message, requester: deps.userId }),
            }],
          },
        ],
      });
      return `Posted confirmation button to send ${channel} comms.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error posting comms confirmation: ${err.message}`;
    }
  },
});

// ─── B2: Live metrics tool ────────────────────────────────────────────────────

const getLiveMetricsTool = tool({
  name: 'get_live_metrics',
  description: 'Fetch current error rate / key metrics for the launch in this channel from the monitoring provider (requires MONITORING_API_URL to be configured).',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to fetch metrics.';
    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';
      const metrics = await getLiveMetrics(launch.name);
      return `📈 Live metrics for ${launch.name}: ${JSON.stringify(metrics, null, 2)}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error fetching live metrics: ${err.message}`;
    }
  },
});

// ─── B3: Budget tool ──────────────────────────────────────────────────────────

const manageBudget = tool({
  name: 'manage_budget',
  description: 'Define, update, or list budget/spend for the launch in this channel. action="set" defines a category with an approved amount, action="update" records new spend, action="list" shows all categories.',
  parameters: z.object({
    action: z.enum(['set', 'update', 'list']),
    category: z.string().nullable().describe('Budget category, e.g. "Paid social ads". Required for set/update.'),
    approved_amount: z.string().nullable().describe('Approved budget amount for action="set", e.g. "5000".'),
    approver: z.string().nullable().describe('Slack user ID of the approver, for action="set".'),
    spent_amount: z.string().nullable().describe('New spend amount for action="update".'),
  }),
  execute: async ({ action, category, approved_amount, approver, spent_amount }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage budget.';
    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';
      if (action === 'list') {
        const blocks = buildBudgetListBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `Budget for ${launch.name}`, blocks });
        return `Posted the current budget for ${launch.name}.`;
      }
      if (action === 'set') {
        if (!category) return 'A budget category is required.';
        defineBudgetItem({ launchId: launch.id, category, approvedAmount: approved_amount ?? null, approver: approver ?? null, updatedBy: deps.userId });
        return `Now tracking "${category}"${approved_amount ? ` (approved: ${approved_amount})` : ''}.`;
      }
      if (action === 'update') {
        if (!category || !spent_amount) return 'Both a category and a spent amount are required.';
        updateSpend({ launchId: launch.id, category, spentAmount: spent_amount, updatedBy: deps.userId });
        return `Updated "${category}" spend to ${spent_amount}.`;
      }
      return `Unknown action: ${action}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error managing budget: ${err.message}`;
    }
  },
});

// ─── B4: CS readiness tool ────────────────────────────────────────────────────

const manageCsReadiness = tool({
  name: 'manage_cs_readiness',
  description: 'Track CS/support readiness items (FAQ docs, macros, escalation paths) for the launch in this channel. action="set" creates or updates an item (with optional link and status), action="list" shows all items.',
  parameters: z.object({
    action: z.enum(['set', 'list']),
    item: z.string().nullable().describe('The readiness item name, e.g. "Support FAQ doc". Required for action="set".'),
    link: z.string().nullable().describe('URL to the doc or resource, for action="set".'),
    status: z.enum(['not_started', 'in_progress', 'done']).nullable().describe('Item status, for action="set".'),
  }),
  execute: async ({ action, item, link, status }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage CS readiness.';
    try {
      const launch = db.getLaunchByChannel(deps.channelId);
      if (!launch) return 'No active launch found in this channel.';
      if (action === 'list') {
        const blocks = buildCsReadinessBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `CS readiness for ${launch.name}`, blocks });
        return `Posted CS readiness items for ${launch.name}.`;
      }
      if (action === 'set') {
        if (!item) return 'An item name is required.';
        setCsReadinessItem({ launchId: launch.id, item, link: link ?? null, status: status ?? 'not_started', updatedBy: deps.userId });
        return `Tracked CS readiness item "${item}"${status ? ` (${status})` : ''}.`;
      }
      return `Unknown action: ${action}`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error managing CS readiness: ${err.message}`;
    }
  },
});

// ─── #1 Risk tool ─────────────────────────────────────────────────────────────

const manageRisk = tool({
  name: 'manage_risk',
  description: 'Log or list risk assessments (technical, legal, market_timing, other) for the launch in this channel. Use action="set" to record/update a risk level and optional note, action="list" to show all logged risks.',
  parameters: z.object({
    action: z.enum(['set', 'list']),
    category: z.enum(['technical', 'legal', 'market_timing', 'other']).nullable()
      .describe('Required for action="set".'),
    level: z.enum(['low', 'medium', 'high']).nullable()
      .describe('Required for action="set".'),
    note: z.string().nullable().describe('Optional note explaining the risk.'),
  }),
  execute: async ({ action, category, level, note }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage risk.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';

    if (action === 'list') {
      const blocks = buildRiskBlocks(launch.id, launch.name);
      await deps.client.chat.postMessage({ channel: deps.channelId, text: `Risk assessment for ${launch.name}`, blocks });
      return `Posted the current risk assessment for ${launch.name}.`;
    }
    if (!category || !level) return 'A category and level are required to log a risk.';
    setRiskItem({ launchId: launch.id, category, level, note: note ?? null, updatedBy: deps.userId });
    return `Logged ${level} ${category} risk${note ? `: ${note}` : ''}.`;
  },
});

// ─── #2 Budget approval tool ──────────────────────────────────────────────────

const requestBudgetApproval = tool({
  name: 'request_budget_approval',
  description: 'Send a budget category to the launch PM for approve/reject sign-off. The category must already exist — use manage_budget action="set" first if not.',
  parameters: z.object({
    category: z.string().describe('The budget category to send for approval, e.g. "Paid social ads".'),
  }),
  execute: async ({ category }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to request approval.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const item = db.getBudgetForLaunch(launch.id).find(b => b.category === category);
    if (!item) return `No budget category "${category}" found. Define it first with manage_budget action="set".`;

    await deps.client.chat.postMessage({
      channel: launch.pm_user_id,
      text: `💰 Approve budget for ${launch.name}?`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `💰 *Approve "${category}" for ${launch.name}?*\n\nRequested amount: ${item.approved_amount ?? '—'}` },
        },
        {
          type: 'actions',
          elements: [
            { type: 'button', text: { type: 'plain_text', text: '✅ Approve' }, style: 'primary', action_id: 'budget_approve', value: JSON.stringify({ launchId: launch.id, category }) },
            { type: 'button', text: { type: 'plain_text', text: '❌ Reject' }, style: 'danger', action_id: 'budget_reject', value: JSON.stringify({ launchId: launch.id, category }) },
          ],
        },
      ],
    });
    return `Sent "${category}" to <@${launch.pm_user_id}> for approval.`;
  },
});

// ─── #3 Nudge owner tool ──────────────────────────────────────────────────────

const nudgeOwnerTool = tool({
  name: 'nudge_owner',
  description: 'Send an immediate reminder DM to whoever owns a specific open checklist item for the launch in this channel.',
  parameters: z.object({
    item_title: z.string().describe('The checklist item title, or a close match to it.'),
  }),
  execute: async ({ item_title }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to nudge owner.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const items = db.getItemsByLaunch(launch.id);
    const item = items.find(
      i => i.title.toLowerCase().includes(item_title.toLowerCase()) && i.owner_id && i.status !== 'done'
    );
    if (!item) return `No open item matching "${item_title}" with an assigned owner was found.`;
    await nudgeOwnerNow(deps.client, { item, launch });
    return `Nudged <@${item.owner_id}> about "${item.title}".`;
  },
});

// ─── #4 Slip risk status tool ─────────────────────────────────────────────────

const getSlipRiskStatus = tool({
  name: 'get_slip_risk_status',
  description: 'List currently open/unresolved slip-risk alerts for the launch in this channel.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const events = db.getOpenSlipEvents(launch.id);
    if (events.length === 0) return `No open slip-risk alerts for ${launch.name}. ✅`;
    return `⚠️ ${events.length} open slip-risk alert(s) for ${launch.name}:\n` +
      events.map(e => `• <@${e.detected_user_id}>: "${e.message_text?.slice(0, 100)}" (${e.status})`).join('\n');
  },
});

// ─── #5 Escalate item tool ────────────────────────────────────────────────────

const escalateItemTool = tool({
  name: 'escalate_item',
  description: 'Immediately post an escalation to the launch channel, tagging the PM, about a specific stuck checklist item.',
  parameters: z.object({
    item_title: z.string().describe('The checklist item title to escalate.'),
  }),
  execute: async ({ item_title }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to escalate.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const item = db.getItemsByLaunch(launch.id).find(
      i => i.title.toLowerCase().includes(item_title.toLowerCase()) && i.status !== 'done'
    );
    if (!item) return `No open item matching "${item_title}" found.`;
    await escalateItemNow(deps.client, { item, launch, escalatedBy: deps.userId });
    return `Escalated "${item.title}" in the launch channel.`;
  },
});

// ─── #6 Send standup now tool ─────────────────────────────────────────────────

const sendStandupNow = tool({
  name: 'send_standup_now',
  description: 'Immediately send daily check-in DMs to every item owner for the launch in this channel, instead of waiting for the 9am cron.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to send standups.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const count = await sendStandupForLaunch(deps.client, launch);
    return `Sent standup check-ins to ${count} owner(s) for ${launch.name}.`;
  },
});

// ─── #7 Content review tool ───────────────────────────────────────────────────

const manageContentReview = tool({
  name: 'manage_content_review',
  description: 'Submit marketing/docs/sales copy for review (action="submit"), or list current review status (action="list") for the launch in this channel.',
  parameters: z.object({
    action: z.enum(['submit', 'list']),
    content_type: z.enum(['marketing', 'docs', 'sales']).nullable()
      .describe('Required for action="submit".'),
    link: z.string().nullable().describe('Link to the doc/draft being reviewed. Required for action="submit".'),
  }),
  execute: async ({ action, content_type, link }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage content review.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';

    if (action === 'list') {
      const reviews = db.getContentReviews(launch.id);
      if (reviews.length === 0) return `No content submitted for review yet on ${launch.name}.`;
      return reviews
        .map(r => `• *${r.content_type}:* ${r.status}${r.link ? ` (<${r.link}|link>)` : ''}`)
        .join('\n');
    }
    if (!content_type || !link) return 'A content type and link are required to submit for review.';
    db.submitContentForReview({ launchId: launch.id, contentType: content_type, link, submittedBy: deps.userId });
    await deps.client.chat.postMessage({
      channel: launch.pm_user_id,
      text: `📝 Review requested: ${content_type} for ${launch.name}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `📝 *${content_type} copy ready for review* — ${launch.name}\n<${link}|View draft>` },
        },
        {
          type: 'actions',
          elements: [
            { type: 'button', text: { type: 'plain_text', text: '✅ Approve' }, style: 'primary', action_id: 'content_approve', value: JSON.stringify({ launchId: launch.id, contentType: content_type }) },
            { type: 'button', text: { type: 'plain_text', text: '✏️ Request changes' }, action_id: 'content_changes', value: JSON.stringify({ launchId: launch.id, contentType: content_type }) },
          ],
        },
      ],
    });
    return `Submitted ${content_type} copy for review and notified <@${launch.pm_user_id}>.`;
  },
});

// ─── #8 Legal status tool ─────────────────────────────────────────────────────

const getLegalStatus = tool({
  name: 'get_legal_status',
  description: 'Check current legal/compliance sign-off checklist status for the launch in this channel.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const legalItems = db.getItemsByLaunch(launch.id).filter(i => i.team === 'legal');
    if (legalItems.length === 0) return `No legal checklist items tracked for ${launch.name}.`;
    const now = new Date();
    const lines = legalItems.map(i => {
      const overdue = i.status !== 'done' && i.due_date && new Date(i.due_date) < now;
      const icon = i.status === 'done' ? '✅' : overdue ? '🔴' : '⏳';
      return `${icon} ${i.title}${overdue ? ' *(overdue)*' : ''}`;
    });
    return `⚖️ Legal status for ${launch.name}:\n${lines.join('\n')}`;
  },
});

// ─── #9 PR status tool ────────────────────────────────────────────────────────

const getPrStatus = tool({
  name: 'get_pr_status',
  description: 'Check currently open GitHub PRs for the launch in this channel. Requires the launch to have a linked github_repo.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    if (!launch.github_repo) return `${launch.name} has no linked GitHub repo.`;
    const [owner, repo] = launch.github_repo.split('/');
    try {
      const prs = await getOpenPRs(owner, repo);
      if (prs.length === 0) return `✅ No open PRs on \`${launch.github_repo}\`.`;
      return `🚨 ${prs.length} open PR(s) on \`${launch.github_repo}\`:\n` +
        prs.map(pr => `• <${pr.html_url}|#${pr.number} ${pr.title}>`).join('\n');
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error checking PRs: ${err.message}`;
    }
  },
});

// ─── Go/No-Go tools ───────────────────────────────────────────────────────────

const getGonogoStatus = tool({
  name: 'get_gonogo_status',
  description: 'Check current Go/No-Go readiness for the launch in this channel — green/red/pending counts per item, without posting the canvas.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const items = db.getItemsByLaunch(launch.id);
    const responses = db.getGoNoGoResponses(launch.id);
    const byItem = new Map(responses.map(r => [r.item_id, r.status]));
    const lines = items.map(i => {
      const status = byItem.get(i.id);
      const emoji = status === 'green' ? '🟢' : status === 'red' ? '🔴' : '⚪';
      return `${emoji} ${i.title}${i.owner_id ? ` (<@${i.owner_id}>)` : ''}`;
    });
    const redCount = [...byItem.values()].filter(s => s === 'red').length;
    const pendingCount = items.length - responses.length;
    const decisionLine = launch.gonogo_decision
      ? `\nDecision: *${launch.gonogo_decision.toUpperCase()}* by <@${launch.gonogo_decided_by}>`
      : '';
    return `🚦 Go/No-Go for ${launch.name}: ${redCount} red, ${pendingCount} pending, ${items.length} total.${decisionLine}\n${lines.join('\n')}`;
  },
});

const triggerGonogoCanvas = tool({
  name: 'trigger_gonogo_canvas',
  description: 'Post (or repost) the interactive Go/No-Go checklist canvas into this channel right now, instead of waiting for the T-48h automatic post.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    await postGoNoGoCanvas(deps.client, launch);
    return `Posted the Go/No-Go canvas for ${launch.name}.`;
  },
});

const chaseRedGonogoItems = tool({
  name: 'chase_red_items',
  description: 'Immediately re-DM the owners of every currently-red Go/No-Go item for the launch in this channel.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const count = await chaseRedItems(deps.client, launch);
    if (count === 0) return `No red items to chase for ${launch.name}. ✅`;
    return `Re-nudged owners of ${count} red item(s) for ${launch.name}.`;
  },
});

const requestGonogoOverride = tool({
  name: 'request_gonogo_override',
  description: 'Submit an override request to the PM for a red Go/No-Go item, so it can ship despite not being green. Does not approve it — the PM still clicks the button.',
  parameters: z.object({
    item_title: z.string().describe('The checklist item to request an override for.'),
    reason: z.string().nullable().describe('Optional reason for the override request.'),
  }),
  execute: async ({ item_title, reason }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const item = db.getItemsByLaunch(launch.id).find(
      i => i.title.toLowerCase().includes(item_title.toLowerCase())
    );
    if (!item) return `No item matching "${item_title}" found.`;
    await requestOverride(deps.client, {
      itemId: item.id, launchId: launch.id,
      requestedBy: deps.userId, reason: reason ?? null,
    });
    return `Sent an override request for "${item.title}" to <@${launch.pm_user_id}>.`;
  },
});

const listGonogoOverrides = tool({
  name: 'list_gonogo_overrides',
  description: 'List pending Go/No-Go override requests awaiting a PM decision for the launch in this channel.',
  parameters: z.object({}),
  execute: async (_args, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    const pending = db.getPendingOverridesForLaunch(launch.id);
    if (pending.length === 0) return `No pending overrides for ${launch.name}.`;
    const items = db.getItemsByLaunch(launch.id);
    return pending.map(o => {
      const item = items.find(i => i.id === o.item_id);
      return `• *${item?.title ?? o.item_id}* — requested by <@${o.requested_by}>${o.reason ? `: ${o.reason}` : ''} (id: ${o.id})`;
    }).join('\n');
  },
});

const recordGonogoDecisionTool = tool({
  name: 'record_gonogo_decision',
  description: 'Record the final Go/No-Go decision (go, no_go, or hold) for the launch in this channel and announce it. Only the PM should be making this call.',
  parameters: z.object({
    decision: z.enum(['go', 'no_go', 'hold']),
    share_to_leadership: z.boolean().describe('Set true to also post to the leadership channel.'),
  }),
  execute: async ({ decision, share_to_leadership }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    if (deps.userId !== launch.pm_user_id) {
      return `Only <@${launch.pm_user_id}> (the launch PM) can record the final Go/No-Go decision.`;
    }
    db.recordGonogoDecision({ launchId: launch.id, decision, decidedBy: deps.userId });
    const emoji = { go: '🟢', no_go: '🔴', hold: '🟡' }[decision];
    const text = `${emoji} *Go/No-Go decision for ${launch.name}: ${decision.toUpperCase()}* — called by <@${deps.userId}>`;
    await deps.client.chat.postMessage({ channel: deps.channelId, text });
    if (share_to_leadership && config.LEADERSHIP_CHANNEL_ID) {
      await deps.client.chat.postMessage({ channel: config.LEADERSHIP_CHANNEL_ID, text })
        .catch(err => console.error('[record_gonogo_decision] leadership post failed:', err.message));
    }
    return `Recorded and announced: ${decision.toUpperCase()}.`;
  },
});

const confirmFeatureLive = tool({
  name: 'confirm_feature_live',
  description: 'Mark the launch in this channel as confirmed live and announce it in the channel (and optionally to leadership). Use when someone explicitly confirms the feature has shipped and is working.',
  parameters: z.object({
    share_to_leadership: z.boolean().describe('Set true to also post the announcement to the leadership channel.'),
  }),
  execute: async ({ share_to_leadership }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = db.getLaunchByChannel(deps.channelId);
    if (!launch) return 'No active launch found in this channel.';
    db.confirmLaunchLive({ launchId: launch.id, confirmedBy: deps.userId });
    const text = `🚀 *${launch.name} is live!* Confirmed by <@${deps.userId}>.`;
    await deps.client.chat.postMessage({ channel: deps.channelId, text });
    if (share_to_leadership && config.LEADERSHIP_CHANNEL_ID) {
      await deps.client.chat.postMessage({ channel: config.LEADERSHIP_CHANNEL_ID, text })
        .catch(err => console.error('[confirm_feature_live] leadership post failed:', err.message));
    }
    return `Marked ${launch.name} as live and announced it.`;
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
    openFeedbackPrompt,
    triggerCommsConfirmation,
    getLiveMetricsTool,
    manageBudget,
    manageCsReadiness,
    manageRisk,
    requestBudgetApproval,
    nudgeOwnerTool,
    getSlipRiskStatus,
    escalateItemTool,
    sendStandupNow,
    manageContentReview,
    getLegalStatus,
    getPrStatus,
    getGonogoStatus,
    triggerGonogoCanvas,
    chaseRedGonogoItems,
    requestGonogoOverride,
    listGonogoOverrides,
    recordGonogoDecisionTool,
    confirmFeatureLive,
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
