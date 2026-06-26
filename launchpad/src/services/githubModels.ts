// src/services/githubModels.ts
// Thin wrapper around the GitHub Models inference API.
// The API is OpenAI-compatible, so the request/response shape is identical
// to what you'd send to api.openai.com — just a different base URL and auth header.

import { config } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Call GPT-4o-mini via GitHub Models.
 *
 * Auth: a GitHub PAT with the `models` scope (classic PAT)
 * or `models:read` permission (fine-grained PAT).
 *
 * Endpoint: https://models.github.ai/inference/chat/completions
 * Header:   X-GitHub-Api-Version: 2022-11-28
 * Model ID: openai/gpt-4o-mini   ← note the "openai/" prefix
 */
export async function callGithubModel(opts: CompletionOptions): Promise<CompletionResult> {
  const response = await fetch(config.GITHUB_MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': config.GITHUB_MODELS_API_VERSION,
    },
    body: JSON.stringify({
      model: config.GITHUB_MODELS_MODEL,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(no body)');
    throw new Error(
      `GitHub Models API error ${response.status}: ${errorBody}`
    );
  }

  const data = await response.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices[0]?.message?.content ?? '';
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return { content, inputTokens, outputTokens };
}
