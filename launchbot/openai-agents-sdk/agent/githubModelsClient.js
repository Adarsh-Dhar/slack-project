import OpenAI from 'openai';

let client = null;

export function getGitHubModelsClient() {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://models.github.ai/inference',
      apiKey: process.env.GITHUB_TOKEN,
      defaultHeaders: { 'X-GitHub-Api-Version': '2022-11-28' },
    });
  }
  return client;
}
