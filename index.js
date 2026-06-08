/**
 * GTCO TECH 16 — Topic 2: Instagram CX Assistant (Express webhook server).
 * Product truth in production: Topic 1 AI StoreBuilder (see storefrontApi.js).
 */
require("dotenv").config();
const express = require("express");
const { handleWebhook, verifyWebhook } = require("./webhook");
const { processMessage } = require("./bot");
const { resolveIgEventId } = require("./dmEvents");
const { getConversationMode, setConversationMode } = require("./supabase");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/webhook", verifyWebhook);
app.post("/webhook", handleWebhook);

function normalizeInboundDmEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const senderId = raw.sender?.id;
  const text = raw.message?.text;
  if (!senderId || typeof text !== "string" || !text.trim()) return null;
  return raw;
}

/** Called by Lynk Assistant when keyword automations do not match a DM. */
function verifyInternalSecret(req, res) {
  const secret = req.headers["x-cx-internal-secret"];
  const expected = process.env.CX_ASSISTANT_INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    res.sendStatus(403);
    return false;
  }
  return true;
}

app.post("/internal/dm", async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  const { event: rawEvent, merchantScopedId } = req.body || {};
  const event = normalizeInboundDmEvent(rawEvent);
  if (!event) {
    return res
      .status(400)
      .json({ ok: false, message: "Invalid DM event payload" });
  }

  if (!resolveIgEventId(event)) {
    console.warn(
      "[internal/dm] Event has no message.mid - dm_events may not upsert cleanly.",
    );
  }

  res.status(202).json({ ok: true });

  try {
    await processMessage(event, {
      merchantScopedId: merchantScopedId ? String(merchantScopedId) : undefined,
    });
  } catch (err) {
    console.error("[internal/dm]", err.message || err);
  }
});

app.get("/conversation-mode", async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  const merchantScopedId = req.query.merchantScopedId;
  const instagramCustomerId = req.query.instagramCustomerId;
  if (!merchantScopedId || !instagramCustomerId) {
    return res.status(400).json({
      ok: false,
      message: "merchantScopedId and instagramCustomerId are required",
    });
  }

  const mode = await getConversationMode(
    String(merchantScopedId),
    String(instagramCustomerId),
  );

  res.json({
    ok: true,
    mode: mode?.mode || "auto",
    manualUntil: mode?.manual_until || null,
  });
});

app.post("/conversation-mode", async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  const { merchantScopedId, instagramCustomerId, mode, manualUntil } =
    req.body || {};
  if (!merchantScopedId || !instagramCustomerId || !mode) {
    return res.status(400).json({
      ok: false,
      message: "merchantScopedId, instagramCustomerId, and mode are required",
    });
  }
  if (!["auto", "manual"].includes(mode)) {
    return res
      .status(400)
      .json({ ok: false, message: "mode must be 'auto' or 'manual'" });
  }

  const manualUntilIso =
    mode === "manual" && manualUntil
      ? new Date(manualUntil).toISOString()
      : null;

  await setConversationMode(
    String(merchantScopedId),
    String(instagramCustomerId),
    mode,
    manualUntilIso,
  );

  res.json({ ok: true, mode, manualUntil: manualUntilIso });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});
