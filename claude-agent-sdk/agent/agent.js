import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
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

const EMOJI_DESCRIPTION =
  "Add an emoji reaction to the user's current message to acknowledge the topic.\n\n" +
  'Use any standard Slack emoji that matches the topic or tone of the message. ' +
  'Be creative and specific — if someone mentions a dog, use `dog`; if they sound ' +
  'frustrated, use `sweat_smile`. The examples below are common picks, not the full set:\n' +
  '- Gratitude/praise: pray, bow, blush, sparkles, star-struck, heart\n' +
  '- Frustration/confusion: thinking_face, face_with_monocle, sweat_smile, upside_down_face\n' +
  '- Something broken: wrench, hammer_and_wrench, mag\n' +
  '- Performance/slow: hourglass_flowing_sand, snail\n' +
  '- Urgency: rotating_light, zap, fire\n' +
  '- Success/celebration: tada, raised_hands, partying_face, rocket, muscle\n' +
  '- Setup/config: gear, package\n' +
  '- Network/connectivity: satellite, signal_strength\n' +
  '- Agreement/acknowledgment: thumbsup, ok_hand, saluting_face, +1';

/** @type {string[]} */
const ALLOWED_TOOLS = ['add_emoji_reaction', 'get_launch_status', 'create_launch_confirmation', 'trigger_retro_confirmation', 'sync_phase_status'];

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

/**
 * @typedef {Object} AgentDeps
 * @property {import('@slack/web-api').WebClient} client
 * @property {string} userId
 * @property {string} channelId
 * @property {string} threadTs
 * @property {string} messageTs
 * @property {string} [userToken]
 */

/**
 * Run the agent with the given text and optional session ID.
 * @param {string} text - The user's message text.
 * @param {string} [sessionId] - An existing session ID to resume conversation.
 * @param {AgentDeps} [deps] - Dependencies for tools that need Slack API access.
 * @returns {Promise<{responseText: string, sessionId: string | null}>}
 */
