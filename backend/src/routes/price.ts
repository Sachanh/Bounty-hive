import { Router } from 'express';

import { getPriceAttestation } from '../services/omniston.js';

export const priceRouter = Router();

// GET /api/price/attestation
//
// Returns a freshly signed TON/USD price attestation, sourced from Omniston
// and signed by the relay's ed25519 key (PRICE_ORACLE_PRIVATE_KEY). The
// frontend embeds this in the on-chain `CreateBounty` message so
// `BountyFactory.verifyPriceAttestation` can enforce the $0.10-per-winner
// minimum without the contract ever needing to fetch a price itself.
priceRouter.get('/attestation', async (_req, res) => {
  try {
    const attestation = await getPriceAttestation();
    res.json({
      tonUsdPriceMilli: attestation.tonUsdPriceMilli.toString(),
      timestamp: attestation.timestamp,
      signature: attestation.signature,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch price attestation' });
  }
});
