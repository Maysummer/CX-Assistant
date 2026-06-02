const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSession, saveSession } = require("./supabase");
const { getContext } = require("./context");
const { sendReply } = require("./instagram");
const { extractOwnerTasks, persistOwnerTasks } = require("./ownerFollowUps");
const { getPageAccessToken } = require("./accountResolver");
const { recordAiDmOutcome } = require("./dmEvents");

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);
const model = genAI.getGenerativeModel(
  { model: process.env.GENAI_MODEL || "gemini-2.5-flash" },
  { apiVersion: process.env.GENAI_API_VERSION || "v1beta" },
);

const SYSTEM_PROMPT = `
You are the Instagram Customer Experience assistant for a merchant in the GTCO micro-business ecosystem.
Your job: fast, professional, consistent DM support using ONLY the product facts in [CATALOG DATA].

Rules:
- LANGUAGE RULE: Detect the language of the customer's exact message text. If the message is in English, reply in English. Only reply in another language when the customer clearly writes in that language. Do not invent a different language or switch languages arbitrarily.
- Answer product and catalogue questions using ONLY [CATALOG DATA]. When products are listed there, tell the customer names, prices, and availability directly.
- For "what do you have?", "what's available?", "show me your products", or similar — if [CATALOG DATA] includes a product list, reply with a short friendly list (name, price, brief detail). You already have the catalogue; answer the customer yourself.
- NEVER output OWNER_TASK asking the merchant to "provide product catalog", "provide product list", or "give catalogue to the assistant". Those are forbidden.
- When you commit to checking something specific with the team (e.g., "I'll check if we carry X" or "I'll confirm availability"), output an OWNER_TASK line describing what to check.
- Use OWNER_TASK for actionable owner work: confirmed orders, reservations, custom requests, specific commitments, or team checks the customer is waiting on.
- If [CATALOG DATA] has no products, tell the customer the team is updating the catalogue and offer to connect them with someone — do NOT create OWNER_TASK about supplying a catalog to you.
- If a specific fact is missing, say you'll check with the team. Include a single line with only the word ESCALATE only when the customer needs a human right now.
- Keep replies short and Instagram-friendly (a few sentences or a compact bullet list).
`.trim();

const MAX_HISTORY_TURNS = 10;
const MAX_PROMPT_TOKENS = 8000;

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

  const session = await getSession(merchantScopedId, userId);
  const geminiHistory = normalizeHistory(session?.messages);
  const context = await getContext(userMsg, merchantScopedId);

  console.log("--- DEBUG CONTEXT ---\n", context);
  console.log(`Gemini is thinking...`);

  let reply;
  try {
    const chat = model.startChat({
      history: geminiHistory,
    });

    let contextData = context;
    const basePrompt = `${SYSTEM_PROMPT}\n\n[CATALOG DATA]\n`;
    const promptTemplate = `\n\nCustomer: ${userMsg}`;
    const estimatedLength =
      basePrompt.length + contextData.length + promptTemplate.length;

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

  const { customerText, tasks } = extractOwnerTasks(reply);
  const escalated = customerText.includes("ESCALATE");
  const outbound =
    customerText.replace(/ESCALATE/g, "").trim() ||
    "Connecting you with a team member.";

  console.log(`Gemini Reply: ${outbound}`);

  if (tasks.length > 0) {
    await persistOwnerTasks(merchantScopedId, userId, tasks);
  } else if (escalated) {
    const preview =
      userMsg.length > 160 ? `${userMsg.slice(0, 160)}…` : userMsg;
    await persistOwnerTasks(merchantScopedId, userId, [
      `Customer needs human help. Last message: "${preview}"`,
    ]);
  }

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
    await recordAiDmOutcome({
      merchantScopedId,
      event,
      send: null,
      escalated,
    });
    return;
  }

  const send = await sendReply(userId, outbound, pageToken);
  await recordAiDmOutcome({
    merchantScopedId,
    event,
    send,
    escalated,
  });
}

module.exports = { processMessage };
