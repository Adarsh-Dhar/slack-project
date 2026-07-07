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

/**
 * Catch plain #channel-name mentions that weren't auto-converted to
 * <#C...|name> format by Slack's linkifier — same problem as
 * resolvePlainMentions above, but for channels instead of users. This
 * happens whenever someone types "#channel-name" and hits enter without
 * picking the channel from Slack's autocomplete dropdown.
 *
 * @param {import('@slack/web-api').WebClient} client
 * @param {string} text - The command text
 * @param {string[]} alreadyResolved - Channel IDs already extracted from <#C...> format
 * @returns {Promise<string[]>} - Additional channel IDs found via plain #channel-name
 */
export async function resolvePlainChannelMentions(client, text, alreadyResolved) {
  const plainMentions = [...text.matchAll(/#([a-z0-9_-]+)/gi)].map(m => m[1].toLowerCase());

  if (plainMentions.length === 0) return [];

  const additionalIds = [];
  const alreadyResolvedSet = new Set(alreadyResolved);

  try {
    // Paginate through all channels the bot can see (public + private it's
    // already a member of). conversations.list caps at 1000/page.
    let cursor;
    const allChannels = [];
    do {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 1000,
        cursor,
      });
      allChannels.push(...(result.channels ?? []));
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    for (const name of plainMentions) {
      const match = allChannels.find(c => c.name === name);
      if (match?.id && !alreadyResolvedSet.has(match.id)) {
        additionalIds.push(match.id);
        alreadyResolvedSet.add(match.id);
      }
    }
  } catch (err) {
    console.warn('[resolveMentions] Failed to resolve plain channel mentions:', err);
  }

  return additionalIds;
}
