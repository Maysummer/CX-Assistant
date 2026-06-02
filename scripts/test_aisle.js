#!/usr/bin/env node
require("dotenv").config();
const axios = require("axios");

const arg = process.argv[2] || process.env.AISLE_INSTAGRAM || null;
const storeId = process.argv[3] || process.env.AISLE_STORE_ID || null;
if (!arg && !storeId) {
  console.error("Usage: node scripts/test_aisle.js <instagram> [store_id]");
  process.exit(2);
}
const instagram = arg ? arg.replace(/^@/, "") : null;

// Resolve URL from environment with sensible fallbacks
const explicit = process.env.AISLE_STOREFRONT_API_URL?.trim();
let url = "";
if (explicit) url = explicit.replace(/\/$/, "");
else if (process.env.STOREFRONT_API_BASE_URL) {
  const base = process.env.STOREFRONT_API_BASE_URL.trim().replace(/\/$/, "");
  // if base already contains products path, respect it
  url = base.endsWith("/products") ? base : `${base}/products`;
} else {
  url = "https://aisle-sandy.vercel.app/api/storefront/products";
}

const key = process.env.AISLE_API_KEY || process.env.STOREFRONT_API_KEY || "";
const params = {};
if (instagram) params.instagram = instagram;
if (storeId) params.store_id = storeId;

console.log("--- AISLE API test script ---");
console.log("Resolved URL:", url);
console.log("Params:", params);
console.log("API key present:", Boolean(key));

const fullUrl = new URL(url);
for (const [k, v] of Object.entries(params)) fullUrl.searchParams.set(k, v);
console.log("Full request URL:", fullUrl.toString());
console.log("curl command:");
console.log(
  `curl -v -G "${url}" -H "x-api-key: ${key}" --data-urlencode "instagram=${instagram || ""}" --data-urlencode "store_id=${storeId || ""}"`,
);

(async () => {
  try {
    const res = await axios.get(fullUrl.toString(), {
      headers: { "x-api-key": key },
      validateStatus: () => true,
      timeout: 20000,
    });

    console.log("\nHTTP " + res.status);
    console.log("Response headers:", JSON.stringify(res.headers, null, 2));
    if (typeof res.data === "object")
      console.log("Response body:", JSON.stringify(res.data, null, 2));
    else console.log("Response body (raw):", res.data);
  } catch (err) {
    console.error("Request failed:", err.message || err);
  }
})();
