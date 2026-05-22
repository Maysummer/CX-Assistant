const axios = require("axios");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";

async function sendReply(recipientId, text, pageAccessToken) {
  const maxLen = 1000;
  const body = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;

  const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "sendReply: no page access token (connect Instagram in Lynk or set PAGE_ACCESS_TOKEN)",
    );
    throw new Error("PAGE_ACCESS_TOKEN required");
  }

  // Instagram Business Account ID from environment (required for production)
  const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!INSTAGRAM_ACCOUNT_ID) {
    console.error("sendReply: INSTAGRAM_ACCOUNT_ID not set in environment");
    throw new Error("INSTAGRAM_ACCOUNT_ID required");
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
    console.log("Reply sent successfully:", res.data);
    return { ok: true };
  } catch (err) {
    const message = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    // This will print the specific reason (e.g., "Permission denied" or "Invalid ID")
    console.error("sendReply failed:", message);
    return { ok: false, error: message };
  }
}

module.exports = { sendReply };
