const { processMessage } = require("./bot");

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

    const entries = body.entry || [];
    for (const entry of entries) {
      const merchantScopedId = merchantScopedIdFromEntry(entry);
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        // Only process if it's a message and NOT an echo
        if (event.message && !event.message.is_echo) {
          const text = event.message.text;
          if (typeof text === "string" && text.trim()) {
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
