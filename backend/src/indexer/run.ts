import { processNewTransactions } from './processor.js';

// Entry point for the standalone indexer process (`npm run indexer`).
// Polls the BountyFactory address (and the Bounty instances it deploys) for
// new transactions, decodes the events defined in
// contracts/contracts/messages.tact, and upserts the read model in Postgres.
//
// In production this would typically run as its own worker/service so API
// latency is never coupled to chain-polling latency.

const POLL_INTERVAL_MS = 10_000;

async function loop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processNewTransactions();
    } catch (err) {
      console.error('[indexer] failed to process transactions:', err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

loop();
