/**
 * Topic 1 — AISLE Chatbot API Integration
 * ----------------------------------------
 * Fetch products for a specific store from the AISLE platform.
 *
 * API Endpoint: https://aisle-sandy.vercel.app/api/storefront/products
 * Authentication: x-api-key header
 * Query Params: instagram (handle) or store_id (UUID)
 *
 * Response format:
 * {
 *   "store": { "id", "business_name", "instagram_handle" },
 *   "products": [{ "id", "name", "description", "price", "available" }],
 *   "total": number
 * }
 *
 * When STOREFRONT_API_BASE_URL is unset, context.js falls back to Supabase (demo / dev only).
 */

const axios = require("axios");
const { supabase } = require("./supabase");

function baseUrl() {
  const b = process.env.STOREFRONT_API_BASE_URL;
  return b ? b.replace(/\/$/, "") : "";
}

function productsUrl() {
  const explicit = process.env.AISLE_STOREFRONT_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const base = baseUrl();
  if (!base) return "";
  if (base.endsWith("/products")) return base;
  return `${base}/products`;
}

/**
 * Fetch store instagram handle from store_info table.
 * @param {string} merchantScopedId — merchant_scoped_id (maps to store_info row)
 * @returns {Promise<string | null>} instagram handle without '@'
 */
async function resolveInstagramHandle(merchantScopedId) {
  if (!merchantScopedId || merchantScopedId === "default") return null;

  try {
    // Prefer the connected IG account username for the webhook owner.
    const { data: accountData, error: accountError } = await supabase
      .from("instagram_accounts")
      .select("username")
      .eq("ig_user_id", String(merchantScopedId))
      .maybeSingle();

    if (accountError) {
      console.error(
        "[AISLE] resolveInstagramHandle account query error:",
        accountError.message,
      );
    }

    const username = accountData?.username;
    if (username) {
      return username.replace(/^@/, "");
    }

    // Fallback to store_info row if a direct account username is not available.
    const { data, error } = await supabase
      .from("store_info")
      .select("instagram_handle")
      .eq("merchant_scoped_id", merchantScopedId)
      .maybeSingle();

    if (error || !data?.instagram_handle) return null;

    return data.instagram_handle.replace(/^@/, "");
  } catch (e) {
    console.error("[AISLE] resolveInstagramHandle error:", e.message || e);
    return null;
  }
}

/**
 * Fetch products from AISLE platform via Topic 1 API.
 * @param {string} merchantScopedId — Merchant ID (maps to store_info.merchant_scoped_id)
 * @param {string} userMessage — Raw customer DM (optional for future search enhancements)
 * @returns {Promise<{ products: object[], faqs: object[], store: Record<string, string> } | null>}
 */
async function fetchCxContextFromStorebuilder(merchantScopedId, userMessage) {
  const url = productsUrl();
  if (!url || !merchantScopedId) return null;

  // Resolve instagram handle from store_info table
  const instagramHandle = await resolveInstagramHandle(merchantScopedId);
  if (!instagramHandle) {
    console.warn(
      `[AISLE] No instagram handle found for merchant=${merchantScopedId}`,
    );
    return null;
  }

  const headers = {};
  const key = process.env.STOREFRONT_API_KEY || process.env.AISLE_API_KEY;
  if (key) headers["x-api-key"] = key;

  try {
    console.log(
      `[AISLE] Request: GET ${url} instagram=${instagramHandle} x-api-key=${Boolean(key)}`,
    );
    const res = await axios.get(url, {
      headers,
      params: { instagram: instagramHandle },
      timeout: Number(process.env.STOREFRONT_API_TIMEOUT_MS) || 12000,
      validateStatus: () => true,
    });

    console.log(
      `[AISLE] Response: status=${res.status} data=${
        typeof res.data === "object" ? JSON.stringify(res.data) : res.data
      }`,
    );

    if (res.status >= 400) {
      console.error(
        "[AISLE] products HTTP",
        res.status,
        res.data?.error || res.data,
      );
      return null;
    }

    const data = res.data;
    if (!data || typeof data !== "object") return null;

    // Transform AISLE response to match bot's expected format
    // AISLE returns: { store, products, total }
    // Bot expects: { products, faqs, store }
    return {
      products: (Array.isArray(data.products) ? data.products : []).map(
        (p) => ({
          name: p.name || "Item",
          price: p.price ? String(p.price).replace(/₦/g, "") : "0",
          description: p.description || "",
          stock: p.available ? 1 : 0,
          category: p.category || "",
        }),
      ),
      faqs: [], // AISLE API doesn't return FAQs; fall back to Supabase if needed
      store: data.store
        ? {
            store_name: data.store.business_name || "",
            instagram_handle: data.store.instagram_handle || "",
          }
        : {},
    };
  } catch (e) {
    console.error("[AISLE] products error:", e.message || e);
    return null;
  }
}

/**
 * Optional: push an order or lead to Topic 1 / payments rail (implement when Topic 1 exposes it).
 * @param {string} merchantScopedId
 * @param {object} payload — e.g. { instagram_user_id, items, total }
 */
async function postOrderToStorebuilder(merchantScopedId, payload) {
  const base = baseUrl();
  if (!base) return { ok: false, reason: "no STOREFRONT_API_BASE_URL" };
  const path =
    process.env.STOREFRONT_ORDERS_PATH ||
    `/merchants/${merchantScopedId}/orders`;
  const url =
    base + path.replace("{merchantId}", encodeURIComponent(merchantScopedId));
  const key = process.env.STOREFRONT_API_KEY;
  try {
    const res = await axios.post(url, payload, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      console.error("[Topic1 StoreBuilder] orders HTTP", res.status, res.data);
      return { ok: false, status: res.status };
    }
    return { ok: true, data: res.data };
  } catch (e) {
    console.error("[Topic1 StoreBuilder] orders error:", e.message || e);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  fetchCxContextFromStorebuilder,
  postOrderToStorebuilder,
  baseUrl,
};
