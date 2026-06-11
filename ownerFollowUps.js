/**
 * Topic 2 — reminders for the SME owner (deliverables, follow-ups).
 * Customer never sees these rows directly; the bank app / merchant dashboard
 * (fed by Topic 1 or a GTCO SME console) should poll or subscribe to notify the owner.
 */

const { insertOwnerFollowUp, supabase } = require("./supabase");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const OWNER_TASK_PREFIX = "OWNER_TASK:";

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Detect if text is likely in a non-English language and translate to English if needed.
 * @param {string} text — task summary (may be in customer's language)
 * @returns {Promise<string>} — English translation or original if already English
 */
async function translateTaskToEnglish(text) {
  if (!text || text.length === 0) return text;

  // Quick heuristic: if it's mostly ASCII, assume English
  const asciiRatio = (text.match(/[\x00-\x7F]/g) || []).length / text.length;
  if (asciiRatio > 0.8) return text; // Likely English or mostly Latin

  try {
    const prompt = `Translate the following text to English. Reply with ONLY the English translation, nothing else:

${text}`;

    const result = await model.generateContent(prompt);
    const translated = result.response.text().trim();
    if (translated && translated.length > 0) {
      console.info(
        `[OWNER_TASK TRANSLATE] Original (${text.slice(0, 40)}...) → English (${translated.slice(0, 40)}...)`,
      );
      return translated;
    }
  } catch (e) {
    console.error("[OWNER_TASK TRANSLATE] Error:", e.message || e);
  }

  return text; // Fallback to original if translation fails
}

/** Meta tasks where the model asks the owner to feed catalogue into the bot — not actionable. */
function isMetaCatalogTask(summary) {
  const s = summary.toLowerCase();
  const catalogCue =
    s.includes("product catalog") ||
    s.includes("product list") ||
    s.includes("product catalogue") ||
    s.includes("catalogue information") ||
    s.includes("catalog information") ||
    (s.includes("catalog") && s.includes("provide")) ||
    (s.includes("catalogue") && s.includes("provide"));
  const metaCue =
    s.includes("to the assistant") ||
    s.includes("needs product list") ||
    s.includes("asking about specific products") ||
    s.includes("what do you have");
  return (
    catalogCue || (metaCue && (s.includes("product") || s.includes("catalog")))
  );
}

/**
 * @param {string} fullReply — model output before stripping
 * @returns {{ customerText: string, tasks: string[] }}
 */
function extractOwnerTasks(fullReply) {
  const lines = fullReply.split("\n");
  const tasks = [];
  const kept = [];
  let escalate = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(OWNER_TASK_PREFIX)) {
      tasks.push(t.slice(OWNER_TASK_PREFIX.length).trim());
    } else if (/^ESCALATE$/i.test(t)) {
      escalate = true;
    } else {
      kept.push(line);
    }
  }
  return { customerText: kept.join("\n").trim(), tasks, escalate };
}

/**
 * Persist owner reminders; strip OWNER_TASK lines from the DM the customer receives.
 */
function isOpenFollowUpStatus(status) {
  if (status == null || String(status).trim() === "") return true;
  return !/^done$/i.test(String(status).trim());
}

async function ensureOpenFollowUp(merchantScopedId, instagramCustomerId, summary) {
  const mid = merchantScopedId || "default";
  const { data } = await supabase
    .from("owner_follow_ups")
    .select("id, status")
    .eq("merchant_scoped_id", mid)
    .eq("instagram_customer_id", instagramCustomerId);

  if (data?.some((r) => isOpenFollowUpStatus(r.status))) return;

  await insertOwnerFollowUp(merchantScopedId, instagramCustomerId, summary);
}

async function persistOwnerTasks(merchantScopedId, instagramCustomerId, tasks) {
  for (const summary of tasks) {
    if (!summary) continue;
    if (isMetaCatalogTask(summary)) {
      console.info(`[OWNER_TASK] Skipping meta catalog task: ${summary}`);
      continue;
    }

    // Translate to English if in another language
    const englishSummary = await translateTaskToEnglish(summary);

    await insertOwnerFollowUp(
      merchantScopedId,
      instagramCustomerId,
      englishSummary,
    );
    console.info(
      `[OWNER_TASK] merchant=${merchantScopedId} customer=${instagramCustomerId} summary=${JSON.stringify(englishSummary)}`,
    );
  }
}

module.exports = {
  OWNER_TASK_PREFIX,
  isMetaCatalogTask,
  extractOwnerTasks,
  persistOwnerTasks,
  translateTaskToEnglish,
  ensureOpenFollowUp,
};
