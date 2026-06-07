import { useEffect, useState } from 'react';

// Live TON/USD price sourced from Omniston (https://docs.ston.fi/docs/developer-section/omniston),
// used to:
//   1. enforce the $0.10-minimum-per-winner rule client-side (UX — the contract
//      re-validates against a signed attestation, see contracts/README.md), and
//   2. quote "Swap & Fund" routes for users paying with USDT/other tokens.
//
// NOTE: this hook talks to Omniston's HTTP/WebSocket endpoint directly for the
// *display* price. The *attested* price embedded in on-chain transactions comes
// from the backend (`api.getPriceAttestation`), which signs it with the relay key
// the BountyFactory contract trusts.

const OMNISTON_API_URL = import.meta.env.VITE_OMNISTON_API_URL ?? 'https://omni-ws.ston.fi';

export type OmnistonPrice = {
  tonUsd: number;
  updatedAt: number;
};

export function useOmnistonPrice(pollIntervalMs = 15_000) {
  const [price, setPrice] = useState<OmnistonPrice | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        // Omniston exposes asset price quotes via its quoting API; the exact
        // path/payload depends on the SDK version you wire in — see the
        // Omniston developer docs for the canonical TON/USDT quote endpoint.
        const res = await fetch(`${OMNISTON_API_URL}/v1/assets/price?base=TON&quote=USD`);
        if (!res.ok) throw new Error(`Omniston price request failed: ${res.status}`);
        const data = (await res.json()) as { price: number; timestamp: number };
        if (!cancelled) {
          setPrice({ tonUsd: data.price, updatedAt: data.timestamp });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Failed to fetch TON/USD price'));
      }
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { price, error };
}

// Returns the minimum TON (as a float) that must be allocated per winner so
// that `rewardPerWinner * tonUsd >= MIN_REWARD_PER_WINNER_USD`.
export function minRewardPerWinnerTon(tonUsd: number, minUsd = 0.1): number {
  if (tonUsd <= 0) return Infinity;
  return minUsd / tonUsd;
}
