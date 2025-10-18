import { Router } from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import cookie from 'cookie';
import bodyParser from 'body-parser';
import { buildInstallUrl, validateHmacFromQuery } from '../shopify/oauth.js';
import { prisma } from '../lib/prisma.js';

export const router = Router();

// Start OAuth install
router.get('/install', (req, res) => {
  const shop = (req.query.shop as string | undefined)?.toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) return res.status(400).send('Missing/invalid shop');
  const { url, state } = buildInstallUrl(shop);
  res.setHeader('Set-Cookie', cookie.serialize('shopify_state', state, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' }));
  return res.redirect(url);
});

// OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const query = req.query as Record<string, any>;
    const shop = (query['shop'] as string)?.toLowerCase();
    const code = query['code'] as string;
    const state = query['state'] as string;
    const cookies = cookie.parse(req.headers.cookie || '');
    const expectedState = cookies['shopify_state'];
    if (!shop || !code || !state || state !== expectedState) return res.status(401).send('Invalid state');
    const secret = process.env.SHOPIFY_API_SECRET || '';
    if (!validateHmacFromQuery(secret, query)) return res.status(401).send('Invalid HMAC');

    // Exchange code for access token
    const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: secret, code }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).send(`Token exchange failed: ${text}`);
    }
    const { access_token } = (await resp.json()) as { access_token: string };

    // Ensure a tenant and channel record
    const tenant = await prisma.tenant.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', name: 'Default' },
    });
    await prisma.channel.upsert({
      where: { id: shop },
      update: { token: access_token, kind: 'SHOPIFY' },
      create: { id: shop, kind: 'SHOPIFY', tenantId: tenant.id, shop, token: access_token },
    });

    // Register basic webhooks (orders/create, inventory_levels/update)
    const host = process.env.SHOPIFY_APP_URL?.replace(/\/$/, '') || '';
    const webhookAddress = `${host}/shopify/webhook`;
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
    const topics = ['orders/create', 'inventory_levels/update'];
    for (const topic of topics) {
      await fetch(`https://${shop}/admin/api/${apiVersion}/webhooks.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': access_token,
        },
        body: JSON.stringify({ webhook: { topic, address: webhookAddress, format: 'json' } }),
      }).catch(() => {});
    }

    // Redirect back to app in admin
    res.send('App installed. You can close this window.');
  } catch (err: any) {
    res.status(500).send(err?.message || 'OAuth error');
  }
});

// Webhooks receiver: must use raw body for HMAC
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.header('X-Shopify-Hmac-Sha256');
  const topic = req.header('X-Shopify-Topic') || '';
  const shop = (req.header('X-Shopify-Shop-Domain') || '').toLowerCase();
  const secret = process.env.SHOPIFY_API_SECRET || '';
  const digest = crypto.createHmac('sha256', secret).update(req.body as Buffer).digest('base64');
  if (!hmac || hmac !== digest) return res.status(401).send('Invalid signature');

  try {
    const payload = JSON.parse((req.body as Buffer).toString('utf8'));

    if (topic === 'orders/create') {
      // Reserve stock by SKU
      for (const li of payload.line_items || []) {
        const sku = li.sku as string | undefined;
        const qty = Number(li.quantity || 0);
        if (!sku || !qty) continue;
        const variant = await prisma.variant.findUnique({ where: { sku } });
        if (variant) {
          await prisma.reservation.create({ data: { variantId: variant.id, quantity: qty, source: `shopify:${shop}`, orderId: String(payload.id) } });
          await prisma.inventoryLevel.updateMany({ where: { variantId: variant.id }, data: { reserved: { increment: qty } } });
        }
      }
    }

    if (topic === 'inventory_levels/update') {
      // Optionally update onHand by SKU if present (simplified)
      // payload does not include SKU, real implementation must map inventory_item_id -> SKU.
    }

    res.status(200).send('ok');
  } catch (e) {
    res.status(500).send('handler error');
  }
});
