import OpenAI from 'openai';

let client = null;

export function getGitHubModelsClient() {
  if (!client) {
    console.log('[github-models] Initializing client → https://models.github.ai/inference');
    console.log(`[github-models] GITHUB_TOKEN present: ${!!process.env.GITHUB_TOKEN}, length: ${process.env.GITHUB_TOKEN?.length ?? 0}`);
    client = new OpenAI({
      baseURL: 'https://models.github.ai/inference',
      apiKey: process.env.GITHUB_TOKEN,
      defaultHeaders: { 'X-GitHub-Api-Version': '2022-11-28' },
      timeout: 45_000,  // 45s HTTP timeout — prevents silent hangs
      maxRetries: 0,    // never retry — 429s should fail fast, not hang for minutes
    });
  }
  return client;
}
