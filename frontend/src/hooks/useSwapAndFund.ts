import { useCallback, useState } from 'react';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { toNano } from '@ton/core';

const OMNISTON_API_URL = import.meta.env.VITE_OMNISTON_API_URL ?? 'https://omni-ws.ston.fi';

export type SwapAndFundParams = {
  /** Jetton the user wants to pay with, e.g. USDT master address. `null` means "pay with native TON". */
  fromAsset: { symbol: string; masterAddress: string | null; decimals: number } | null;
  /** Amount of `fromAsset` the user is willing to spend, in human units (e.g. "10" USDT). */
  fromAmountHuman: string;
  /** Final TON amount (nanoTON) that must land in escrow — reward pool + gas reserve. */
  requiredNanoTon: bigint;
  /** Address that should ultimately receive the swapped TON (the BountyFactory, forwarding to escrow). */
  recipient: string;
};

export type SwapQuote = {
  routeId: string;
  estimatedTonOut: bigint;
  priceImpactPct: number;
  minTonOut: bigint;
};

/**
 * Drives Omniston's "best route" swap quoting + execution so a user holding
 * USDT (or any other supported asset) can fund a bounty without ever manually
 * bridging to TON first — the platform still only ever escrows native TON.
 *
 * Flow:
 *   1. `quote()` asks Omniston for the best route from `fromAsset` -> TON.
 *   2. `execute()` builds and sends the swap transaction(s) via TON Connect;
 *      Omniston routes the resulting TON directly to `recipient`
 *      (the BountyFactory), which then forwards it into the new Bounty escrow.
 *
 * If `fromAsset` is `null`, this hook is a no-op passthrough — the caller
 * should just send the `CreateBounty` message directly with native TON.
 */
export function useSwapAndFund() {
  const [tonConnectUI] = useTonConnectUI();
  const userAddress = useTonAddress();

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchQuote = useCallback(async (params: SwapAndFundParams) => {
    if (!params.fromAsset) {
      setQuote(null);
      return null;
    }
    setIsQuoting(true);
    setError(null);
    try {
      // See Omniston's "Request for Quote" (RFQ) flow:
      // https://docs.ston.fi/docs/developer-section/omniston
      const res = await fetch(`${OMNISTON_API_URL}/v1/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { address: params.fromAsset.masterAddress, amount: params.fromAmountHuman },
          destination: { symbol: 'TON' },
          settlement: { recipient: params.recipient },
        }),
      });
      if (!res.ok) throw new Error(`Omniston quote failed: ${res.status}`);
      const data = (await res.json()) as { routeId: string; estimatedOut: string; priceImpactPct: number; minOut: string };
      const next: SwapQuote = {
        routeId: data.routeId,
        estimatedTonOut: BigInt(data.estimatedOut),
        priceImpactPct: data.priceImpactPct,
        minTonOut: BigInt(data.minOut),
      };
      setQuote(next);
      return next;
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to fetch swap quote');
      setError(e);
      return null;
    } finally {
      setIsQuoting(false);
    }
  }, []);

  const execute = useCallback(
    async (selectedQuote: SwapQuote) => {
      if (!userAddress) throw new Error('Connect a TON Connect wallet before swapping');
      setIsSwapping(true);
      setError(null);
      try {
        // Omniston returns a ready-to-sign transaction payload for the chosen
        // route; we forward it to the wallet via TON Connect. The resulting
        // TON lands at `recipient` (the BountyFactory) which immediately
        // forwards it into the freshly deployed Bounty's escrow.
        const res = await fetch(`${OMNISTON_API_URL}/v1/quotes/${selectedQuote.routeId}/transaction`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`Omniston transaction build failed: ${res.status}`);
        const tx = (await res.json()) as {
          validUntil: number;
          messages: { address: string; amount: string; payload?: string }[];
        };

        await tonConnectUI.sendTransaction({
          validUntil: tx.validUntil,
          messages: tx.messages.map((m) => ({ address: m.address, amount: m.amount, payload: m.payload })),
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Swap execution failed');
        setError(e);
        throw e;
      } finally {
        setIsSwapping(false);
      }
    },
    [tonConnectUI, userAddress],
  );

  return { quote, isQuoting, isSwapping, error, fetchQuote, execute };
}

export function tonAmountToNano(amountHuman: string): bigint {
  return toNano(amountHuman || '0');
}
