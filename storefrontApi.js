/**
 * Topic 1 — GT Micro-Business Digital Storefront · AI StoreBuilder
 * -----------------------------------------------------------------
 * The canonical product catalogue, storefront structure, and published
 * merchant configuration live in the StoreBuilder service (Topic 1).
 * Topic 2 (this Instagram CX Assistant) MUST consume that data in production
 * so DM answers always match what the merchant published on their storefront.
 *
 * Expected integration (adjust paths to match your Topic 1 implementation):
 *
 *   GET {STOREFRONT_API_BASE_URL}/merchants/{merchantScopedId}/cx-context
 *       ?q={encodedUserMessage}
 *   Headers: Authorization: Bearer {STOREFRONT_API_KEY}
 *           (or X-GTCO-SME-Token / mTLS — align with your bank auth model)
 *
 *   200 JSON body (example contract):
 *   {
 *     "products": [{ "name", "price", "description", "stock", "category" }],
 *     "faqs": [{ "question", "answer", "category" }],
 *     "store": { "store_name": "...", "hours": "...", ... }
 *   }
 *
 * Optional: Topic 1 can also expose POST /orders to sync enquiries — wire in bot.js later.
 *
 * When STOREFRONT_API_BASE_URL is unset, context.js falls back to Supabase (demo / dev only).
 */

const axios = require("axios");

function baseUrl() {
  const b = process.env.STOREFRONT_API_BASE_URL;
  return b ? b.replace(/\/$/, "") : "";
}

/**
 * Fetch pre-ranked catalogue + FAQ + store copy for the CX model.
 * @param {string} merchantScopedId — Typically Meta `entry.id` (IG business / page scope) mapped to Topic 1 merchant/store id
 * @param {string} userMessage — Raw customer DM (Topic 1 may use it for search / RAG)
 * @returns {Promise<{ products: object[], faqs: object[], store: Record<string, string> } | null>}
 */
async function fetchCxContextFromStorebuilder(merchantScopedId, userMessage) {
  const base = baseUrl();
  if (!base || !merchantScopedId) return null;

  const path =
    process.env.STOREFRONT_CX_CONTEXT_PATH ||
    `/merchants/${merchantScopedId}/cx-context`;
  const url =
    base + path.replace("{merchantId}", encodeURIComponent(merchantScopedId));

  const headers = {};
  const key = process.env.STOREFRONT_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await axios.get(url, {
      headers,
      params: { q: userMessage },
      timeout: Number(process.env.STOREFRONT_API_TIMEOUT_MS) || 12000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      console.error(
        "[Topic1 StoreBuilder] cx-context HTTP",
        res.status,
        res.data,
      );
      return null;
    }
    const data = res.data;
    if (!data || typeof data !== "object") return null;
    return {
      products: Array.isArray(data.products) ? data.products : [],
      faqs: Array.isArray(data.faqs) ? data.faqs : [],
      store:
        data.store &&
        typeof data.store === "object" &&
        !Array.isArray(data.store)
          ? data.store
          : {},
    };
  } catch (e) {
    console.error("[Topic1 StoreBuilder] cx-context error:", e.message || e);
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
