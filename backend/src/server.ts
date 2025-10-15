import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { router as healthRouter } from './routes/health.js';
import { router as shopifyRouter } from './routes/shopify.js';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ type: ['application/json', 'application/cloudevents+json'] }));
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/shopify', shopifyRouter);

app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'inventory-sync-backend' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
