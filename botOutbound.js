const { supabase } = require("./supabase");

const LOCAL_TTL_MS = 120_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

const recentLocal = new Map();

function rememberLocal(messageId) {
  recentLocal.set(messageId, Date.now() + LOCAL_TTL_MS);
}

function isRecentLocal(messageId) {
  const expiresAt = recentLocal.get(messageId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    recentLocal.delete(messageId);
    return false;
  }
  return true;
}

async function pruneStaleRows() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { error } = await supabase
    .from("bot_outbound_mids")
    .delete()
    .lt("created_at", cutoff);
  if (error) console.error("[botOutbound] prune:", error.message);
}

async function registerBotOutbound(
  merchantScopedId,
  instagramCustomerId,
  messageId,
) {
  if (!messageId?.trim()) return;
  rememberLocal(messageId);
  const { error } = await supabase.from("bot_outbound_mids").upsert(
    {
      message_id: messageId,
      merchant_scoped_id: merchantScopedId,
      instagram_customer_id: instagramCustomerId,
    },
    { onConflict: "message_id" },
  );
  if (error) console.error("[botOutbound] register:", error.message);
  void pruneStaleRows();
}

async function isBotOutboundEcho(messageId) {
  if (!messageId?.trim()) return false;
  if (isRecentLocal(messageId)) return true;

  const { data, error } = await supabase
    .from("bot_outbound_mids")
    .select("message_id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) console.error("[botOutbound] lookup:", error.message);
  return !!data;
}

module.exports = { registerBotOutbound, isBotOutboundEcho };
