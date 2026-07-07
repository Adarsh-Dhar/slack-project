// services/canvasBuilder.js
// @ts-nocheck

export const DEFAULT_CHECKLIST = {
  engineering: [
    { title: 'Feature flag enabled', dueOffsetDays: -3 },
    { title: 'Release notes draft', dueOffsetDays: -3 },
    { title: 'Staging smoke test', dueOffsetDays: -2 },
    { title: 'PR merged to main', dueOffsetDays: -1 },
  ],
  marketing: [
    { title: 'Announcement copy written', dueOffsetDays: -4 },
    { title: 'Email blast drafted', dueOffsetDays: -3 },
    { title: 'Social media posts scheduled', dueOffsetDays: -2 },
  ],
  docs: [
    { title: 'Documentation updated', dueOffsetDays: -3 },
    { title: 'Help center article published', dueOffsetDays: -2 },
  ],
  legal: [
    { title: 'Legal sign-off obtained', dueOffsetDays: -5 },
    { title: 'Compliance review complete', dueOffsetDays: -4 },
  ],
  sales: [
    { title: 'Sales briefing sent', dueOffsetDays: -3 },
    { title: 'Demo environment ready', dueOffsetDays: -2 },
    { title: 'Support FAQ / macros drafted', dueOffsetDays: -3 },
    { title: 'CS team briefed on known issues & escalation path', dueOffsetDays: -1 },
  ],
  other: [],
};
