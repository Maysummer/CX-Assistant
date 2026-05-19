const { processMessage } = require("./bot");

// Idempotency tracking: prevent duplicate message processing
const seenEvents = new Map(); // { key: timestamp } to detect replays
const DEDUP_WINDOW_MS = 60000; // 60s window to catch retries

function getDedupKey(entry, event) {
  // Key format: merchantId:messageId
  const mid = entry?.id || 'unknown';
  const mid_str = event?.message?.mid || `${event.sender.id}:${event.timestamp || Date.now()}`;
  return `${mid}:${mid_str}`;
}

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Verification Successful!");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

function isSupportedWebhookObject(object) {
  return object === "instagram" || object === "page";
}

/**
 * `entry.id` identifies the IG business / Page receiving the DM — map this to the
 * same merchant key used by Topic 1 (AI StoreBuilder) when calling STOREFRONT_API_*.
 */
function merchantScopedIdFromEntry(entry) {
  return entry?.id
    ? String(entry.id)
    : process.env.DEFAULT_MERCHANT_SCOPED_ID || "default";
}

async function handleWebhook(req, res) {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || !isSupportedWebhookObject(body.object)) return;

    // Clean stale entries from dedup map (older than window)
    const now = Date.now();
    for (const [key, timestamp] of seenEvents.entries()) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        seenEvents.delete(key);
      }
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const merchantScopedId = merchantScopedIdFromEntry(entry);
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        // Only process if it's a message and NOT an echo
        if (event.message && !event.message.is_echo) {
          const text = event.message.text;
          if (typeof text === "string" && text.trim()) {
            // Idempotency: skip if we've seen this event recently
            const dedupKey = getDedupKey(entry, event);
            if (seenEvents.has(dedupKey)) {
              console.log(`[DEDUP] Skipping duplicate event: ${dedupKey}`);
              continue;
            }
            seenEvents.set(dedupKey, now);
            console.log(`Message received for Store: ${merchantScopedId}`);
            await processMessage(event, { merchantScopedId });
          }
        }
      }
    }
  } catch (err) {
    console.error("handleWebhook error:", err.message || err);
  }
}

module.exports = { verifyWebhook, handleWebhook };
