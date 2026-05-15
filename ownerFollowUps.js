/**
 * Topic 2 — reminders for the SME owner (deliverables, follow-ups).
 * Customer never sees these rows directly; the bank app / merchant dashboard
 * (fed by Topic 1 or a GTCO SME console) should poll or subscribe to notify the owner.
 */

const { insertOwnerFollowUp } = require('./supabase');

const OWNER_TASK_PREFIX = 'OWNER_TASK:';

/**
 * @param {string} fullReply — model output before stripping
 * @returns {{ customerText: string, tasks: string[] }}
 */
function extractOwnerTasks(fullReply) {
  const lines = fullReply.split('\n');
  const tasks = [];
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(OWNER_TASK_PREFIX)) {
      tasks.push(t.slice(OWNER_TASK_PREFIX.length).trim());
    } else {
      kept.push(line);
    }
  }
  return { customerText: kept.join('\n').trim(), tasks };
}

/**
 * Persist owner reminders; strip OWNER_TASK lines from the DM the customer receives.
 */
async function persistOwnerTasks(merchantScopedId, instagramCustomerId, tasks) {
  for (const summary of tasks) {
    if (!summary) continue;
    await insertOwnerFollowUp(merchantScopedId, instagramCustomerId, summary);
    console.info(
      `[OWNER_TASK] merchant=${merchantScopedId} customer=${instagramCustomerId} summary=${JSON.stringify(summary)}`
    );
  }
}

module.exports = {
  OWNER_TASK_PREFIX,
  extractOwnerTasks,
  persistOwnerTasks,
};
