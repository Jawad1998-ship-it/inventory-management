import { Router } from 'express';
import crypto from 'crypto';

export const router = Router();

// Placeholder install flow (you will replace with @shopify/shopify-api OAuth helpers)
router.get('/install', (req, res) => {
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).send('Missing shop');
  // Redirect to Shopify OAuth (placeholder)
  return res.json({ next: 'oauth', shop });
});

router.get('/callback', (_req, res) => {
  // TODO: Validate HMAC, exchange code for token, store shop + token
  return res.json({ installed: true });
});

// Webhooks receiver (Shopify sends HMAC via X-Shopify-Hmac-Sha256)
router.post('/webhook', (req, res) => {
  const hmac = req.header('X-Shopify-Hmac-Sha256');
  const secret = process.env.SHOPIFY_API_SECRET || '';
  const digest = crypto
    .createHmac('sha256', secret)
    .update(Buffer.from(JSON.stringify(req.body)))
    .digest('base64');
  if (!hmac || hmac !== digest) return res.status(401).send('Invalid signature');

  // TODO: enqueue events for processing (orders/create, inventory_levels/update, etc.)
  res.status(200).send('ok');
});
