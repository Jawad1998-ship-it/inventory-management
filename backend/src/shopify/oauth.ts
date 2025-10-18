import { randomBytes, createHmac } from 'crypto';

export function generateState() {
  return randomBytes(16).toString('hex');
}

export function buildInstallUrl(shop: string) {
  const key = process.env.SHOPIFY_API_KEY || '';
  const scopes = (process.env.SHOPIFY_SCOPES || '').replace(/\s+/g, '');
  const callback = new URL('/shopify/callback', process.env.SHOPIFY_APP_URL || 'http://localhost:4000').toString();
  const state = generateState();
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', key);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

export function validateHmacFromQuery(shopifySecret: string, query: Record<string, any>) {
  const hmac = query['hmac'] as string | undefined;
  if (!hmac) return false;
  const qs = Object.keys(query)
    .filter((k) => k !== 'signature' && k !== 'hmac')
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`)
    .join('&');
  const digest = createHmac('sha256', shopifySecret).update(qs).digest('hex');
  return digest === hmac;
}
