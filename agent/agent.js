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
import { clusterPendingSignals } from '../services/signalClustering.js';
import { scoreCluster } from '../services/demandValidation.js';
import { draftProblemStatement } from '../services/problemStatement.js';
import { runCompetitiveScan } from '../services/competitiveScan.js';
import { sizeOpportunity } from '../services/opportunitySizing.js';

const SYSTEM_PROMPT = `\
You are LaunchBot, a Slack assistant for product launch management. Be concise, friendly, and helpful.

STYLE: 3 sentences max. Casual tone. Emoji reactions on every message via add_emoji_reaction.

DM/NON-LAUNCH CHANNEL: Tools need feature_name when not in a launch channel. Extract it from the user's message and pass it. Never say "no launch found" if the user named a launch.

LAUNCH CREATION — CRITICAL: When user says create/kick off/start a NEW launch, CALL create_launch_confirmation immediately. Do NOT describe it in text — calling the tool IS what posts the button. Same for wrap up/close/archive → call trigger_retro_confirmation. If you say "I've posted a button" without calling the tool, nothing exists.

SAFE TOOLS (call directly): get_launch_status, get_launch_report, get_launch_portfolio, manage_kpi, open_feedback_prompt, get_live_metrics, manage_budget, manage_cs_readiness, manage_risk, request_budget_approval, nudge_owner, get_slip_risk_status, escalate_item, send_standup_now, manage_content_review, get_legal_status, get_pr_status, get_gonogo_status, trigger_gonogo_canvas, chase_red_items, request_gonogo_override, list_gonogo_overrides, record_gonogo_decision, confirm_feature_live, sync_phase_status, cluster_signals, review_signal_cluster, draft_problem_statement, run_competitive_scan, size_opportunity.

CONFIRMATION REQUIRED (post button first): create_launch_confirmation, trigger_retro_confirmation, trigger_comms_confirmation.`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

// Configure GitHub Models client and disable tracing
const githubModelsClient = getGitHubModelsClient();
setDefaultOpenAIClient(githubModelsClient);
setTracingDisabled(true);

