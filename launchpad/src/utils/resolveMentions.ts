// src/utils/resolveMentions.ts
import type { WebClient } from '@slack/web-api';

/**
 * Slack slash commands don't always auto-convert @username into <@USERID>
 * mentions (this depends on whether the user picked from the autocomplete
 * dropdown). This function catches any leftover plain "@something" text
 * and resolves it against the real user list as a fallback.
 */
export async function resolvePlainMentions(
  client: WebClient,
  text: string,
  alreadyResolvedIds: string[]
): Promise<string[]> {
  // Find plain @word patterns NOT already inside <@...> tags
  const plainMentions = [...text.matchAll(/(?<!<)@([a-zA-Z0-9._-]+)/g)].map(m => m[1]!);
  if (plainMentions.length === 0) return [];

  const result = await client.users.list({});
  const members = result.members ?? [];

  const resolvedIds: string[] = [];
  for (const handle of plainMentions) {
    const user = members.find(
      u =>
        u.name?.toLowerCase() === handle.toLowerCase() ||
        u.profile?.display_name?.toLowerCase() === handle.toLowerCase() ||
        u.real_name?.toLowerCase() === handle.toLowerCase()
    );
    if (user?.id && !alreadyResolvedIds.includes(user.id)) {
      resolvedIds.push(user.id);
    } else if (!user) {
      console.warn(`[resolveMentions] Could not resolve @${handle} to a Slack user.`);
    }
  }
  return resolvedIds;
}
