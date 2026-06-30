// src/services/githubPRs.ts
//
// Thin wrapper around the GitHub REST API (via Octokit) for checking
// open pull requests on a launch's linked repo. Separate from
// githubModels.ts, which talks to GitHub Models (the LLM inference
// endpoint) and has nothing to do with the REST API or PRs.

import { Octokit } from '@octokit/rest';
import { config } from '../config';

const octokit = new Octokit({ auth: config.GITHUB_TOKEN });

export interface OpenPR {
  number: number;
  title: string;
  url: string;
  author: string;
}

/**
 * List open PRs for a "owner/repo" string. Returns [] (rather than throwing)
 * if the repo is malformed or the API call fails, so callers can treat a
 * failed check as "nothing to report" instead of crashing the cron loop.
 */
export async function getOpenPRs(repo: string): Promise<OpenPR[]> {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.warn(`[githubPRs] Malformed repo string: "${repo}", expected "org/repo"`);
    return [];
  }
  const [owner, name] = parts;

  try {
    const { data } = await octokit.pulls.list({
      owner,
      repo: name,
      state: 'open',
      per_page: 50,
    });

    return data.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login ?? 'unknown',
    }));
  } catch (err) {
    console.error(`[githubPRs] Failed to list PRs for ${repo}:`, err);
    return [];
  }
}
