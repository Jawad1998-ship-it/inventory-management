import { Router } from 'express';

export const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});
