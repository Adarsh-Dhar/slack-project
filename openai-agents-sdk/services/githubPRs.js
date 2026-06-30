// services/githubPRs.js
// @ts-nocheck

export async function getOpenPRs(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub PR check failed: ${res.status} ${await res.text()}`);
  return res.json(); // array of PR objects
}
