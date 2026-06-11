const axios = require("axios");
const { registerBotOutbound } = require("./botOutbound");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v19.0";

async function sendReply(recipientId, text, pageAccessToken, track) {
  const maxLen = 1000;
  const body = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;

  const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "sendReply: no page access token (connect Instagram in Lynk or set PAGE_ACCESS_TOKEN)",
    );
    return { ok: false, message: "PAGE_ACCESS_TOKEN required" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;

  try {
    const res = await axios.post(
      url,
      {
        messaging_product: "instagram",
        recipient: { id: recipientId },
        message: { text: body },
      },
      {
        params: { access_token: token },
      },
    );
    const messageId = res.data?.message_id;
    if (messageId && track?.merchantScopedId) {
      await registerBotOutbound(track.merchantScopedId, recipientId, messageId);
    }
    console.log("Reply sent successfully:", res.data);
    return { ok: true, messageId };
  } catch (err) {
    const message = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error("sendReply failed:", message);
    return { ok: false, message };
  }
}

module.exports = { sendReply };
