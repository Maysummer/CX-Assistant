const axios = require("axios");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";

async function sendReply(recipientId, text) {
  const maxLen = 1000;
  const body = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;

  // Instagram Business Account ID from environment (required for production)
  const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!INSTAGRAM_ACCOUNT_ID) {
    console.error('sendReply: INSTAGRAM_ACCOUNT_ID not set in environment');
    throw new Error('INSTAGRAM_ACCOUNT_ID required');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;

  try {
    const res = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: body },
      },
      {
        params: { access_token: process.env.PAGE_ACCESS_TOKEN },
      },
    );
    console.log("Reply sent successfully:", res.data);
  } catch (err) {
    // This will print the specific reason (e.g., "Permission denied" or "Invalid ID")
    console.error("sendReply failed:", err.response?.data || err.message);
  }
}

module.exports = { sendReply };
