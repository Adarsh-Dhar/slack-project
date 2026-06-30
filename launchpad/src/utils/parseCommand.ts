// src/utils/parseCommand.ts
import type { ParsedLaunchCommand, LaunchTier } from '../types';

const MONTH_MAP: Record<string, number> = {
  january: 1,  february: 2,  march: 3,    april: 4,
  may: 5,      june: 6,      july: 7,     august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4,
  jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDate(raw: string): string {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/([a-zA-Z]+)-(\d+)/);
  if (!match) throw new Error(`Cannot parse date: "${raw}". Use format July-1 or 2025-07-01`);

  const monthNum = MONTH_MAP[match[1].toLowerCase()];
  if (!monthNum) throw new Error(`Unknown month: "${match[1]}"`);

  const day = match[2].padStart(2, '0');
  const month = String(monthNum).padStart(2, '0');
  const year = new Date().getFullYear();

  return `${year}-${month}-${day}`;
}

function parseTier(text: string): LaunchTier {
  const match = text.match(/tier:(major|moderate|minor)/i);
  if (!match) return 'moderate'; // safe default
  return match[1]!.toLowerCase() as LaunchTier;
}

export function parseLaunchCommand(text: string): ParsedLaunchCommand {
  const nameMatch = text.match(/"([^"]+)"/);
  if (!nameMatch) {
    throw new Error('Missing feature name in quotes. Usage: /launch "Feature Name" date:July-1 tier:major ...');
  }
  const featureName = nameMatch[1]!;

  const dateMatch = text.match(/date:([\w-]+)/i);
  if (!dateMatch) {
    throw new Error('Missing date. Usage: date:July-1 or date:2025-07-01');
  }
  const launchDate = parseDate(dateMatch[1]!);

  const tier = parseTier(text);    // NEW

  const mentionedUsers = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map(m => m[1]!);
  const mentionedChannels = [...text.matchAll(/<#([A-Z0-9]+)(?:\|[^>]+)?>/g)].map(m => m[1]!);

  return { featureName, launchDate, tier, mentionedUsers, mentionedChannels };
}
