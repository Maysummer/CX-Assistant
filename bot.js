const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSession, saveSession } = require("./supabase");
const { getContext } = require("./context");
const { sendReply } = require("./instagram");
const { extractOwnerTasks, persistOwnerTasks } = require("./ownerFollowUps");
const { getPageAccessToken } = require("./accountResolver");
const {recordAiDmOutcome} = require("./dmEvents");

// 1. Initialize with stable API versioning using the package default version
const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);
const model = genAI.getGenerativeModel(
  { model: process.env.GENAI_MODEL || "gemini-2.5-flash" },
  { apiVersion: process.env.GENAI_API_VERSION || "v1beta" },
);

const SYSTEM_PROMPT = `
You are the Instagram Customer Experience assistant for a merchant in the GTCO micro-business ecosystem.
Your job: fast, professional, consistent DM support using ONLY provided product facts.

Rules:
- NEVER send generic greetings like "Hello! Welcome to..." unless the customer explicitly greets you first.
- Only reply to the customer's specific question or concern.
- Concisely answer product questions using only the [CATALOG DATA] provided.
- If context/facts are missing, say you'll check and offer a human handoff.
- Commitments to the customer must generate an OWNER_TASK line for the merchant.
- If a human is needed, include a single line with only the word: ESCALATE.
`.trim();

const MAX_HISTORY_TURNS = 10;
const MAX_PROMPT_TOKENS = 8000; // Safety guard: truncate context if approaching token limit

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content) }],
    }));
}

async function processMessage(event, meta = {}) {
  const userId = event.sender.id;
  const userMsg = event.message.text;
  const merchantScopedId =
    meta.merchantScopedId ||
    process.env.DEFAULT_MERCHANT_SCOPED_ID ||
    "default";

  console.log(`--- NEW MESSAGE FROM ${userId} ---`);
  console.log(`User said: ${userMsg}`);

  // Fetch Session & Context
  const session = await getSession(merchantScopedId, userId);
  const geminiHistory = normalizeHistory(session?.messages);
  const context = await getContext(userMsg, merchantScopedId);

  console.log("--- DEBUG CONTEXT ---\n", context);
  console.log(`Gemini is thinking...`);

  let reply;
  try {
    // 2. Start chat with raw history elements only
    const chat = model.startChat({
      history: geminiHistory,
    });

    // 3. Inject instructions and context data directly inside the prompt
    let contextData = context;
    const basePrompt = `${SYSTEM_PROMPT}\n\n[CATALOG DATA]\n`;
    const promptTemplate = `\n\nCustomer: ${userMsg}`;
    const estimatedLength =
      basePrompt.length + contextData.length + promptTemplate.length;

    // Guard: truncate context if prompt is too large
    if (estimatedLength > MAX_PROMPT_TOKENS) {
      const maxContextLen =
        MAX_PROMPT_TOKENS - basePrompt.length - promptTemplate.length;
      contextData =
        context.slice(0, Math.max(100, maxContextLen)) +
        "\n[... truncated ...]";
      console.warn(
        `[WARN] Prompt too large (${estimatedLength}), truncating context`,
      );
    }

    const cleanPrompt = `${basePrompt}${contextData}${promptTemplate}`;

    const result = await chat.sendMessage(cleanPrompt);
    reply = result.response.text();
  } catch (err) {
    console.error("Gemini Error Detail:", err);
    console.error(
      `[AI_FAILURE] merchant=${merchantScopedId} user=${userId} error=${err.message || err}`,
    );
    reply =
      "I'm having a bit of trouble connecting to my brain. Let me notify the owner for you! ESCALATE";
  }

  // Handle Escalations and Tasks
  const { customerText, tasks } = extractOwnerTasks(reply);
  const escalated = customerText.includes("ESCALATE");
  const outbound =
    customerText.replace(/ESCALATE/g, "").trim() ||
    "Connecting you with a team member.";

  console.log(`Gemini Reply: ${outbound}`);

  // Save Tasks
  if (tasks.length > 0) {
    await persistOwnerTasks(merchantScopedId, userId, tasks);
  }

  // Save History
  const newHistory = [
    ...(session?.messages || []),
    { role: "user", content: userMsg },
    { role: "assistant", content: outbound },
  ];
  await saveSession(
    merchantScopedId,
    userId,
    newHistory.slice(-MAX_HISTORY_TURNS * 2),
  );

  const pageToken = await getPageAccessToken(merchantScopedId);
  if (!pageToken) {
    console.error(
      `[bot] No access token for merchant ${merchantScopedId}. Connect Instagram in Lynk Integrations.`,
    );
    await recordAiDmOutcome({merchantScopedId, event, send: null, escalated});
    return;
  }
  // Send to Instagram
  const send = await sendReply(userId, outbound, pageToken);
  await recordAiDmOutcome({merchantScopedId, event, send, escalated});
}

module.exports = { processMessage };
