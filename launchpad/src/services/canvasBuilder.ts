// src/services/canvasBuilder.ts
import type { WebClient } from '@slack/web-api';
import type { ItemRow, LaunchRow, DefaultChecklist, ItemStatus } from '../types';

export const DEFAULT_CHECKLIST: DefaultChecklist = {
  engineering: [
    { title: 'Feature flag enabled',   dueOffsetDays: -3 },
    { title: 'Release notes draft',    dueOffsetDays: -3 },
    { title: 'Staging smoke test',     dueOffsetDays: -2 },
    { title: 'PR merged to main',      dueOffsetDays: -1 },
  ],
  marketing: [
    { title: 'Announcement copy written',      dueOffsetDays: -4 },
    { title: 'Email blast drafted',            dueOffsetDays: -3 },
    { title: 'Social media posts scheduled',   dueOffsetDays: -2 },
  ],
  docs: [
    { title: 'Documentation updated',          dueOffsetDays: -3 },
    { title: 'Help center article published',  dueOffsetDays: -2 },
  ],
  legal: [
    { title: 'Legal sign-off obtained',        dueOffsetDays: -5 },
    { title: 'Compliance review complete',     dueOffsetDays: -4 },
  ],
  sales: [
    { title: 'Sales briefing sent',  dueOffsetDays: -3 },
    { title: 'Demo environment ready', dueOffsetDays: -2 },
  ],
  other: [],
};

const STATUS_EMOJI: Record<ItemStatus, string> = {
  done:        '✅',
  in_progress: '🔄',
  not_started: '⬜',
  blocked:     '🚫',
};

const TEAMS = ['engineering', 'marketing', 'docs', 'legal', 'sales'] as const;

export function buildCanvasMarkdown(launch: LaunchRow, items: ItemRow[]): string {
  let md = `# 🚀 Launch Readiness — ${launch.name}\n\n`;
  md += `**Launch Date:** ${launch.launch_date}  \n`;
  md += `**Status:** ${launch.status === 'approved' ? '✅ Approved' : '🔄 In Progress'}  \n`;
  md += `**PM:** <@${launch.pm_user_id}>\n\n---\n\n`;

  for (const team of TEAMS) {
    const teamItems = items.filter(i => i.team === team);
    if (teamItems.length === 0) continue;

    const label = team.charAt(0).toUpperCase() + team.slice(1);
    md += `## ${label}\n\n`;

    for (const item of teamItems) {
      const emoji = STATUS_EMOJI[item.status];
      const owner = item.owner_id ? `<@${item.owner_id}>` : '_unassigned_';
      const due = item.due_date ? ` (due ${item.due_date})` : '';
      md += `${emoji}  ${item.title} — ${owner}${due}\n`;
    }

    md += '\n';
  }

  return md;
}

export async function createLaunchCanvas(
  client: WebClient,
  launch: LaunchRow,
  items: ItemRow[]
): Promise<string> {
  const markdown = buildCanvasMarkdown(launch, items);

  // conversations.canvases.create is typed in @slack/web-api v7+
  const result = await (client as any).conversations.canvases.create({
    channel_id: launch.channel_id,
    document_content: { type: 'markdown', markdown },
  });

  if (!result.ok) throw new Error(`Canvas creation failed: ${String(result.error)}`);
  return (result as { canvas_id: string }).canvas_id;
}

export async function updateLaunchCanvas(
  client: WebClient,
  launch: LaunchRow,
  items: ItemRow[]
): Promise<void> {
  if (!launch.canvas_id) return;

  const markdown = buildCanvasMarkdown(launch, items);

  await client.canvases.edit({
    canvas_id: launch.canvas_id,
    changes: [
      {
        operation: 'replace',
        document_content: { type: 'markdown', markdown },
      },
    ],
  });
}
