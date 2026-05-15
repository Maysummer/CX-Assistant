const axios = require("axios");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";

async function sendReply(recipientId, text) {
  const maxLen = 1000;
  const body = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;

  // Use the Instagram Business Account ID from your Meta Dashboard
  // It looks like 178414... in your screenshot
  const INSTAGRAM_ACCOUNT_ID = "17841403795491164";
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
