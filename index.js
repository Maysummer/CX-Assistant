/**
 * GTCO TECH 16 — Topic 2: Instagram CX Assistant (Express webhook server).
 * Product truth in production: Topic 1 AI StoreBuilder (see storefrontApi.js).
 */
require('dotenv').config();
const express = require('express');
const { handleWebhook, verifyWebhook } = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});
