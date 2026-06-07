import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[backend] TONBounty API listening on http://localhost:${env.PORT}`);
  console.log(`[backend] TON network: ${env.TON_NETWORK}`);
  console.log('[backend] Run `npm run indexer` in a separate process to index on-chain events.');
});
