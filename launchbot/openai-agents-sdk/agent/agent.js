import { Agent, MCPServerStreamableHttp, OpenAIChatCompletionsModel, run, setDefaultOpenAIClient, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';

import { getGitHubModelsClient } from './githubModelsClient.js';
import { addEmojiReaction } from './tools/index.js';
import * as db from '../db/index.js';
import { calculatePhase } from '../services/phaseManager.js';

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

For destructive actions (create_launch, trigger_retro), always use the confirmation tools first — they post a button for the user to click before executing. This prevents accidental channel creation or archiving.

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

const createLaunchConfirmation = tool({
  name: 'create_launch_confirmation',
  description: 'Post a confirmation button to create a new launch. This is a safety measure - the user must click the button to proceed. Does NOT create the launch directly.',
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
  description: 'Post a confirmation button to start a retro for the current channel. This is a safety measure - the user must click the button to proceed.',
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
  tools: [addEmojiReaction, getLaunchStatus, createLaunchConfirmation, triggerRetroConfirmation, syncPhaseStatus],
  model: new OpenAIChatCompletionsModel(githubModelsClient, 'openai/gpt-4o-mini'),
});

/**
 * Run the agent, optionally connecting to the Slack MCP server.
 * @param {string | import('@openai/agents').AgentInputItem[]} inputItems
 * @param {import('./deps.js').AgentDeps} deps
 * @returns {Promise<import('@openai/agents').RunResult<any, any>>}
 */
export async function runAgent(inputItems, deps) {
  if (deps.userToken) {
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

  return await run(starterAgent, inputItems, { context: deps });
}
