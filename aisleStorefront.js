/**
 * AISLE storefront products API — for CX-Assistant (Node).
 *
 * Env (either naming works):
 *   AISLE_STOREFRONT_API_URL=https://aisle-sandy.vercel.app/api/storefront/products
 *   AISLE_API_KEY=your_key
 * or legacy:
 *   STOREFRONT_API_BASE_URL=https://aisle-sandy.vercel.app
 *   STOREFRONT_API_KEY=your_key
 */

const DEFAULT_URL = "https://aisle-sandy.vercel.app/api/storefront/products";

function productsUrl() {
  if (process.env.AISLE_STOREFRONT_API_URL?.trim()) {
    return process.env.AISLE_STOREFRONT_API_URL.trim();
  }
  const base = process.env.STOREFRONT_API_BASE_URL?.trim()?.replace(/\/$/, "");
  if (base) return `${base}/api/storefront/products`;
  return DEFAULT_URL;
}

function apiKey() {
  return (
    process.env.AISLE_API_KEY?.trim() ||
    process.env.STOREFRONT_API_KEY?.trim() ||
    ""
  );
}

function isAisleConfigured() {
  return Boolean(apiKey());
}

function normalizeInstagram(handle) {
  if (!handle?.trim()) return null;
  return handle.trim().replace(/^@/, "");
}

function aislePublicBaseUrl() {
  const explicit =
    process.env.AISLE_STOREFRONT_PUBLIC_BASE?.trim() ||
    process.env.STOREFRONT_PUBLIC_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const template = process.env.AISLE_PUBLIC_URL?.trim();
  if (template?.includes("{handle}")) {
    return template.replace(/\{handle\}.*$/, "").replace(/\/$/, "");
  }

  try {
    return new URL(productsUrl()).origin;
  } catch {
    return null;
  }
}

/**
 * Customer-facing AISLE storefront URL for checkout (per merchant @handle).
 */
function resolveStorefrontUrl(instagramHandle) {
  const handle = normalizeInstagram(instagramHandle);
  if (!handle) return null;

  const template = process.env.AISLE_PUBLIC_URL?.trim();
  if (template?.includes("{handle}")) {
    return template.replace(/\{handle\}/g, handle);
  }

  const base = aislePublicBaseUrl();
  if (base) return `${base}/store/${handle}`;

  if (template && !template.includes("{handle}")) {
    return template;
  }

  return null;
}

/**
 * @param {{ instagram?: string | null, storeId?: string | null }} opts
 * @returns {Promise<{ store: object, products: object[], total: number }>}
 */
async function fetchAisleStorefrontProducts(opts = {}) {
  const instagram = normalizeInstagram(opts.instagram);
  const storeId = opts.storeId?.trim() || null;

  if (!instagram && !storeId) {
    throw new Error("Provide instagram or storeId for AISLE catalogue lookup.");
  }

  const key = apiKey();
  if (!key) {
    throw new Error("AISLE_API_KEY (or STOREFRONT_API_KEY) is not set.");
  }

  const url = new URL(productsUrl());
  if (instagram) url.searchParams.set("instagram", instagram);
  if (storeId) url.searchParams.set("store_id", storeId);

  // Debug logging to reproduce exact runtime request
  try {
    console.log(
      `[AISLE] Request (runtime): GET ${url.toString()} instagram=${instagram} store_id=${storeId} x-api-key=${Boolean(
        key,
      )}`,
    );
  } catch (e) {
    console.warn("[AISLE] Request logging failed:", e.message || e);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "x-api-key": key },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `AISLE API ${res.status}`);
  }
  return body;
}

/** Format catalogue for Gemini / system prompt injection. */
function formatAisleCatalogueForPrompt(data) {
  const handle =
    normalizeInstagram(data.store?.instagram_handle) ||
    normalizeInstagram(data.store?.instagram);
  const storefrontUrl = resolveStorefrontUrl(handle);
  const lines = [
    `Store: ${data.store.business_name} (@${data.store.instagram_handle})`,
  ];
  if (storefrontUrl) {
    lines.push(
      `Online storefront (send this link when the customer wants to buy or checkout): ${storefrontUrl}`,
    );
  }
  lines.push(`Products (${data.total}):`);
  if (!data.products?.length) {
    lines.push("- (no products listed)");
    return lines.join("\n");
  }
  for (const p of data.products) {
    const avail = p.available ? "in stock" : "unavailable";
    const desc = p.description?.trim() ? ` — ${p.description.trim()}` : "";
    lines.push(`- ${p.name}: ${p.price}${desc} (${avail})`);
  }
  return lines.join("\n");
}

module.exports = {
  fetchAisleStorefrontProducts,
  formatAisleCatalogueForPrompt,
  normalizeInstagram,
  resolveStorefrontUrl,
  isAisleConfigured,
};