import { Router } from 'express';
import fetch from 'node-fetch';
import { prisma } from '../lib/prisma.js';

export const router = Router();

// List saved channels
router.get('/channels', async (_req, res) => {
  const channels = await prisma.channel.findMany();
  res.json(channels);
});

// Import products + variants from Shopify by SKU (basic)
router.post('/shopify/import', async (req, res) => {
  try {
    const shop = (req.query.shop as string)?.toLowerCase();
    if (!shop) return res.status(400).send('Missing shop');
    const channel = await prisma.channel.findUnique({ where: { id: shop } });
    if (!channel?.token) return res.status(400).send('No token for shop');

    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
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
      for (const p of data.products || []) {
        const prod = await prisma.product.upsert({
          where: { id: p.id.toString() },
          update: { title: p.title },
          create: { id: p.id.toString(), tenantId, title: p.title },
        });
        created.products++;
        for (const v of p.variants || []) {
          if (!v.sku) continue;
          const variant = await prisma.variant.upsert({
            where: { sku: v.sku },
            update: { productId: prod.id, barcode: v.barcode || null },
            create: { sku: v.sku, productId: prod.id, barcode: v.barcode || null },
          });
          await prisma.inventoryLevel.upsert({
            where: { variantId_locationId: { variantId: variant.id, locationId: defaultLocation.id } },
            update: {},
            create: { variantId: variant.id, locationId: defaultLocation.id },
          });
          created.variants++;
        }
      }
      // pagination via Link header
      const link = resp.headers.get('link');
      const match = link?.match(/<([^>]+)>; rel="next"/);
      url = match ? match[1] : '';
    }

    res.json({ ok: true, created });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});