export async function runAgent(text, sessionId = undefined, deps = undefined) {
  const addEmojiReactionTool = tool(
    'add_emoji_reaction',
    EMOJI_DESCRIPTION,
    { emoji_name: z.string().describe("The Slack emoji name without colons (e.g. 'tada', 'wrench', 'pray').") },
    async ({ emoji_name }) => {
      if (!deps) {
        return { content: [{ type: 'text', text: 'No deps available to add reaction.' }] };
      }

      // Skip ~15% of reactions to feel more natural
      if (Math.random() < 0.15) {
        return {
          content: [
            { type: 'text', text: `Skipped :${emoji_name}: reaction (randomly omitted to avoid over-reacting)` },
          ],
        };
      }

      try {
        await deps.client.reactions.add({
          channel: deps.channelId,
          timestamp: deps.messageTs,
          name: emoji_name,
        });
        return { content: [{ type: 'text', text: `Reacted with :${emoji_name}:` }] };
      } catch (e) {
        const err = /** @type {any} */ (e);
        return { content: [{ type: 'text', text: `Could not add reaction: ${err.data?.error || err.message}` }] };
      }
    },
  );

  const getLaunchStatusTool = tool(
    'get_launch_status',
    'Get the current status of a launch by channel name or ID. Returns phase, tier, launch date, and channel info.',
    {
      channel_identifier: z.string().describe('The channel name (e.g. launch-feature-x) or channel ID'),
    },
    async ({ channel_identifier }) => {
      if (!deps) {
        return { content: [{ type: 'text', text: 'No deps available to check launch status.' }] };
      }

      try {
        // Try to find launch by channel ID first, then by name
        let launch = db.getLaunchByChannel(channel_identifier);
        
        if (!launch && channel_identifier.startsWith('C')) {
          // It's a channel ID, try direct lookup
          launch = db.getLaunchByChannel(channel_identifier);
        }

        if (!launch) {
          // Try to resolve channel name to ID
          const channelInfo = await deps.client.conversations.info({ channel: channel_identifier });
          if (channelInfo.channel) {
            launch = db.getLaunchByChannel(channelInfo.channel.id);
          }
        }

        if (!launch) {
          return { content: [{ type: 'text', text: `No active launch found for channel: ${channel_identifier}` }] };
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

        return { content: [{ type: 'text', text: statusText }] };
      } catch (e) {
        const err = /** @type {any} */ (e);
        return { content: [{ type: 'text', text: `Error checking launch status: ${err.message}` }] };
      }
    },
  );

  const createLaunchConfirmationTool = tool(
    'create_launch_confirmation',
    'Post a confirmation button to create a new launch. This is a safety measure - the user must click the button to proceed. Does NOT create the launch directly.',
    {
      feature_name: z.string().describe('The name of the feature (e.g. "New Dashboard")'),
      launch_date: z.string().describe('Launch date in ISO format (YYYY-MM-DD) or Month-Day (e.g. July-1)'),
      tier: z.enum(['major', 'moderate', 'minor']).describe('Launch tier: major, moderate, or minor'),
    },
    async ({ feature_name, launch_date, tier }) => {
      if (!deps) {
        return { content: [{ type: 'text', text: 'No deps available to post confirmation.' }] };
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

        return { content: [{ type: 'text', text: `Posted confirmation button for launch: ${feature_name}` }] };
      } catch (e) {
        const err = /** @type {any} */ (e);
        return { content: [{ type: 'text', text: `Error posting confirmation: ${err.message}` }] };
      }
    },
  );

  const triggerRetroConfirmationTool = tool(
    'trigger_retro_confirmation',
    'Post a confirmation button to start a retro for the current channel. This is a safety measure - the user must click the button to proceed.',
    {},
    async () => {
      if (!deps) {
        return { content: [{ type: 'text', text: 'No deps available to post confirmation.' }] };
      }

      try {
        const launch = db.getLaunchByChannel(deps.channelId);
        
        if (!launch) {
          return { content: [{ type: 'text', text: `No active launch found in this channel.` }] };
        }

        if (launch.status === 'archived') {
          return { content: [{ type: 'text', text: `This launch has already been archived.` }] };
        }

        if (launch.status === 'retro_pending') {
          return { content: [{ type: 'text', text: `Retro has already been scheduled. Click the "Start Retro" button in the channel.` }] };
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

        return { content: [{ type: 'text', text: `Posted confirmation button for retro.` }] };
      } catch (e) {
        const err = /** @type {any} */ (e);
        return { content: [{ type: 'text', text: `Error posting confirmation: ${err.message}` }] };
      }
    },
  );

  const syncPhaseStatusTool = tool(
    'sync_phase_status',
    'Check the phase sync status for a launch. Optionally force sync with confirmation if the phase has changed.',
    {
      channel_identifier: z.string().describe('The channel name or ID'),
      force_sync: z.boolean().optional().describe('Set to true to force phase sync with confirmation'),
    },
    async ({ channel_identifier, force_sync = false }) => {
      if (!deps) {
        return { content: [{ type: 'text', text: 'No deps available to check phase status.' }] };
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
          return { content: [{ type: 'text', text: `No active launch found for channel: ${channel_identifier}` }] };
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

        return { content: [{ type: 'text', text: statusText }] };
      } catch (e) {
        const err = /** @type {any} */ (e);
        return { content: [{ type: 'text', text: `Error checking phase status: ${err.message}` }] };
      }
    },
  );

  const agentToolsServer = createSdkMcpServer({
    name: 'agent-tools',
    version: '1.0.0',
    tools: [addEmojiReactionTool, getLaunchStatusTool, createLaunchConfirmationTool, triggerRetroConfirmationTool, syncPhaseStatusTool],
  });

  /** @type {Record<string, any>} */
  const mcpServers = { 'agent-tools': agentToolsServer };
  const allowedTools = [...ALLOWED_TOOLS];

  if (deps?.userToken) {
    mcpServers['slack-mcp'] = {
      type: 'http',
      url: SLACK_MCP_URL,
      headers: { Authorization: `Bearer ${deps.userToken}` },
    };
    allowedTools.push('mcp__slack-mcp__*');
  }

  /** @type {import('@anthropic-ai/claude-agent-sdk').Options} */
  const options = {
    systemPrompt: SYSTEM_PROMPT,
    mcpServers,
    allowedTools,
    permissionMode: 'bypassPermissions',
    ...(sessionId && { resume: sessionId }),
  };

  const responseParts = [];
  let newSessionId = null;

  for await (const message of query({ prompt: text, options })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          responseParts.push(block.text);
        }
      }
    }
    if (message.type === 'result') {
      newSessionId = message.session_id;
    }
  }

  const responseText = responseParts.join('\n');
  return { responseText, sessionId: newSessionId };
}
