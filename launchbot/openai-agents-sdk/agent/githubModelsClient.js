import OpenAI from 'openai';

export const githubModelsClient = new OpenAI({
  baseURL: 'https://models.github.ai/inference',
  apiKey: process.env.GITHUB_TOKEN,
  defaultHeaders: { 'X-GitHub-Api-Version': '2022-11-28' },
});