const getLaunchStatus = tool({
  name: 'get_launch_status',
  description: 'Get phase, tier, and channel info for a launch by name, channel name, or channel ID.',
  parameters: z.object({
    feature_identifier: z.string().describe('Feature name, channel name (e.g. launch-feature-y), or channel ID.'),
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
  description: 'Post a status report for a launch (phase, checklist, KPIs, feedback). Pass feature_identifier or omit for current channel.',
  parameters: z.object({
    feature_identifier: z.string().nullable().describe('Feature name, channel name, or ID. Omit to use current channel.'),
    share_to_leadership: z.boolean().describe('Also post to leadership channel (only if user explicitly asks).'),
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
  description: 'Post a snapshot of all active launches. Use for "how are all my launches doing" questions.',
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
  description: 'Set, update, or list KPIs for a launch. action=set (first time), update (new value), list. Pass feature_name from DM.',
  parameters: z.object({
    action: z.enum(['set', 'update', 'list']),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
    name: z.string().nullable().describe('KPI name. Required for set/update.'),
    target_value: z.string().nullable().describe('Target value for set.'),
    unit: z.string().nullable().describe('Unit for set, e.g. "%".'),
    current_value: z.string().nullable().describe('New value for update.'),
  }),
  execute: async ({ action, feature_name, name, target_value, unit, current_value }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage KPIs.';

    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name
        ? `No active launch found for "${feature_name}".`
        : 'No active launch found in this channel. Try passing the feature name, e.g. "set KPI for Test Feature 68".';

      if (action === 'list') {
        const blocks = buildKpiListBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `Success metrics for ${launch.name}`, blocks });
        return `Posted the current success metrics for ${launch.name}.`;
      }

      if (action === 'set') {
        if (!name) return 'A KPI name is required to define a metric.';
        defineKpi({ launchId: launch.id, name, targetValue: target_value ?? null, unit: unit ?? null, updatedBy: deps.userId });
        return `Now tracking "${name}"${target_value ? ` (target: ${target_value}${unit ?? ''})` : ''} for ${launch.name}.`;
      }

      if (action === 'update') {
        if (!name || !current_value) return 'Both a KPI name and a new value are required to update a metric.';
        updateKpiValue({ launchId: launch.id, name, currentValue: current_value, updatedBy: deps.userId });
        return `Updated "${name}" to ${current_value} for ${launch.name}.`;
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
  description: `CALL THIS TOOL immediately when user wants to kick off/start/create a NEW launch. Calling this tool posts the confirmation button. Do not describe it in text.`,
  parameters: z.object({
    feature_name: z.string().describe('The name of the feature (e.g. "New Dashboard")'),
    launch_date: z.string().describe('Launch date ISO (YYYY-MM-DD) or relative (e.g. "30 days").'),
    tier: z.enum(['major', 'moderate', 'minor']),
    mentioned_user_ids: z.array(z.string()).nullable().describe('User IDs from <@U...> mentions.'),
    mentioned_channel_ids: z.array(z.string()).nullable().describe('Channel IDs from <#C...|name> mentions.'),
  }),
  execute: async ({ feature_name, launch_date, tier, mentioned_user_ids, mentioned_channel_ids }, context) => {
    const deps = context?.context;
    if (!deps) {
      return 'No deps available to post confirmation.';
    }

    try {
      console.log(`[create_launch_confirmation] feature="${feature_name}" tier=${tier} date=${launch_date} users=${JSON.stringify(mentioned_user_ids)} channels=${JSON.stringify(mentioned_channel_ids)}`);
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
  description: `CALL THIS TOOL immediately when user wants to wrap up/close/archive an existing launch or start its retro. Posts the confirmation button.`,
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
  description: 'Check or force-sync the phase for a launch, or manually set it to a specific phase.',
  parameters: z.object({
    channel_identifier: z.string().describe('Channel name or ID.'),
    force_sync: z.boolean().optional().describe('Force sync if phase changed.'),
    manual_phase: z.enum(['discovery', 'build', 'prelaunch', 'gonogo', 'launchday']).nullable()
      .describe('Manually override to this phase.'),
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
  description: 'Post a feedback button for a launch. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post the feedback prompt.';
    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Post a confirmation button to send an external announcement (blog/email/social/press). Pass feature_name from DM.',
  parameters: z.object({
    channel: z.enum(['blog', 'email', 'social', 'press']),
    message: z.string().describe('Announcement text.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ channel, message, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to post confirmation.';
    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Fetch live error rate/metrics for a launch from the monitoring provider. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to fetch metrics.';
    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Set, update, or list budget/spend for a launch. Pass feature_name from DM.',
  parameters: z.object({
    action: z.enum(['set', 'update', 'list']),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
    category: z.string().nullable().describe('Budget category. Required for set/update.'),
    approved_amount: z.string().nullable().describe('Approved amount for set.'),
    approver: z.string().nullable().describe('Approver user ID for set.'),
    spent_amount: z.string().nullable().describe('Spent amount for update.'),
  }),
  execute: async ({ action, feature_name, category, approved_amount, approver, spent_amount }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage budget.';
    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
      if (action === 'list') {
        const blocks = buildBudgetListBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `Budget for ${launch.name}`, blocks });
        return `Posted the current budget for ${launch.name}.`;
      }
      if (action === 'set') {
        if (!category) return 'A budget category is required.';
        defineBudgetItem({ launchId: launch.id, category, approvedAmount: approved_amount ?? null, approver: approver ?? null, updatedBy: deps.userId });
        return `Now tracking "${category}"${approved_amount ? ` (approved: ${approved_amount})` : ''} for ${launch.name}.`;
      }
      if (action === 'update') {
        if (!category || !spent_amount) return 'Both a category and a spent amount are required.';
        updateSpend({ launchId: launch.id, category, spentAmount: spent_amount, updatedBy: deps.userId });
        return `Updated "${category}" spend to ${spent_amount} for ${launch.name}.`;
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
  description: 'Set or list CS/support readiness items for a launch. Pass feature_name from DM.',
  parameters: z.object({
    action: z.enum(['set', 'list']),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
    item: z.string().nullable().describe('Item name. Required for set.'),
    link: z.string().nullable().describe('URL for set.'),
    status: z.enum(['not_started', 'in_progress', 'done']).nullable().describe('Status for set.'),
  }),
  execute: async ({ action, feature_name, item, link, status }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage CS readiness.';
    try {
      const launch = await resolveLaunchForDeps(feature_name, deps);
      if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
      if (action === 'list') {
        const blocks = buildCsReadinessBlocks(launch.id, launch.name);
        await deps.client.chat.postMessage({ channel: deps.channelId, text: `CS readiness for ${launch.name}`, blocks });
        return `Posted CS readiness items for ${launch.name}.`;
      }
      if (action === 'set') {
        if (!item) return 'An item name is required.';
        setCsReadinessItem({ launchId: launch.id, item, link: link ?? null, status: status ?? 'not_started', updatedBy: deps.userId });
        return `Tracked CS readiness item "${item}"${status ? ` (${status})` : ''} for ${launch.name}.`;
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
  description: 'Log or list risk assessments for a launch. Pass feature_name from DM.',
  parameters: z.object({
    action: z.enum(['set', 'list']),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
    category: z.enum(['technical', 'legal', 'market_timing', 'other']).nullable().describe('Required for set.'),
    level: z.enum(['low', 'medium', 'high']).nullable().describe('Required for set.'),
    note: z.string().nullable().describe('Optional note.'),
  }),
  execute: async ({ action, feature_name, category, level, note }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage risk.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';

    if (action === 'list') {
      const blocks = buildRiskBlocks(launch.id, launch.name);
      await deps.client.chat.postMessage({ channel: deps.channelId, text: `Risk assessment for ${launch.name}`, blocks });
      return `Posted the current risk assessment for ${launch.name}.`;
    }
    if (!category || !level) return 'A category and level are required to log a risk.';
    setRiskItem({ launchId: launch.id, category, level, note: note ?? null, updatedBy: deps.userId });
    return `Logged ${level} ${category} risk for ${launch.name}${note ? `: ${note}` : ''}.`;
  },
});

// ─── #2 Budget approval tool ──────────────────────────────────────────────────

const requestBudgetApproval = tool({
  name: 'request_budget_approval',
  description: 'Send a budget category to the PM for sign-off. Pass feature_name from DM.',
  parameters: z.object({
    category: z.string().describe('Budget category to approve.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ category, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to request approval.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'DM the owner of an open checklist item. Pass feature_name from DM.',
  parameters: z.object({
    item_title: z.string().describe('Checklist item title or close match.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ item_title, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to nudge owner.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'List open slip-risk alerts for a launch. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    const events = db.getOpenSlipEvents(launch.id);
    if (events.length === 0) return `No open slip-risk alerts for ${launch.name}. ✅`;
    return `⚠️ ${events.length} open slip-risk alert(s) for ${launch.name}:\n` +
      events.map(e => `• <@${e.detected_user_id}>: "${e.message_text?.slice(0, 100)}" (${e.status})`).join('\n');
  },
});

// ─── #5 Escalate item tool ────────────────────────────────────────────────────

const escalateItemTool = tool({
  name: 'escalate_item',
  description: 'Post an escalation tagging the PM about a stuck checklist item. Pass feature_name from DM.',
  parameters: z.object({
    item_title: z.string().describe('Checklist item title to escalate.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ item_title, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to escalate.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Send daily check-in DMs to all item owners now. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to send standups.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    const count = await sendStandupForLaunch(deps.client, launch);
    return `Sent standup check-ins to ${count} owner(s) for ${launch.name}.`;
  },
});

// ─── #7 Content review tool ───────────────────────────────────────────────────

const manageContentReview = tool({
  name: 'manage_content_review',
  description: 'Submit (action=submit) or list (action=list) marketing/docs/sales copy for review. Pass feature_name from DM.',
  parameters: z.object({
    action: z.enum(['submit', 'list']),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
    content_type: z.enum(['marketing', 'docs', 'sales']).nullable().describe('Required for submit.'),
    link: z.string().nullable().describe('Doc URL. Required for submit.'),
  }),
  execute: async ({ action, feature_name, content_type, link }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available to manage content review.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';

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
  description: 'Check legal/compliance sign-off status for a launch. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Check open GitHub PRs for a launch (requires linked github_repo). Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Check Go/No-Go readiness counts for a launch. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Post the Go/No-Go checklist canvas now. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    await postGoNoGoCanvas(deps.client, launch);
    return `Posted the Go/No-Go canvas for ${launch.name}.`;
  },
});

const chaseRedGonogoItems = tool({
  name: 'chase_red_items',
  description: 'Re-DM owners of red Go/No-Go items. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    const count = await chaseRedItems(deps.client, launch);
    if (count === 0) return `No red items to chase for ${launch.name}. ✅`;
    return `Re-nudged owners of ${count} red item(s) for ${launch.name}.`;
  },
});

const requestGonogoOverride = tool({
  name: 'request_gonogo_override',
  description: 'Submit an override request to the PM for a red Go/No-Go item. Pass feature_name from DM.',
  parameters: z.object({
    item_title: z.string().describe('Item title to override.'),
    reason: z.string().nullable().describe('Optional reason.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ item_title, reason, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'List pending Go/No-Go override requests for a launch. Pass feature_name from DM.',
  parameters: z.object({
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
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
  description: 'Record the final Go/No-Go decision and announce it. PM only. Pass feature_name from DM.',
  parameters: z.object({
    decision: z.enum(['go', 'no_go', 'hold']),
    share_to_leadership: z.boolean().describe('Also post to leadership channel.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ decision, share_to_leadership, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    if (deps.userId !== launch.pm_user_id) {
      return `Only <@${launch.pm_user_id}> (the launch PM) can record the final Go/No-Go decision.`;
    }
    db.recordGonogoDecision({ launchId: launch.id, decision, decidedBy: deps.userId });
    const emoji = { go: '🟢', no_go: '🔴', hold: '🟡' }[decision];
    const text = `${emoji} *Go/No-Go decision for ${launch.name}: ${decision.toUpperCase()}* — called by <@${deps.userId}>`;
    await deps.client.chat.postMessage({ channel: launch.channel_id, text });
    if (share_to_leadership && config.LEADERSHIP_CHANNEL_ID) {
      await deps.client.chat.postMessage({ channel: config.LEADERSHIP_CHANNEL_ID, text })
        .catch(err => console.error('[record_gonogo_decision] leadership post failed:', err.message));
    }
    return `Recorded and announced: ${decision.toUpperCase()}.`;
  },
});

const confirmFeatureLive = tool({
  name: 'confirm_feature_live',
  description: 'Mark a launch as live and announce it. Pass feature_name from DM.',
  parameters: z.object({
    share_to_leadership: z.boolean().describe('Also post to leadership channel.'),
    feature_name: z.string().nullable().describe('Launch name — required from DM/non-launch channel.'),
  }),
  execute: async ({ share_to_leadership, feature_name }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    const launch = await resolveLaunchForDeps(feature_name, deps);
    if (!launch) return feature_name ? `No active launch found for "${feature_name}".` : 'No active launch found in this channel. Try passing the feature name.';
    db.confirmLaunchLive({ launchId: launch.id, confirmedBy: deps.userId });
    const text = `🚀 *${launch.name} is live!* Confirmed by <@${deps.userId}>.`;
    await deps.client.chat.postMessage({ channel: launch.channel_id, text });
    if (share_to_leadership && config.LEADERSHIP_CHANNEL_ID) {
      await deps.client.chat.postMessage({ channel: config.LEADERSHIP_CHANNEL_ID, text })
        .catch(err => console.error('[confirm_feature_live] leadership post failed:', err.message));
    }
    return `Marked ${launch.name} as live and announced it.`;
  },
});

// ─── Signal intake & demand validation tools ─────────────────────────────────
// Not launch-scoped (no resolveLaunchForDeps) — same reasoning as
// getLaunchPortfolio. Signals exist to help decide whether a launch should
// exist yet, so there's no launch to resolve against.

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
        const result = scoreCluster(cluster_id);
        return `Cluster #${cluster_id} rescored: confidence ${result.confidenceScore} (${result.confidenceLabel}), reach ${result.reachCount}, ${result.eventCount} event(s).`;
      }
      db.updateClusterStatus(cluster_id, action === 'validate' ? 'validated' : 'dismissed');
      return `Cluster #${cluster_id} marked as ${action === 'validate' ? 'validated' : 'dismissed'}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error reviewing cluster: ${err.message}`;
    }
  },
});

// ─── Problem definition tools ────────────────────────────────────────────────
// All three read/write cluster-scoped tables, not launch-scoped — same
// reasoning as the signal tools above.

const draftProblemStatementTool = tool({
  name: 'draft_problem_statement',
  description:
    'Draft a crisp, testable problem statement for a signal cluster, tied to a measurable outcome. ' +
    'This is a DRAFT for a PM to edit — never present it as final or already agreed.',
  parameters: z.object({ cluster_id: z.number() }),
  execute: async ({ cluster_id }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    try {
      const { draftText, version } = draftProblemStatement(cluster_id, 'agent');
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `Problem statement draft for cluster #${cluster_id}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Problem statement — v${version} (draft)*\n\n${draftText}` } }],
      });
      return `Posted draft v${version} for cluster #${cluster_id}. It's a draft — flag to the PM that it needs review, not approval by default.`;
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
    'then runs a bounded, cited web search only for competitors not already covered. Never claim a competitor ' +
    'lacks a capability without a citation — say "unknown" instead.',
  parameters: z.object({ cluster_id: z.number() }),
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
        text: `Competitive scan — cluster #${cluster_id}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Competitive scan — cluster #${cluster_id}*\n${lines.join('\n') || '_No evidence found._'}` } }],
      });
      return `Posted competitive scan for cluster #${cluster_id}: ${rows.length} row(s) of evidence.`;
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
    'Never state a single number — always the range plus the method it came from.',
  parameters: z.object({ cluster_id: z.number() }),
  execute: async ({ cluster_id }, context) => {
    const deps = context?.context;
    if (!deps) return 'No deps available.';
    try {
      const { lowEstimate, highEstimate, basisNote } = sizeOpportunity(cluster_id);
      const highText = highEstimate != null ? `$${Math.round(highEstimate).toLocaleString()}` : 'not available';
      await deps.client.chat.postMessage({
        channel: deps.channelId,
        text: `Opportunity size — cluster #${cluster_id}`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Opportunity size — cluster #${cluster_id}*\nLow: $${Math.round(lowEstimate).toLocaleString()} • High: ${highText}\n\n_${basisNote}_`,
          },
        }],
      });
      return `Posted opportunity size for cluster #${cluster_id}.`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Error sizing opportunity: ${err.message}`;
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
    console.log(`[agent]   calling ${deps.userToken ? 'runAgentWithMcp' : 'run(starterAgent)'} ...`);

    const agentRun = deps.userToken
      ? runAgentWithMcp(inputItems, deps)
      : run(starterAgent, inputItems, { context: deps });

    const result = await Promise.race([agentRun, timeout]);
    clearTimeout(timeoutHandle);

    const elapsedMs = Date.now() - startMs;
    const toolCalls = result.newItems?.filter(i => i.type === 'tool_call_item') ?? [];
    const toolNames = toolCalls.map(i => i.name ?? '(unnamed)');

    console.log(`[agent] ◀ DONE  | elapsed=${elapsedMs}ms tool_calls=${toolCalls.length} tools=[${toolNames.join(', ')}]`);
    console.log(`[agent]   finalOutput: "${String(result.finalOutput ?? '').slice(0, 200)}"`);

    // Guardrail: warn when the LLM described an action without calling the tool
    const output = String(result.finalOutput ?? '').toLowerCase();
    const launchKeywords = ['kick off', 'kickoff', 'launch', 'create', 'start'];
    const descriptionPatterns = ["i've set up", "i have set up", "i've posted", "i have posted", "confirmation button", "i'll post", "i will post"];
    const saidItDidSomething = descriptionPatterns.some(p => output.includes(p));
    const userAskedForLaunch = typeof inputItems === 'string'
      ? launchKeywords.some(k => inputItems.toLowerCase().includes(k))
      : launchKeywords.some(k => JSON.stringify(inputItems).toLowerCase().includes(k));
    const calledLaunchTool = toolNames.some(n => n === 'create_launch_confirmation' || n === 'trigger_retro_confirmation');

    if (userAskedForLaunch && saidItDidSomething && !calledLaunchTool) {
      console.warn(`[agent] ⚠️  GUARDRAIL: LLM described posting a button without calling the tool! tool_calls=[${toolNames.join(', ')}] output="${output.slice(0, 150)}"`);
    }

    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    const elapsedMs = Date.now() - startMs;

    // Detect GitHub Models rate limit (429) and surface a clear message
    const is429 = err.status === 429 || err.message?.includes('429') || err.message?.toLowerCase().includes('too many requests');
    if (is429) {
      const retryAfterSec = err.headers?.['retry-after'] ?? err.headers?.get?.('retry-after');
      const waitHours = retryAfterSec ? Math.ceil(retryAfterSec / 3600) : null;
      const waitMsg = waitHours ? ` Daily quota resets in ~${waitHours}h.` : ' Daily quota may be exhausted.';
      console.error(`[agent] ✖ RATE_LIMITED (429) | elapsed=${elapsedMs}ms model=openai/gpt-4.1-mini${retryAfterSec ? ` retry-after=${retryAfterSec}s` : ''}`);
      const userErr = new Error(`:x: GitHub Models rate limit hit (429).${waitMsg} Try again later or contact the bot admin.`);
      userErr.retryAfterSec = retryAfterSec ? Number(retryAfterSec) : null;
      throw userErr;
    }

    // Detect 413 (request too large) — usually means tool definitions are too big for the model
    const is413 = err.status === 413 || err.message?.includes('413');
    if (is413) {
      console.error(`[agent] ✖ REQUEST_TOO_LARGE (413) | elapsed=${elapsedMs}ms`);
      const userErr = new Error(`:x: The request was too large for the model. Try a simpler message or contact the bot admin.`);
      throw userErr;
    }

    console.error(`[agent] ✖ ERROR | elapsed=${elapsedMs}ms status=${err.status ?? 'n/a'} error="${err.message}"`);
    console.error('[agent]   stack:', err.stack);
    throw err;
  }
}

async function runAgentWithMcp(inputItems, deps) {
  console.log(`[agent:mcp] Connecting to Slack MCP server: ${SLACK_MCP_URL}`);
  const mcpServer = new MCPServerStreamableHttp({
    url: SLACK_MCP_URL,
    requestInit: { headers: { Authorization: `Bearer ${deps.userToken}` } },
  });

  try {
    await mcpServer.connect();
    console.log(`[agent:mcp] Connected. Cloning agent with MCP tools.`);
    const agentWithMcp = starterAgent.clone({ mcpServers: [mcpServer] });
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
