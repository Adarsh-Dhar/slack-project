// src/handlers/agent.ts
// Registers the /agent slash command.
// Usage: /agent <any question>
// The bot replies with GPT-4o-mini's answer via GitHub Models.

import type { App } from '@slack/bolt';
import { callGithubModel } from '../services/githubModels';

const SYSTEM_PROMPT = `You are LaunchPad, an AI agent embedded in Slack that helps teams coordinate product launches.
You are concise, direct, and practical. You speak like a senior PM, not a chatbot.
Formatting rules:
- Plain text only — no markdown headers (# ##), no bold asterisks (**).
- Use bullet points with the • character if listing things.
- Keep responses under 200 words unless the user explicitly asks for more detail.`;

export function registerAgentCommand(app: App): void {
  app.command('/agent', async ({ command, ack, client }) => {
    await ack();

    const userMessage = command.text.trim();

    // Guard: empty input
    if (!userMessage) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `Usage: \`/agent <your question>\`\nExample: \`/agent what should I do 48h before a launch?\``,
      });
      return;
    }

    // Post a visible "thinking" message so the channel doesn't feel dead
    const thinking = await client.chat.postMessage({
      channel: command.channel_id,
      text: `<@${command.user_id}> asked: _${userMessage}_\n\n🤔 Thinking...`,
    });

    try {
      const result = await callGithubModel({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      });

      await client.chat.update({
        channel: command.channel_id,
        ts: thinking.ts!,
        text: `<@${command.user_id}> asked: _${userMessage}_\n\n*LaunchPad AI* 🤖\n\n${result.content}\n\n_Model: gpt-4o-mini via GitHub Models • ${result.inputTokens} in / ${result.outputTokens} out tokens_`,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/agent] Error:', message);

      await client.chat.update({
        channel: command.channel_id,
        ts: thinking.ts!,
        text: `❌ Agent error: ${message}`,
      });
    }
  });
}
