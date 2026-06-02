const { supabase } = require("./supabase");
const { fetchCxContextFromStorebuilder, baseUrl } = require("./storefrontApi");
const {
  fetchAisleStorefrontProducts,
  formatAisleCatalogueForPrompt,
  isAisleConfigured,
} = require("./aisleStorefront");
const {
  resolveMerchantInstagramHandle,
  resolveLynkUserId,
} = require("./accountResolver");

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

/** Broad catalogue questions where we should list all products, not keyword-search. */
function isCatalogListingQuestion(userMessage) {
  const lower = userMessage.toLowerCase().trim();
  const patterns = [
    /\bwhat do you have\b/,
    /\bwhat('s| is) available\b/,
    /\bwhat do you sell\b/,
    /\bwhat can i (buy|get|order)\b/,
    /\bshow (me )?(your )?(products|catalog|catalogue|menu|items)\b/,
    /\b(product|item) (list|catalog|catalogue)\b/,
    /\blist (your )?(products|items)\b/,
    /\bdo you have anything\b/,
    /\bwhat('s| is) on (the menu|offer)\b/,
    /\bwhat products\b/,
    /\bwhat items\b/,
  ];
  return patterns.some((p) => p.test(lower));
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

function formatOtherInfo(otherInfo) {
  if (otherInfo == null) return [];
  if (typeof otherInfo === "string") {
    const trimmed = otherInfo.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof otherInfo === "object" && !Array.isArray(otherInfo)) {
    return Object.entries(otherInfo).map(([k, v]) => `${k}: ${v}`);
  }
  return [];
}

/**
 * AISLE Storefront — live product catalogue matched by Instagram handle.
 */
async function fetchCxContextFromAisle(merchantScopedId) {
  if (!isAisleConfigured()) return null;

  const instagram = await resolveMerchantInstagramHandle(merchantScopedId);
  if (!instagram) {
    console.warn(
      `[AISLE] No instagram_accounts.username for ig_user_id=${merchantScopedId}`,
    );
    return null;
  }

  try {
    const data = await fetchAisleStorefrontProducts({ instagram });
    const block = formatAisleCatalogueForPrompt(data);
    if (!block?.trim()) return null;
    console.info(
      `[AISLE] Loaded ${data.total ?? data.products?.length ?? 0} products for @${instagram}`,
    );
    return `\n[Products — from AISLE Storefront]\n${block}`;
  } catch (e) {
    console.error(`[AISLE] catalogue error for @${instagram}:`, e.message || e);
    return null;
  }
}

/**
 * Supabase fallback when external catalogue APIs are not configured or return nothing.
 */
async function getContextFromSupabase(userMessage, merchantScopedId) {
  const phrase = searchPhrase(userMessage);
  const listAllProducts = isCatalogListingQuestion(userMessage);
  let context = "";
  const mid = merchantScopedId || "default";
  const lynkUserId = await resolveLynkUserId(merchantScopedId);
  const scopeIds = new Set([mid, "default"]);
  if (lynkUserId) scopeIds.add(lynkUserId);

  const formatProductRows = (rows) =>
    rows
      .map(
        (p) =>
          `${p.name} — $${p.price} | Stock: ${p.stock} | ${p.description || ""}`,
      )
      .join("\n");

  if (listAllProducts) {
    const { data: allProducts, error: allErr } = await supabase
      .from("products")
      .select("name, price, description, stock, category, merchant_scoped_id")
      .limit(30);
    if (allErr) console.error("products (catalog list) query:", allErr.message);

    const scoped = (allProducts || []).filter(
      (p) => !p.merchant_scoped_id || scopeIds.has(p.merchant_scoped_id),
    );
    if (scoped.length) {
      context +=
        "\n[Products — Supabase demo / dev fallback]\n" +
        formatProductRows(scoped.slice(0, 20));
    }
  } else if (phrase) {
    const q = quotedIlikePattern(phrase);
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("name, price, description, stock, category, merchant_scoped_id")
      .or(`name.ilike.${q},description.ilike.${q},category.ilike.${q}`)
      .limit(8);
    if (prodErr) console.error("products query:", prodErr.message);

    const scoped =
      (products || []).filter(
        (p) => !p.merchant_scoped_id || scopeIds.has(p.merchant_scoped_id),
      ) || [];

    const picked = scoped.slice(0, 5);
    if (picked.length) {
      context +=
        "\n[Products — Supabase demo / dev fallback]\n" +
        formatProductRows(picked);
    }
  }

  const { data: faqs, error: faqErr } = await supabase
    .from("faqs")
    .select("question, answer, merchant_scoped_id")
    .limit(20);

  if (faqErr) console.error("faqs query:", faqErr.message);

  let faqRows = (faqs || []).filter(
    (f) => !f.merchant_scoped_id || scopeIds.has(f.merchant_scoped_id),
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

  const { data: storeRows } = await supabase
    .from("store_config")
    .select("key, value, merchant_scoped_id")
    .limit(40);

  const storeFiltered = (storeRows || []).filter(
    (r) => !r.merchant_scoped_id || scopeIds.has(r.merchant_scoped_id),
  );

  if (storeFiltered?.length) {
    context +=
      "\n[Store info]\n" +
      storeFiltered.map((r) => `${r.key}: ${r.value}`).join("\n");
  }

  return context;
}

/**
 * Merchant store voice from Lynk onboarding / Settings (store_info table).
 */
async function getStoreInfoContext(merchantScopedId) {
  const mid = merchantScopedId || "default";
  const lynkUserId = await resolveLynkUserId(merchantScopedId);

  let data = null;

  if (lynkUserId) {
    const { data: byUser, error } = await supabase
      .from("store_info")
      .select("store_name, hours, currency, instagram_handle, address, other_info")
      .eq("merchant_scoped_id", lynkUserId)
      .maybeSingle();
    if (error) console.error("store_info (user_id):", error.message);
    data = byUser;
  }

  if (!data) {
    const { data: byMid, error } = await supabase
      .from("store_info")
      .select("store_name, hours, currency, instagram_handle, address, other_info")
      .eq("merchant_scoped_id", mid)
      .maybeSingle();
    if (error) console.error("store_info (ig_user_id):", error.message);
    data = byMid;
  }

  if (!data) return "";

  const lines = [];
  if (data.store_name) lines.push(`Store name: ${data.store_name}`);
  if (data.instagram_handle) lines.push(`Instagram: @${data.instagram_handle}`);
  if (data.hours) lines.push(`Business hours: ${data.hours}`);
  if (data.currency) lines.push(`Currency: ${data.currency}`);
  if (data.address) lines.push(`Address: ${data.address}`);
  lines.push(...formatOtherInfo(data.other_info));

  if (!lines.length) return "";
  return "\n[Store identity — from merchant settings]\n" + lines.join("\n");
}

/**
 * Assemble RAG-style context for Gemini.
 * Priority: AISLE Storefront → Topic 1 StoreBuilder → Supabase fallback.
 */
const MAX_CONTEXT_LENGTH = 4000;

async function getContext(userMessage, merchantScopedId) {
  const storeIdentity = await getStoreInfoContext(merchantScopedId);

  const aisle = await fetchCxContextFromAisle(merchantScopedId);
  if (aisle?.trim()) {
    let result = aisle + storeIdentity;
    if (result.length > MAX_CONTEXT_LENGTH) {
      result = result.slice(0, MAX_CONTEXT_LENGTH) + "\n[... context truncated ...]";
    }
    return result;
  }

  const topic1 = isAisleConfigured()
    ? null
    : await fetchCxContextFromStorebuilder(merchantScopedId, userMessage);

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
    if (ctx.trim()) {
      let result = ctx + storeIdentity;
      if (result.length > MAX_CONTEXT_LENGTH) {
        result = result.slice(0, MAX_CONTEXT_LENGTH) + "\n[... context truncated ...]";
      }
      return result;
    }
  }

  if (!isAisleConfigured() && !baseUrl()) {
    const fb = await getContextFromSupabase(userMessage, merchantScopedId);
    if (!fb.trim() && !storeIdentity.trim()) {
      return "\n[System note: No catalogue API configured — AISLE or STOREFRONT_API_BASE_URL unset.]\n";
    }
    let result = fb + storeIdentity;
    if (result.length > MAX_CONTEXT_LENGTH) {
      result = result.slice(0, MAX_CONTEXT_LENGTH) + "\n[... context truncated ...]";
    }
    return result;
  }

  const fallback = await getContextFromSupabase(userMessage, merchantScopedId);
  if (fallback.trim() || storeIdentity.trim()) {
    let result =
      "\n[System note: External catalogue returned no rows; Supabase fallback follows.]" +
      fallback +
      storeIdentity;
    if (result.length > MAX_CONTEXT_LENGTH) {
      result = result.slice(0, MAX_CONTEXT_LENGTH) + "\n[... context truncated ...]";
    }
    return result;
  }

  if (storeIdentity.trim()) {
    return storeIdentity;
  }

  return "\n[System note: No catalogue context available for this merchant.]\n";
}

module.exports = { getContext };