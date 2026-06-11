const { supabase } = require("./supabase");

function normalizeText(text) {
  return String(text).trim().toLowerCase();
}

function textMatchesKeywords(text, keywords) {
  const list = Array.isArray(keywords) ? keywords : [];
  if (list.length === 0) return true;
  const hay = normalizeText(text);
  return list.some((k) => hay.includes(normalizeText(k)));
}

function postMatchesScope(postScope, allowedPostIds, igMediaId) {
  if (postScope === "all") return true;
  if (!igMediaId || !allowedPostIds?.size) return false;
  return allowedPostIds.has(igMediaId);
}

function pickMatchingAutomation(automations, messages, opts) {
  const active = automations.filter(
    (a) => a.status === "active" && a.trigger_type === opts.triggerType,
  );
  const messagesByAutomation = new Map();
  for (const m of messages) {
    const list = messagesByAutomation.get(m.automation_id) ?? [];
    list.push(m);
    messagesByAutomation.set(m.automation_id, list);
  }

  for (const automation of active) {
    if (!textMatchesKeywords(opts.text, automation.keywords)) continue;
    if (
      !postMatchesScope(
        automation.post_scope,
        opts.postsByAutomation.get(automation.id),
        opts.igMediaId,
      )
    ) {
      continue;
    }

    const msgs = (messagesByAutomation.get(automation.id) ?? []).sort(
      (a, b) => a.position - b.position,
    );
    const first = msgs[0];
    if (!first?.body?.trim()) continue;

    return { automation, replyBody: first.body.trim() };
  }

  return null;
}

async function loadInstagramAccount(igBusinessAccountId) {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("id,user_id,ig_user_id,username,access_token")
    .eq("ig_user_id", String(igBusinessAccountId))
    .maybeSingle();

  if (error) {
    console.error("[automations] loadInstagramAccount:", error.message);
    return null;
  }
  return data;
}

async function loadAutomationContext(userId) {
  const { data: automations, error: autoErr } = await supabase
    .from("automations")
    .select("id,user_id,trigger_type,keywords,post_scope,status")
    .eq("user_id", userId);

  if (autoErr || !automations?.length) {
    return { automations: [], messages: [], postsByAutomation: new Map() };
  }

  const ids = automations.map((a) => a.id);
  const [{ data: messages }, { data: posts }] = await Promise.all([
    supabase
      .from("automation_messages")
      .select("automation_id,body,position")
      .in("automation_id", ids)
      .order("position", { ascending: true }),
    supabase
      .from("automation_posts")
      .select("automation_id,ig_post_id")
      .in("automation_id", ids),
  ]);

  const postsByAutomation = new Map();
  for (const p of posts ?? []) {
    const set = postsByAutomation.get(p.automation_id) ?? new Set();
    set.add(p.ig_post_id);
    postsByAutomation.set(p.automation_id, set);
  }

  return {
    automations,
    messages: messages ?? [],
    postsByAutomation,
  };
}

async function recordDmEvent(opts) {
  const { error } = await supabase.from("dm_events").upsert(
    {
      user_id: opts.userId,
      automation_id: opts.automationId,
      ig_event_id: opts.igEventId,
      status: opts.status,
      error: opts.error ?? null,
      trigger_payload: opts.payload,
    },
    { onConflict: "ig_event_id" },
  );
  if (error) console.error("[automations] recordDmEvent:", error.message);
}

/**
 * Rules created in Lynk Automations UI (Supabase). Returns true if a fixed reply was sent.
 */
async function tryAutomationDmReply(account, event) {
  const senderId = event.sender?.id;
  const text = event.message?.text ?? "";
  const mid = event.message?.mid;
  if (!senderId || !mid || !text.trim()) return false;
  if (senderId === account.ig_user_id) return false;

  const ctx = await loadAutomationContext(account.user_id);
  const match = pickMatchingAutomation(ctx.automations, ctx.messages, {
    triggerType: "dm",
    text,
    postsByAutomation: ctx.postsByAutomation,
  });

  if (!match) {
    return false;
  }

  const { sendReply } = require("./instagram");
  const send = await sendReply(senderId, match.replyBody, account.access_token, {
    merchantScopedId: account.ig_user_id,
  });
  await recordDmEvent({
    userId: account.user_id,
    automationId: match.automation.id,
    igEventId: mid,
    status: send.ok ? "sent" : "failed",
    error: send.ok ? null : send.message,
    payload: event,
  });
  if (send.ok) {
    console.log(
      `[automations] DM rule "${match.automation.id}" replied to ${senderId}`,
    );
    return true;
  }
  return false;
}

async function tryAutomationCommentReply(account, changeValue) {
  const text = changeValue.text ?? "";
  const commentId = changeValue.id ?? changeValue.comment_id ?? "";
  const commenterId = changeValue.from?.id ?? "";
  const mediaId = changeValue.media?.id ?? changeValue.media_id ?? undefined;

  if (!commentId || !commenterId) return false;

  const ctx = await loadAutomationContext(account.user_id);
  const match = pickMatchingAutomation(ctx.automations, ctx.messages, {
    triggerType: "comment",
    text,
    igMediaId: mediaId,
    postsByAutomation: ctx.postsByAutomation,
  });

  if (!match) {
    await recordDmEvent({
      userId: account.user_id,
      automationId: null,
      igEventId: commentId,
      status: "skipped",
      error: "No matching active comment automation",
      payload: changeValue,
    });
    return false;
  }

  const { sendReply } = require("./instagram");
  const send = await sendReply(
    commenterId,
    match.replyBody,
    account.access_token,
    { merchantScopedId: account.ig_user_id },
  );
  await recordDmEvent({
    userId: account.user_id,
    automationId: match.automation.id,
    igEventId: commentId,
    status: send.ok ? "sent" : "failed",
    error: send.ok ? null : send.message,
    payload: changeValue,
  });
  if (send.ok) {
    console.log(
      `[automations] Comment rule "${match.automation.id}" DM'd ${commenterId}`,
    );
    return true;
  }
  return false;
}

module.exports = {
  loadInstagramAccount,
  tryAutomationDmReply,
  tryAutomationCommentReply,
  recordDmEvent,

};
