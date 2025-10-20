import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import { router as healthRouter } from './routes/health.js';
import { router as shopifyRouter } from './routes/shopify.js';
import { router as adminRouter } from './routes/admin.js';

const app = express();
// Allow embedding inside Shopify admin iframe
app.use(
  helmet({
    frameguard: false, // remove X-Frame-Options
    contentSecurityPolicy: false, // we'll set our own CSP below
  })
);
// Shopify requires these ancestors for embedded apps
app.use((_, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
  );
  next();
});

app.use(cors());
// Important: ensure raw body for Shopify webhooks before JSON parser
app.use('/shopify/webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json({ type: ['application/json', 'application/cloudevents+json'] }));
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/shopify', shopifyRouter);
app.use('/admin', adminRouter);

app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'inventory-sync-backend' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
