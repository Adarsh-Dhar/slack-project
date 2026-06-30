// utils/resolveMentions.js
//
// Catch plain @username mentions that weren't auto-converted to <@U...> format
// by Slack's linkifier (e.g. when typing in a DM or certain contexts).

/**
 * Resolve plain @username mentions to Slack user IDs.
 * @param {import('@slack/web-api').WebClient} client
 * @param {string} text - The command text
 * @param {string[]} alreadyResolved - User IDs already extracted from <@U...> format
 * @returns {Promise<string[]>} - Additional user IDs found via plain @username
 */
export async function resolvePlainMentions(client, text, alreadyResolved) {
  // Find all @username patterns (not already in <@U...> format)
  const plainMentions = [...text.matchAll(/@([a-z0-9._-]+)/gi)].map(m => m[1]);
  
  if (plainMentions.length === 0) return [];

  const additionalIds = [];
  const alreadyResolvedSet = new Set(alreadyResolved);

  for (const username of plainMentions) {
    try {
      // Look up user by username
      const result = await client.users.list({});
      const user = result.members?.find(m => m.name === username);
      
      if (user && user.id && !alreadyResolvedSet.has(user.id)) {
        additionalIds.push(user.id);
        alreadyResolvedSet.add(user.id);
      }
    } catch (err) {
      console.warn(`[resolveMentions] Failed to resolve @${username}:`, err);
    }
  }

  return additionalIds;
}
