import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { bountiesRouter } from './routes/bounties.js';
import { categoriesRouter } from './routes/categories.js';
import { priceRouter } from './routes/price.js';
import { ipfsRouter } from './routes/ipfs.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/bounties', bountiesRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/price', priceRouter);
  app.use('/api/ipfs', ipfsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}
