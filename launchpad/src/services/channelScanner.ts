// src/services/channelScanner.ts
import type { WebClient } from '@slack/web-api';
import { config } from '../config';
import type { ChannelScanResult, ScanResultsByTeam, StakeholderChannelRow, TeamName } from '../types';

const COMPLETION_KEYWORDS = [
  'merged', 'done', 'shipped', 'complete', 'approved', 'signed off', 'lgtm',
] as const;

export async function scanChannelForFeature(
  client: WebClient,
  channelId: string,
  featureName: string
): Promise<ChannelScanResult | null> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit: config.SCAN_LIMIT,
    });

    const messages = result.messages ?? [];
    const featureLower = featureName.toLowerCase();

    const relevant = messages.filter(
      m => typeof m.text === 'string' && m.text.toLowerCase().includes(featureLower)
    );

    if (relevant.length === 0) return null;

    const hasCompletion = relevant.some(m =>
      COMPLETION_KEYWORDS.some(kw => m.text!.toLowerCase().includes(kw))
    );
    const hasSlip = relevant.some(m =>
      config.SLIP_KEYWORDS.some(kw => m.text!.toLowerCase().includes(kw))
    );

    return {
      messageCount: relevant.length,
      hasCompletion,
      hasSlip,
      latestMessage: relevant[0]?.text?.slice(0, 200) ?? null,
      latestTs: relevant[0]?.ts ?? null,
    };
  } catch (err: unknown) {
    const slackErr = err as { data?: { error?: string } };
    if (
      slackErr.data?.error === 'not_in_channel' ||
      slackErr.data?.error === 'channel_not_found'
    ) {
      return null;
    }
    throw err;
  }
}

export async function scanAllStakeholderChannels(
  client: WebClient,
  stakeholderChannels: StakeholderChannelRow[],
  featureName: string
): Promise<ScanResultsByTeam> {
  const findings: ScanResultsByTeam = {};

  for (const sc of stakeholderChannels) {
    const result = await scanChannelForFeature(client, sc.channel_id, featureName);
    findings[sc.team as TeamName] = result;
    // Small delay to respect Slack rate limits
    await new Promise(r => setTimeout(r, 400));
  }

  return findings;
}
