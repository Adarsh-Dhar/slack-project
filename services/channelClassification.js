// Channel classification rules
// Maps source_type keywords to match against channel names/topics
export const CHANNEL_CLASSIFICATION_RULES = {
  support_ticket: ['support', 'ticket', 'help', 'issue', 'bug'],
  sales_feedback: ['sales', 'feedback', 'deal', 'opportunity', 'crm'],
  user_interview: ['interview', 'user', 'customer', 'voice', 'research'],
  analytics: ['analytics', 'metric', 'data', 'insight', 'report'],
  churn: ['churn', 'cancellation', 'attrition', 'lost', 'exit'],
};

/**
 * Classify a channel by name/topic using keyword matching
 * @param {string} channelName
 * @returns {string | null} - source_type or null if no match
 */
export function classifyChannel(channelName) {
  const lowerName = channelName.toLowerCase();
  for (const [sourceType, keywords] of Object.entries(CHANNEL_CLASSIFICATION_RULES)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return sourceType;
    }
  }
  return null;
}
