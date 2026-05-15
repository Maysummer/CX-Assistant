/**
 * Topic 2 — GT Micro-Business Digital Storefront · Instagram CX Assistant
 * ------------------------------------------------------------------------
 * Automates Instagram DM customer engagement for GTCO SME merchants subscribed
 * to the storefront ecosystem. Catalogue truth is owned by Topic 1 (AI StoreBuilder);
 * see storefrontApi.js and getContext() in context.js.
 */

const SYSTEM_PROMPT = `
You are the Instagram Customer Experience assistant for a merchant in the GTCO micro-business ecosystem.
Your job: fast, professional, consistent DM support using ONLY provided product facts.

Rules:
- Concisely answer product questions, shipping, and returns.
- If context is missing, say you'll check and offer a human handoff.
- Commitments to the customer must generate an OWNER_TASK line for the merchant.
- If a human is needed, include a single line with only the word: ESCALATE.
`.trim();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  // If the error persists, pass systemInstruction as an object:
  systemInstruction: {
    role: "system",
    parts: [{ text: SYSTEM_PROMPT }]
  }
});

const { getSession, saveSession } = require("./supabase");
const { getContext } = require("./context");
const { sendReply } = require("./instagram");
const { extractOwnerTasks, persistOwnerTasks } = require("./ownerFollowUps");
// Topic 1 order sync (call when your checkout flow is ready):
// const { postOrderToStorebuilder } = require('./storefrontApi');

const MAX_HISTORY_TURNS = 15;

function stripEscalateSignal(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "ESCALATE")
    .join("\n")
    .trim();
}

function containsEscalate(text) {
  return text.split("\n").some((line) => line.trim() === "ESCALATE");
}

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      content: m.content,
    }));
}

async function processMessage(event, meta = {}) {
  const userId = event.sender.id;
  const userMsg = event.message.text;

  console.log(`--- NEW MESSAGE FROM ${userId} ---`);
  console.log(`User said: ${userMsg}`);

  const merchantScopedId =
    meta.merchantScopedId ||
    process.env.DEFAULT_MERCHANT_SCOPED_ID ||
    "default";

  // 1. Load context and history
  const session = await getSession(merchantScopedId, userId);
  const history = normalizeHistory(session?.messages);
  const context = await getContext(userMsg, merchantScopedId);

  const contextBlock =
    context.trim().length > 0 ? `\n[MERCHANT DATA]\n${context}\n` : "";

  // 2. Prepare Gemini History
  const geminiHistory = history.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  console.log(`Gemini is thinking...`);

  let reply;
  try {
    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: {
        maxOutputTokens: 500,
      },
    });

    const promptWithContext = `
      ${SYSTEM_PROMPT}
      ${contextBlock}
      Customer Message: ${userMsg}
    `;

    const result = await chat.sendMessage(promptWithContext);
    reply = result.response.text();
  } catch (err) {
    console.error("AI Error:", err.message || err);
    reply =
      "I am having a bit of trouble connecting. Let me notify the shop owner for you.";
  }

  // 3. Post-Processing (Tasks & Escalation)
  const { customerText, tasks } = extractOwnerTasks(reply);
  const escalated = containsEscalate(customerText);
  const outbound =
    stripEscalateSignal(customerText) ||
    "A team member will be with you shortly.";

  console.log(`Gemini Reply: ${outbound}`);

  // Save the reminder for the SME
  if (tasks.length > 0) {
    await persistOwnerTasks(merchantScopedId, userId, tasks);
  }

  // 4. Save and Send
  const updatedHistory = [
    ...history,
    { role: "user", content: userMsg },
    { role: "model", content: outbound },
  ];
  await saveSession(
    merchantScopedId,
    userId,
    updatedHistory.slice(-MAX_HISTORY_TURNS * 2),
  );

  await sendReply(userId, outbound);

  if (escalated) {
    console.info(`[ESCALATE] merchant=${merchantScopedId} user=${userId}`);
    // Optional: Add logic here to notify the owner via WhatsApp or Email [cite: 366]
  }
}

module.exports = { processMessage };
