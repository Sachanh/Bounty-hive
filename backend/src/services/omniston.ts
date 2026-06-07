import axios from 'axios';
import { sign } from '@ton/crypto';

import { env } from '../config/env.js';

// Relays Omniston's live TON/USD price into a signed attestation that the
// on-chain BountyFactory contract can verify (see
// contracts/contracts/bounty_factory.tact -> verifyPriceAttestation and
// docs/SMART_CONTRACTS.md for the exact wire format / fixed-point convention).
//
// TVM contracts cannot make HTTP calls, so this relay is the bridge: it
// fetches the price from Omniston, timestamps it, signs `(price, timestamp)`
// with an ed25519 keypair whose public key is registered as `priceOracle` on
// the factory, and serves the attestation over `/api/price/attestation`.

const omnistonClient = axios.create({ baseURL: env.OMNISTON_API_URL, timeout: 5_000 });
const oraclePrivateKey = Buffer.from(env.PRICE_ORACLE_PRIVATE_KEY, 'hex');

export type PriceAttestation = {
  /** TON/USD price expressed in milli-dollars per TON (e.g. $5.1234 -> 5123). */
  tonUsdPriceMilli: bigint;
  timestamp: number;
  /** Hex-encoded ed25519 signature over `attestationPayload(tonUsdPriceMilli, timestamp)`. */
  signature: string;
};

let cached: PriceAttestation | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export function attestationPayload(tonUsdPriceMilli: bigint, timestamp: number): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeBigUInt64BE(tonUsdPriceMilli, 0);
  buf.writeUInt32BE(timestamp, 8);
  return buf;
}

async function fetchTonUsdPriceMilli(): Promise<bigint> {
  // Omniston's asset price/quote endpoint — see
  // https://docs.ston.fi/docs/developer-section/omniston for the canonical
  // request shape for a TON/USDT reference quote.
  const { data } = await omnistonClient.get<{ price: number }>('/v1/assets/price', {
    params: { base: 'TON', quote: 'USD' },
  });
  // Convert a floating-point USD price into fixed-point milli-dollars
  // (matches `MIN_REWARD_PER_WINNER_USD_MILLIS` conventions in messages.tact).
  return BigInt(Math.round(data.price * 1000));
}

export async function getPriceAttestation(forceRefresh = false): Promise<PriceAttestation> {
  const now = Date.now();
  if (!forceRefresh && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const tonUsdPriceMilli = await fetchTonUsdPriceMilli();
  const timestamp = Math.floor(now / 1000);
  const signature = sign(attestationPayload(tonUsdPriceMilli, timestamp), oraclePrivateKey);

  cached = { tonUsdPriceMilli, timestamp, signature: signature.toString('hex') };
  cachedAt = now;
  return cached;
}
