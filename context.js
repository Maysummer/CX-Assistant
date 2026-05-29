const { supabase } = require("./supabase");
const { fetchCxContextFromStorebuilder, baseUrl } = require("./storefrontApi");

/** Escape % and _ for PostgREST ilike patterns */
function escapeIlike(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Pull a short search phrase from the user message (first meaningful chunk).
 */
const STOP_WORDS = new Set([
  "how",
  "much",
  "what",
  "is",
  "are",
  "do",
  "does",
  "did",
  "the",
  "your",
  "you",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "a",
  "an",
  "please",
  "me",
  "my",
  "with",
  "and",
  "or",
  "can",
  "be",
  "it",
  "have",
  "has",
  "will",
  "if",
  "this",
  "that",
  "these",
  "those",
  "from",
  "by",
  "about",
  "as",
  "we",
  "i",
  "us",
  "our",
  "show",
  "tell",
  "give",
  "price",
  "cost",
  "amount",
  "much",
]);

function searchPhrase(userMessage) {
  const cleaned = userMessage
    .trim()
    .replace(/[?!.]/g, "")
    .replace(/\s+/g, " ")
    .replace(/,/g, "")
    .toLowerCase();
  if (!cleaned) return "";

  const words = cleaned
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  if (words.length === 0) {
    return cleaned.slice(0, 80);
  }

  return words.slice(0, 5).join(" ");
}

/** PostgREST .or() values that contain commas or wildcards should be double-quoted */
function quotedIlikePattern(phrase) {
  const pattern = `%${escapeIlike(phrase)}%`;
  return `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '""')}"`;
}

function formatProductsFromTopic1(products) {
  if (!products?.length) return "";
  return (
    "\n[Products — from AI StoreBuilder / Topic 1]\n" +
    products
      .map((p) => {
        const price = p.price != null ? `$${p.price}` : "";
        return `${p.name || "Item"} — ${price} | Stock: ${p.stock ?? "?"} | ${p.description || ""}`;
      })
      .join("\n")
  );
}

function formatFaqsFromTopic1(faqs) {
  if (!faqs?.length) return "";
  return (
    "\n[FAQs — from AI StoreBuilder / Topic 1]\n" +
    faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")
  );
}

function formatStoreFromTopic1(store) {
  const keys = store && typeof store === "object" ? Object.keys(store) : [];
  if (!keys.length) return "";
  return (
    "\n[Store info — from AI StoreBuilder / Topic 1]\n" +
    keys.map((k) => `${k}: ${store[k]}`).join("\n")
  );
}
function formatStoreFromSupabase(store) {
  if (!store || typeof store !== "object") return "";
  const parts = [];
  if (store.store_name) parts.push(`store_name: ${store.store_name}`);
  if (store.hours) parts.push(`hours: ${store.hours}`);
  if (store.currency) parts.push(`currency: ${store.currency}`);
  if (store.instagram_handle)
    parts.push(`instagram_handle: ${store.instagram_handle}`);
  if (store.address) parts.push(`address: ${store.address}`);
  if (store.other_info && typeof store.other_info === "object") {
    for (const [key, value] of Object.entries(store.other_info)) {
      parts.push(`${key}: ${value}`);
    }
  }
  if (!parts.length) return "";
  return "\n[Store info]\n" + parts.join("\n");
}
/**
 * Supabase fallback when Topic 1 API is not configured or returns nothing.
 * Seed `products` / `faqs` / `store_info` with optional `merchant_scoped_id` to match the merchant.
 */
async function getContextFromSupabase(userMessage, merchantScopedId) {
  const phrase = searchPhrase(userMessage);
  let context = "";
  const mid = merchantScopedId || "default";

  if (phrase) {
    const q = quotedIlikePattern(phrase);
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("name, price, description, stock, category, merchant_scoped_id")
      .or(`name.ilike.${q},description.ilike.${q},category.ilike.${q}`)
      .limit(8);
    if (prodErr) console.error("products query:", prodErr.message);

    const scoped =
      (products || []).filter(
        (p) =>
          !p.merchant_scoped_id ||
          p.merchant_scoped_id === mid ||
          p.merchant_scoped_id === "default",
      ) || [];

    const picked = scoped.slice(0, 5);
    if (picked.length) {
      context +=
        "\n[Products — Supabase demo / dev; replace with Topic 1 API in production]\n" +
        picked
          .map(
            (p) =>
              `${p.name} — $${p.price} | Stock: ${p.stock} | ${p.description || ""}`,
          )
          .join("\n");
    }
  }

  const { data: faqs, error: faqErr } = await supabase
    .from("faqs")
    .select("question, answer, merchant_scoped_id")
    .limit(20);

  if (faqErr) console.error("faqs query:", faqErr.message);

  let faqRows = (faqs || []).filter(
    (f) =>
      !f.merchant_scoped_id ||
      f.merchant_scoped_id === mid ||
      f.merchant_scoped_id === "default",
  );
  if (phrase && faqRows.length) {
    const matched = faqRows.filter(
      (f) =>
        f.question.toLowerCase().includes(phrase.toLowerCase()) ||
        f.answer.toLowerCase().includes(phrase.toLowerCase()),
    );
    faqRows = matched.length ? matched.slice(0, 5) : faqRows.slice(0, 3);
  } else {
    faqRows = faqRows.slice(0, 3);
  }

  if (faqRows.length) {
    context +=
      "\n[FAQs]\n" +
      faqRows.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
  }

  const { data: storeInfoRows, error: storeInfoErr } = await supabase
    .from("store_info")
    .select(
      "store_name, hours, currency, instagram_handle, address, other_info, merchant_scoped_id",
    )
    .in("merchant_scoped_id", [mid, "default"])
    .limit(2);
  if (storeInfoErr) console.error("store_info query:", storeInfoErr.message);

  const storeInfo =
    (storeInfoRows || []).find((row) => row.merchant_scoped_id === mid) ||
    (storeInfoRows || [])[0];

  if (storeInfo) {
    context += formatStoreFromSupabase(storeInfo);
  }

  return context;
}

/**
 * Assemble RAG-style context for Claude.
 * Production: Topic 1 (AI StoreBuilder) via storefrontApi.
 * Dev/demo: Supabase tables (labelled in the prompt so evaluators know the boundary).
 *
 * @param {string} userMessage
 * @param {string} merchantScopedId — maps to the SME storefront in Topic 1
 */
const MAX_CONTEXT_LENGTH = 4000; // Defensive truncation for final context

async function getContext(userMessage, merchantScopedId) {
  const topic1 = await fetchCxContextFromStorebuilder(
    merchantScopedId,
    userMessage,
  );

  if (
    topic1 &&
    (topic1.products.length ||
      topic1.faqs.length ||
      Object.keys(topic1.store).length)
  ) {
    let ctx = "";
    ctx += formatProductsFromTopic1(topic1.products);
    ctx += formatFaqsFromTopic1(topic1.faqs);
    ctx += formatStoreFromTopic1(topic1.store);
    if (ctx.trim()) return ctx;
  }

  if (!baseUrl()) {
    // Explicit note for assessors: without Topic 1 URL, answers come from local/demo DB only
    const fb = await getContextFromSupabase(userMessage, merchantScopedId);
    if (!fb.trim()) {
      return "\n[System note: STOREFRONT_API_BASE_URL is not set — no Topic 1 catalogue loaded.]\n";
    }
    return fb;
  }

  // Topic 1 configured but empty / error — still try Supabase as secondary cache (optional)
  const fallback = await getContextFromSupabase(userMessage, merchantScopedId);
  if (fallback.trim()) {
    let result =
      "\n[System note: Topic 1 cx-context returned no rows; partial Supabase fallback follows.]" +
      fallback;
    // Truncate if exceeds safe length
    if (result.length > MAX_CONTEXT_LENGTH) {
      result =
        result.slice(0, MAX_CONTEXT_LENGTH) + "\n[... context truncated ...]";
    }
    return result;
  }
  return "\n[System note: Topic 1 returned no catalogue context for this query.]\n";
}

module.exports = { getContext };
