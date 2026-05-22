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

module.exports = { getPageAccessToken };
