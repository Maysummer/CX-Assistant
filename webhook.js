const { processMessage } = require("./bot");
const {
  loadInstagramAccount,
  tryAutomationDmReply,
  tryAutomationCommentReply,
} = require("./automation");
const {
  isThreadPaused,
  pauseForEscalation,
} = require("./conversationMode");
const { ensureOpenFollowUp } = require("./ownerFollowUps");
const { isBotOutboundEcho } = require("./botOutbound");

// Idempotency tracking: prevent duplicate message processing
const seenEvents = new Map(); // { key: timestamp } to detect replays
const DEDUP_WINDOW_MS = 60000; // 60s window to catch retries
const processingEvents = new Set(); // Track events currently being processed (async lock)

function getDedupKey(entry, event) {
  // Key format: merchantId:messageId
  const mid = entry?.id || "unknown";
  const mid_str =
    event?.message?.mid ||
    `${event.sender.id}:${event.timestamp || Date.now()}`;
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

async function handleMerchantEcho(merchantScopedId, account, event) {
  const mid = event.message?.mid;
  const customerId = event.recipient?.id;
  const senderId = event.sender?.id;
  if (!mid || !customerId) return;
  if (account && customerId === account.ig_user_id) return;
  if (account && senderId && senderId !== account.ig_user_id) return;

  if (await isBotOutboundEcho(mid)) {
    console.log(`[ECHO] Bot outbound echo mid=${mid} — not pausing`);
    return;
  }

  if (!(await isThreadPaused(merchantScopedId, customerId))) {
    await pauseForEscalation(merchantScopedId, customerId);
    await ensureOpenFollowUp(
      merchantScopedId,
      customerId,
      "Owner replied manually — bot paused for this customer",
    );
    console.log(
      `[ECHO] Owner manual reply to customer=${customerId} — thread paused`,
    );
  }
}

async function handleWebhook(req, res) {
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log(
      `[WEBHOOK BODY] object=${body?.object} entries=${(body?.entry || []).length}`,
    );
    console.log(`[WEBHOOK BODY DUMP] ${JSON.stringify(body)}`);
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
      console.log(
        `[WEBHOOK] entry.id=${entry?.id} merchantScopedId=${merchantScopedId}`,
      );
      const account = await loadInstagramAccount(merchantScopedId);

      const messaging = entry.messaging || [];
      for (const event of messaging) {
        if (!event.message) continue;

        if (event.message.is_echo) {
          const preview = event.message.text?.substring(0, 50) ?? "";
          console.log(`[ECHO] merchant outbound: "${preview}..."`);
          await handleMerchantEcho(merchantScopedId, account, event);
          continue;
        }

        console.log(
          `[WEBHOOK EVENT] mid=${event.message?.mid} sender=${event.sender?.id} ts=${event.timestamp} is_echo=${event.message?.is_echo}`,
        );
        const senderId = event.sender?.id;
        const text = event.message?.text;
        if (typeof text === "string" && text.trim() && senderId) {
            const now = Date.now();

            // Use a user-based locking key instead of an event-based key
            const userLockKey = `lock:${senderId}`;
            const userSeenKey = `seen:${senderId}`;

            // Check if already processed or currently being processed
            if (processingEvents.has(userLockKey)) {
              console.log(
                `[DEDUP-LOCK] Already computing a reply for customer=${senderId}. Dropping concurrent Meta retry.`,
              );
              continue;
            }
            if (seenEvents.has(userSeenKey)) {
              const lastProcessedTime = seenEvents.get(userSeenKey);
              if (now - lastProcessedTime < 4000) {
                // 4-second safety window
                console.log(
                  `[DEDUP-WINDOW] Sent a reply to customer=${senderId} too recently. Dropping duplicate.`,
                );
                continue;
              }
            }
            processingEvents.add(userLockKey);
            seenEvents.set(userSeenKey, now);

            console.log(`Message received for Store: ${merchantScopedId}`);
            console.log(
              `[WEBHOOK-DEBUG] Processing incoming message: "${text.substring(0, 50)}..."`,
            );

            try {
              if (await isThreadPaused(merchantScopedId, senderId)) {
                await processMessage(event, { merchantScopedId });
                processingEvents.delete(userLockKey);
                continue;
              }
              if (account) {
                const handled = await tryAutomationDmReply(account, event);
                if (handled) {
                  processingEvents.delete(userLockKey);
                  continue;
                }
              }
              await processMessage(event, { merchantScopedId });
            } catch (error) {
              console.error(
                "[WEBHOOK ERROR] Failed processing message:",
                error,
              );
            } finally {
              // ALWAYS remove from processing set, even if processMessage crashes
              processingEvents.delete(userLockKey);
            }
        }
      }
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === "comments" && change.value && account) {
          console.log(`[WEBHOOK] Processing incoming comment change...`);
          await tryAutomationCommentReply(account, change.value);
        }
      }
    }
  } catch (err) {
    console.error("handleWebhook error:", err.message || err);
  }
}

module.exports = { verifyWebhook, handleWebhook };
