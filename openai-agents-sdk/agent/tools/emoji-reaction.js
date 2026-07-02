import { tool } from '@openai/agents';
import { z } from 'zod';

const EMOJI_DESCRIPTION =
  "React to the user's message with a relevant Slack emoji. " +
  "Pick one that matches the topic or tone (e.g. dog→dog, launch→rocket, broken→wrench). " +
  "Be creative. Don't repeat emojis in the same thread.";

/** Emoji reaction tool for the starter agent. */
export const addEmojiReaction = tool({
  name: 'add_emoji_reaction',
  description: EMOJI_DESCRIPTION,
  parameters: z.object({
    emoji_name: z.string().describe("The Slack emoji name without colons (e.g. 'tada', 'wrench', 'pray')."),
  }),
  execute: async ({ emoji_name }, context) => {
    const deps = /** @type {import('../deps.js').AgentDeps} */ (context?.context);

    // Skip ~15% of reactions to feel more natural
    if (Math.random() < 0.15) {
      return `Skipped :${emoji_name}: reaction (randomly omitted to avoid over-reacting)`;
    }

    try {
      await deps.client.reactions.add({
        channel: deps.channelId,
        timestamp: deps.messageTs,
        name: emoji_name,
      });
      return `Reacted with :${emoji_name}:`;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return `Could not add reaction: ${err.data?.error || err.message}`;
    }
  },
});
