// services/webSearch.js
// @ts-nocheck
//
// Thin, swappable web search wrapper. This project's agent runs on
// @openai/agents against GitHub Models, not Anthropic's Claude — so there's
// no built-in web_search tool to call. This file gives run_competitive_scan
// ONE function to call; swap the implementation (Bing, Serper, Tavily,
// whatever you already pay for) without touching the calling code.
//
// Reference implementation below uses Tavily (https://tavily.com) because
// its API is a single POST call with no extra setup — but it is NOT wired
// to a real account here. You must set TAVILY_API_KEY yourself.
//
// Contract: searchWeb(query) resolves to an array of { title, url, snippet }
// or throws. Callers MUST treat a thrown error / empty array as "no evidence
// found" — never as "the competitor definitely lacks this capability".
// Absence of a search result is not evidence of absence.

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export async function searchWeb(query, { maxResults = 3 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No web search provider configured (TAVILY_API_KEY missing). ' +
      'Competitive scan will proceed with own-data evidence only.'
    );
  }

  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });

  if (!response.ok) {
    throw new Error(`Web search request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
}
