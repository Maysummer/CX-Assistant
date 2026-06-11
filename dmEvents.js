const { supabase } = require("./supabase");
const { loadInstagramAccount, recordDmEvent } = require("./automation");

/**
 * Meta message id for dm_events.ig_event_id (upsert key).
 */
function resolveIgEventId(event) {
  const mid = event?.message?.mid;
  if (typeof mid === "string" && mid.trim()) return mid.trim();
  const senderId = event?.sender?.id;
  const ts = event?.timestamp;
  if (senderId) {
    return `dm_${senderId}_${ts ?? Date.now()}`;
  }
  return null;
}

/** Lynk auth.users.id — required for dashboard Recent activity (RLS). */
async function resolveOwnerUserId(merchantScopedId) {
  const account = await loadInstagramAccount(merchantScopedId);
  return account?.user_id ?? null;
}

/**
 * Log outcome after Gemini sends (or cannot send) a DM.
 * Call this whenever the customer should see sent vs needs-human on the Lynk dashboard.
 */
async function recordAiDmOutcome({
  merchantScopedId,
  event,
  send,
  escalated,
  paused = false,
}) {
  const igEventId = resolveIgEventId(event);
  const ownerUserId = await resolveOwnerUserId(merchantScopedId);

  if (!ownerUserId) {
    console.error(
      `[dmEvents] Cannot log activity: no instagram_accounts row for ig_user_id=${merchantScopedId}. ` +
        "Connect Instagram in Lynk Integrations (same Supabase project).",
    );
    return;
  }
  if (!igEventId) {
    console.error(
      "[dmEvents] Cannot log activity: missing message mid on event payload.",
    );
    return;
  }

  if (send?.ok) {
    await recordDmEvent({
      userId: ownerUserId,
      automationId: null,
      igEventId,
      status: "sent",
      error: escalated
        ? "AI reply sent — owner follow-up created"
        : "AI reply sent",
      payload: event,
    });
    return;
  }

  if (send === null) {
    await recordDmEvent({
      userId: ownerUserId,
      automationId: null,
      igEventId,
      status: "skipped",
      error: paused
        ? "Thread paused — owner handling"
        : "Needs human — Instagram not connected for AI reply",
      payload: event,
    });
    return;
  }

  await recordDmEvent({
    userId: ownerUserId,
    automationId: null,
    igEventId,
    status: "failed",
    error: send?.message ?? "AI reply failed to send",
    payload: event,
  });
}

module.exports = {
  resolveIgEventId,
  resolveOwnerUserId,
  recordAiDmOutcome,
};
