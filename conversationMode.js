const { getConversationMode, setConversationMode } = require("./supabase");

const HUMAN_ESCALATION_PATTERNS = [
  /\b(speak|talk|chat)\s+(to|with)\s+(the\s+)?(owner|manager|human|person|someone|vendor)\b/i,
  /\b(need|want)\s+(to\s+)?(speak|talk|chat)\s+(to|with)\b/i,
  /\bconnect\s+me\s+(with|to)\s+(the\s+)?(owner|manager|human|vendor)\b/i,
  /\b(owner|manager|human)\s+(please|pls)\b/i,
  /\breal\s+person\b/i,
  /\bstop\s+(the\s+)?bot\b/i,
];

const HANDOFF_ACK =
  "I'm connecting you with the store owner now — they'll reply to you here shortly. I've passed your message along.";

function isHumanEscalationRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return HUMAN_ESCALATION_PATTERNS.some((p) => p.test(t));
}

async function isThreadPaused(merchantScopedId, instagramCustomerId) {
  const mode = await getConversationMode(merchantScopedId, instagramCustomerId);
  if (!mode || mode.mode !== "manual") return false;
  if (!mode.manual_until) return true;
  return new Date(mode.manual_until).getTime() > Date.now();
}

async function pauseForEscalation(merchantScopedId, instagramCustomerId) {
  await setConversationMode(merchantScopedId, instagramCustomerId, "manual", null);
}

module.exports = {
  HANDOFF_ACK,
  isHumanEscalationRequest,
  isThreadPaused,
  pauseForEscalation,
};
