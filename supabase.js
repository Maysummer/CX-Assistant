const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

if (!global.WebSocket) {
  global.WebSocket = ws;
}

let supabase;

function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set",
      );
    }
    supabase = createClient(url, key, {
      auth: {
        persistSession: false,
      },
      // THIS IS THE CRITICAL PART:
      realtime: {
        config: {
          transport: ws,
        },
      },
    });
  }
  return supabase;
}

/** @type {import('@supabase/supabase-js').SupabaseClient} */
const supabaseProxy = new Proxy(
  {},
  {
    get(_t, prop) {
      return getClient()[prop];
    },
  },
);

/**
 * @param {string} merchantScopedId — Same id passed to Topic 1 (often Meta webhook entry.id); ties session to one SME storefront
 * @param {string} instagramUserId — Instagram-scoped PSID of the customer
 */
async function getSession(merchantScopedId, instagramUserId) {
  const mid = merchantScopedId || "default";
  const { data, error } = await getClient()
    .from("sessions")
    .select("messages")
    .eq("merchant_scoped_id", mid)
    .eq("instagram_user_id", instagramUserId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("getSession:", error.message);
  }
  return data;
}

async function saveSession(merchantScopedId, instagramUserId, messages) {
  const mid = merchantScopedId || "default";
  const { error } = await getClient().from("sessions").upsert(
    {
      merchant_scoped_id: mid,
      instagram_user_id: instagramUserId,
      messages,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "merchant_scoped_id,instagram_user_id" },
  );
  if (error) console.error("saveSession:", error.message);
}

/** SME owner reminder row — surface in GTCO SME dashboard / Topic 1 merchant app */
async function insertOwnerFollowUp(
  merchantScopedId,
  instagramCustomerId,
  summary,
) {
  const mid = merchantScopedId || "default";
  const { error } = await getClient().from("owner_follow_ups").insert({
    merchant_scoped_id: mid,
    instagram_customer_id: instagramCustomerId,
    summary,
    status: "open",
  });
  if (error) console.error("insertOwnerFollowUp:", error.message);
}

async function getConversationMode(merchantScopedId, instagramCustomerId) {
  const mid = merchantScopedId || "default";
  const { data, error } = await getClient()
    .from("conversation_modes")
    .select("*")
    .eq("merchant_scoped_id", mid)
    .eq("instagram_customer_id", instagramCustomerId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    console.error("getConversationMode:", error.message);
  }
  return data;
}

async function setConversationMode(
  merchantScopedId,
  instagramCustomerId,
  mode,
  manualUntil = null,
) {
  const mid = merchantScopedId || "default";
  const payload = {
    merchant_scoped_id: mid,
    instagram_customer_id: instagramCustomerId,
    mode,
    manual_until: manualUntil ? new Date(manualUntil).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await getClient()
    .from("conversation_modes")
    .upsert(payload, {
      onConflict: "merchant_scoped_id,instagram_customer_id",
    });
  if (error) console.error("setConversationMode:", error.message);
}

module.exports = {
  supabase: supabaseProxy,
  getSession,
  saveSession,
  insertOwnerFollowUp,
  getConversationMode,
  setConversationMode,
};
