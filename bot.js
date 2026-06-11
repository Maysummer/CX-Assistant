const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSession, saveSession } = require("./supabase");
const { getContext, getStorefrontUrl, getStoreName } = require("./context");
const { sendReply } = require("./instagram");
const {
  extractOwnerTasks,
  persistOwnerTasks,
  ensureOpenFollowUp,
} = require("./ownerFollowUps");
const { getPageAccessToken } = require("./accountResolver");
const { recordAiDmOutcome } = require("./dmEvents");
const {
  HANDOFF_ACK,
  isHumanEscalationRequest,
  isThreadPaused,
  pauseForEscalation,
} = require("./conversationMode");

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
- Use OWNER_TASK for actionable owner work: reservations, custom requests, specific commitments, or team checks the customer is waiting on.
- When the customer wants to buy or order a product, confirm the item and price, then include the Online storefront URL from [CATALOG DATA] so they can shop and checkout. Do NOT create OWNER_TASK for standard online purchases when a storefront link is available.
- If [CATALOG DATA] has no products, still reply helpfully — say the team is updating the catalogue and ask what they are looking for. Do NOT hand off for greetings or small talk.
- Greetings (hi, hello, good morning, etc.): reply warmly. NEVER output ESCALATE for greetings alone.
- If a specific fact is missing, say you'll check with the team. Output ESCALATE on its own line ONLY when the customer explicitly asks for a human/owner/manager, or has an urgent issue you cannot resolve. Never use ESCALATE just because the catalogue is empty.
- Keep replies short and Instagram-friendly (a few sentences or a compact bullet list).
`.trim();

const MAX_HISTORY_TURNS = 10;
const MAX_PROMPT_TOKENS = 8000;

const CASUAL_GREETING =
  /^(hi|hello|hey|hiya|good\s+(morning|afternoon|evening|day)|howdy|yo|sup|what'?s\s+up)[!.?\s]*$/i;

const GREETING_STARTERS = new Set([
  "hi",
  "hello",
  "hey",
  "hiya",
  "howdy",
  "yo",
  "sup",
]);

function normalizeGreetingText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[^\p{L}\p{N}\s'?!.]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCasualGreeting(text) {
  const t = normalizeGreetingText(text);
  if (!t || t.length > 50) return false;
  if (CASUAL_GREETING.test(t)) return true;
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  return GREETING_STARTERS.has(words[0]);
}

function greetingReply(storeName) {
  const name = String(storeName || "our store").trim() || "our store";
  return `Welcome to ${name}, I am Lynk Assistant. How may I help you?`;
}

function defaultReplyFor(userMsg) {
  if (isCasualGreeting(userMsg)) {
    return greetingReply("our store");
  }
  return "Thanks for your message! How can I help you today?";
}

async function greetingReplyFor(merchantScopedId, userMsg) {
  if (!isCasualGreeting(userMsg)) return defaultReplyFor(userMsg);
  const storeName = await getStoreName(merchantScopedId);
  return greetingReply(storeName);
}

function looksLikeHandoffText(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("connecting you with the store owner") ||
    t.includes("passed your message along") ||
    t.includes("trouble connecting to my brain") ||
    t.includes("notify the owner for you")
  );
}

const PURCHASE_INTENT_PATTERNS = [
  /\b(i\s*(want|would like|'d like)\s+to\s+)?(buy|purchase|order|get)\b/i,
  /\bcan\s+i\s+(buy|order|get)\b/i,
  /\bhow\s+(do\s+i|can\s+i)\s+(buy|order|pay|checkout)\b/i,
  /\bi('ll| will)\s+(take|get)\b/i,
  /\bplace\s+(an?\s+)?order\b/i,
  /\bcheckout\b/i,
  /\bsend\s+me\s+(the\s+)?(link|store)\b/i,
];

function isPurchaseIntent(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return PURCHASE_INTENT_PATTERNS.some((p) => p.test(t));
}

function withStorefrontLink(text, userMsg, storefrontUrl) {
  if (!storefrontUrl || !isPurchaseIntent(userMsg)) return text;
  const body = String(text || "").trim();
  if (body.toLowerCase().includes(storefrontUrl.toLowerCase())) return body;
  return `${body}\n\nShop and complete your order here:\n${storefrontUrl}`;
}

function isOrderConfirmationTask(summary) {
  const s = String(summary || "").toLowerCase();
  return (
    s.includes("confirm order") ||
    s.includes("arrange payment") ||
    s.includes("wants to buy") ||
    s.includes("place an order") ||
    s.includes("complete their order") ||
    s.includes("checkout")
  );
}

function sanitizeSessionMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter((m) => {
    if (!m || m.role !== "assistant") return true;
    const c = String(m.content || "");
    return c !== HANDOFF_ACK && !looksLikeHandoffText(c);
  });
}

/** Gemini requires history to start with user and alternate user/model. */
function repairSessionForGemini(messages) {
  let rows = sanitizeSessionMessages(messages).filter(
    (m) => m && (m.role === "user" || m.role === "assistant"),
  );

  while (rows.length > 0 && rows[0].role === "assistant") {
    rows = rows.slice(1);
  }

  const merged = [];
  for (const m of rows) {
    const content = String(m.content ?? "").trim();
    if (!content) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = `${prev.content}\n${content}`.trim();
    } else {
      merged.push({ role: m.role, content });
    }
  }

  return merged;
}

function normalizeHistory(messages) {
  return repairSessionForGemini(messages).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

async function saveUserMessageOnly(session, merchantScopedId, userId, userMsg) {
  const newHistory = [
    ...(session?.messages || []),
    { role: "user", content: userMsg },
  ];
  await saveSession(
    merchantScopedId,
    userId,
    newHistory.slice(-MAX_HISTORY_TURNS * 2),
  );
}

async function sendBotReply({
  merchantScopedId,
  userId,
  userMsg,
  session,
  event,
  outbound,
  escalated = false,
}) {
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
      paused: false,
    });
    return;
  }

  const send = await sendReply(userId, outbound, pageToken, {
    merchantScopedId,
  });
  if (escalated && send?.ok) {
    await pauseForEscalation(merchantScopedId, userId);
    console.log(
      `[BOT] Escalation; manual mode enabled for customer=${userId} until owner marks done`,
    );
  }

  const newHistory = [
    ...repairSessionForGemini(session?.messages || []),
    { role: "user", content: userMsg },
    { role: "assistant", content: outbound },
  ];
  await saveSession(
    merchantScopedId,
    userId,
    newHistory.slice(-MAX_HISTORY_TURNS * 2),
  );

  await recordAiDmOutcome({
    merchantScopedId,
    event,
    send,
    escalated,
    paused: false,
  });
}

async function runHandoff(
  merchantScopedId,
  userId,
  userMsg,
  session,
  event,
  previewSummary,
) {
  await persistOwnerTasks(merchantScopedId, userId, [previewSummary]);
  await sendBotReply({
    merchantScopedId,
    userId,
    userMsg,
    session,
    event,
    outbound: HANDOFF_ACK,
    escalated: true,
  });
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

  if (await isThreadPaused(merchantScopedId, userId)) {
    console.log(
      `[BOT] Skipping auto-reply for customer=${userId} — owner handoff active`,
    );
    const preview =
      userMsg.length > 160 ? `${userMsg.slice(0, 160)}…` : userMsg;
    await ensureOpenFollowUp(
      merchantScopedId,
      userId,
      `Customer needs human help. Last message: "${preview}"`,
    );
    await saveUserMessageOnly(session, merchantScopedId, userId, userMsg);
    await recordAiDmOutcome({
      merchantScopedId,
      event,
      send: null,
      escalated: false,
      paused: true,
    });
    return;
  }

  if (isHumanEscalationRequest(userMsg)) {
    const preview =
      userMsg.length > 160 ? `${userMsg.slice(0, 160)}…` : userMsg;
    await runHandoff(
      merchantScopedId,
      userId,
      userMsg,
      session,
      event,
      `Customer needs human help. Last message: "${preview}"`,
    );
    return;
  }

  if (isCasualGreeting(userMsg)) {
    const outbound = await greetingReplyFor(merchantScopedId, userMsg);
    console.log(`[BOT] Greeting for customer=${userId}: ${outbound}`);
    await sendBotReply({
      merchantScopedId,
      userId,
      userMsg,
      session,
      event,
      outbound,
      escalated: false,
    });
    return;
  }

  const geminiHistory = normalizeHistory(session?.messages);
  const context = await getContext(userMsg, merchantScopedId);

  console.log("--- DEBUG CONTEXT ---\n", context);
  console.log(`Gemini is thinking...`);

  let reply;
  try {
    const sendToGemini = async (history) => {
      const chat = model.startChat({ history });

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
      return result.response.text();
    };

    try {
      reply = await sendToGemini(geminiHistory);
    } catch (historyErr) {
      const msg = historyErr?.message || String(historyErr);
      if (
        geminiHistory.length > 0 &&
        (msg.includes("First content should be with role 'user'") ||
          msg.includes("role 'user'") ||
          msg.includes("got model"))
      ) {
        console.warn(
          `[BOT] Invalid session history for customer=${userId} — retrying with empty history`,
        );
        reply = await sendToGemini([]);
      } else {
        throw historyErr;
      }
    }
  } catch (err) {
    console.error("Gemini Error Detail:", err);
    console.error(
      `[AI_FAILURE] merchant=${merchantScopedId} user=${userId} error=${err.message || err}`,
    );

    if (isCasualGreeting(userMsg)) {
      console.warn(
        `[BOT] Gemini failed for greeting — friendly fallback (no handoff)`,
      );
      await sendBotReply({
        merchantScopedId,
        userId,
        userMsg,
        session,
        event,
        outbound: await greetingReplyFor(merchantScopedId, userMsg),
        escalated: false,
      });
      return;
    }

    if (isPurchaseIntent(userMsg)) {
      const storefrontUrl = await getStorefrontUrl(merchantScopedId);
      if (storefrontUrl) {
        console.warn(
          `[BOT] Gemini failed for purchase intent — sending storefront link`,
        );
        await sendBotReply({
          merchantScopedId,
          userId,
          userMsg,
          session,
          event,
          outbound: withStorefrontLink(
            "Great choice! You can shop and complete your order on our store:",
            userMsg,
            storefrontUrl,
          ),
          escalated: false,
        });
        return;
      }
    }

    const preview =
      userMsg.length > 160 ? `${userMsg.slice(0, 160)}…` : userMsg;
    await runHandoff(
      merchantScopedId,
      userId,
      userMsg,
      session,
      event,
      `AI unavailable — customer message: "${preview}"`,
    );
    return;
  }

  const {
    customerText,
    tasks,
    escalate: modelEscalated,
  } = extractOwnerTasks(reply);
  const escalated = modelEscalated;

  let outbound;
  if (escalated) {
    outbound = HANDOFF_ACK;
  } else {
    outbound = customerText.trim() || defaultReplyFor(userMsg);
    if (looksLikeHandoffText(outbound)) {
      console.warn(
        `[BOT] Replacing mistaken handoff copy for customer=${userId}`,
      );
      outbound = defaultReplyFor(userMsg);
    }
  }

  const storefrontUrl = !escalated
    ? await getStorefrontUrl(merchantScopedId)
    : null;
  if (storefrontUrl) {
    outbound = withStorefrontLink(outbound, userMsg, storefrontUrl);
  }

  console.log(`Gemini Reply: ${outbound}`);

  let tasksToPersist = tasks;
  if (storefrontUrl && isPurchaseIntent(userMsg)) {
    tasksToPersist = tasks.filter((t) => !isOrderConfirmationTask(t));
  }

  if (tasksToPersist.length > 0) {
    await persistOwnerTasks(merchantScopedId, userId, tasksToPersist);
  } else if (escalated) {
    const preview =
      userMsg.length > 160 ? `${userMsg.slice(0, 160)}…` : userMsg;
    await persistOwnerTasks(merchantScopedId, userId, [
      `Customer needs human help. Last message: "${preview}"`,
    ]);
  }

  await sendBotReply({
    merchantScopedId,
    userId,
    userMsg,
    session,
    event,
    outbound,
    escalated,
  });
}

module.exports = { processMessage };
