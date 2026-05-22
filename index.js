/**
 * GTCO TECH 16 — Topic 2: Instagram CX Assistant (Express webhook server).
 * Product truth in production: Topic 1 AI StoreBuilder (see storefrontApi.js).
 */
require('dotenv').config();
const express = require('express');
const { handleWebhook, verifyWebhook } = require('./webhook');
const { processMessage } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

/** Called by Lynk Assistant when keyword automations do not match a DM. */
app.post('/internal/dm', async (req, res) => {
  const secret = req.headers['x-cx-internal-secret'];
  const expected = process.env.CX_ASSISTANT_INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    return res.sendStatus(403);
  }

  const { event, merchantScopedId } = req.body || {};
  if (!event?.message?.text || !event?.sender?.id) {
    return res.status(400).json({ ok: false, message: 'Invalid DM event payload' });
  }

  res.status(202).json({ ok: true });

  try {
    await processMessage(event, {
      merchantScopedId: merchantScopedId ? String(merchantScopedId) : undefined,
    });
  } catch (err) {
    console.error('[internal/dm]', err.message || err);
  }
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});
