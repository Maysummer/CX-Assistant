const { supabase } = require("./supabase");

/**
 * Page access token for Meta Graph API — from Lynk `instagram_accounts` (ig_user_id = webhook entry.id).
 * Falls back to PAGE_ACCESS_TOKEN for local demos without the dashboard connected.
 */
async function getPageAccessToken(merchantScopedId) {
  const mid = merchantScopedId ? String(merchantScopedId) : "default";

  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("access_token")
    .eq("ig_user_id", mid)
    .maybeSingle();

  if (error) {
    console.error("getPageAccessToken:", error.message);
  }

  if (data?.access_token) {
    return data.access_token;
  }

  const fallback = process.env.PAGE_ACCESS_TOKEN;
  if (fallback) {
    console.warn(
      `[accountResolver] No instagram_accounts row for ig_user_id=${mid}; using PAGE_ACCESS_TOKEN from env.`,
    );
    return fallback;
  }

  return null;
}

/** Instagram @handle for AISLE catalogue lookup (instagram_accounts, then store_info). */
async function resolveMerchantInstagramHandle(merchantScopedId) {
  const mid = merchantScopedId ? String(merchantScopedId) : "";
  if (!mid) return null;

  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("username")
    .eq("ig_user_id", mid)
    .maybeSingle();

  if (error) {
    console.error("resolveMerchantInstagramHandle:", error.message);
  }

  const username = data?.username?.trim()?.replace(/^@/, "");
  if (username) return username;

  const lynkUserId = await resolveLynkUserId(merchantScopedId);
  const scopeIds = [...new Set([mid, lynkUserId].filter(Boolean))];

  for (const scopeId of scopeIds) {
    const { data: storeInfo, error: storeErr } = await supabase
      .from("store_info")
      .select("instagram_handle")
      .eq("merchant_scoped_id", scopeId)
      .maybeSingle();

    if (storeErr) {
      console.error("resolveMerchantInstagramHandle store_info:", storeErr.message);
      continue;
    }

    const handle = storeInfo?.instagram_handle?.trim()?.replace(/^@/, "");
    if (handle) {
      console.warn(
        `[accountResolver] Using store_info instagram_handle=${handle} for scope=${scopeId}`,
      );
      return handle;
    }
  }

  return null;
}

/** Lynk auth user id for store_info / automations when webhook id is ig_user_id. */
async function resolveLynkUserId(merchantScopedId) {
  const mid = merchantScopedId ? String(merchantScopedId) : "";
  if (!mid) return null;

  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("user_id")
    .eq("ig_user_id", mid)
    .maybeSingle();

  if (error) {
    console.error("resolveLynkUserId:", error.message);
    return null;
  }
  return data?.user_id ?? null;
}

module.exports = {
  getPageAccessToken,
  resolveMerchantInstagramHandle,
  resolveLynkUserId,
};