import { Router } from 'express';
import fetch from 'node-fetch';
import { prisma } from '../lib/prisma.js';

export const router = Router();

// List saved channels
router.get('/channels', async (_req, res) => {
  const channels = await prisma.channel.findMany();
  res.json(channels);
});

// Publish ATS to Shopify for all variants with inventory items
router.post('/shopify/sync-ats', async (req, res) => {
  try {
    const shop = (req.query.shop as string)?.toLowerCase();
    if (!shop) return res.status(400).send('Missing shop');
    const channel = await prisma.channel.findUnique({ where: { id: shop } });
    if (!channel?.token) return res.status(400).send('No token for shop');
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
    // ensure default location id
    let locationId = channel.shopifyDefaultLocationId;
    if (!locationId) {
      const locResp = await fetch(`https://${shop}/admin/api/${apiVersion}/locations.json`, {
        headers: { 'X-Shopify-Access-Token': channel.token },
      });
      if (locResp.ok) {
        const locData = (await locResp.json()) as any;
        const first = (locData.locations || [])[0];
        if (first?.id) {
          locationId = String(first.id);
          await prisma.channel.update({ where: { id: channel.id }, data: { shopifyDefaultLocationId: locationId } });
        }
      }
    }
    if (!locationId) return res.status(400).send('No Shopify location');

    const variants = await prisma.variant.findMany({ where: { shopifyInventoryItemId: { not: null } } });
    let updated = 0;
    for (const v of variants) {
      // compute ATS (global)
      const levels = await prisma.inventoryLevel.aggregate({
        _sum: { onHand: true, reserved: true, incoming: true, safetyBuffer: true },
        where: { variantId: v.id },
      });
      const onHand = levels._sum.onHand ?? 0;
      const reserved = levels._sum.reserved ?? 0;
      const incoming = levels._sum.incoming ?? 0;
      const buffer = levels._sum.safetyBuffer ?? 0;
      const ats = Math.max(onHand - reserved + incoming - buffer, 0);

      await fetch(`https://${shop}/admin/api/${apiVersion}/inventory_levels/set.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': channel.token,
        },
        body: JSON.stringify({ location_id: Number(locationId), inventory_item_id: Number(v.shopifyInventoryItemId), available: ats }),
      });
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// Import products + variants from Shopify by SKU (basic)
router.post('/shopify/import', async (req, res) => {
  try {
    const shop = (req.query.shop as string)?.toLowerCase();
    if (!shop) return res.status(400).send('Missing shop');
    const channel = await prisma.channel.findUnique({ where: { id: shop } });
    if (!channel?.token) return res.status(400).send('No token for shop');

    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
    // ensure default shopify location id cached on channel
    if (!channel.shopifyDefaultLocationId) {
      const locResp = await fetch(`https://${shop}/admin/api/${apiVersion}/locations.json`, {
        headers: { 'X-Shopify-Access-Token': channel.token },
      });
      if (locResp.ok) {
        const locData = (await locResp.json()) as any;
        const first = (locData.locations || [])[0];
        if (first?.id) {
          await prisma.channel.update({ where: { id: channel.id }, data: { shopifyDefaultLocationId: String(first.id) } });
          channel.shopifyDefaultLocationId = String(first.id);
        }
      }
    }

    let url = `https://${shop}/admin/api/${apiVersion}/products.json?limit=250`;
    const created: { products: number; variants: number } = { products: 0, variants: 0 };

    const tenantId = 'default';
    const defaultLocation = await prisma.location.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', tenantId, name: 'Default', code: 'DEFAULT' },
    });

    while (url) {
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': channel.token } });
      if (!resp.ok) throw new Error(`Shopify error ${resp.status}`);
      const data = (await resp.json()) as any;
      for (const p of (data.products || [])) {
        const prod = await prisma.product.upsert({
          where: { id: p.id.toString() },
          update: { title: p.title },
          create: { id: p.id.toString(), tenantId, title: p.title },
        });
        for (const v of (p.variants || [])) {
          if (!v.sku) continue;
          const variant = await prisma.variant.upsert({
            where: { sku: v.sku },
            update: {
              productId: prod.id,
              barcode: v.barcode || null,
              shopifyVariantId: String(v.id),
              shopifyInventoryItemId: String(v.inventory_item_id),
            },
            create: {
              sku: v.sku,
              productId: prod.id,
              barcode: v.barcode || null,
              shopifyVariantId: String(v.id),
              shopifyInventoryItemId: String(v.inventory_item_id),
            },
          });
          await prisma.inventoryLevel.upsert({
            where: { variantId_locationId: { variantId: variant.id, locationId: defaultLocation.id } },
            update: {},
            create: { variantId: variant.id, locationId: defaultLocation.id },
          });
          created.variants++;
        }
        created.products++;
      }
      // pagination via Link header
      const link = resp.headers.get('link');
      const match = link?.match(/<([^>]+)>; rel="next"/);
      url = match ? match[1] : '';
    }

    res.json({ ok: true, created, defaultShopifyLocation: channel.shopifyDefaultLocationId });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});
