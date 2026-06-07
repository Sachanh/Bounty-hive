import { useCallback, useState } from 'react';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { beginCell, toNano, type Address } from '@ton/core';

import { api } from '@/lib/api';
import { ipfs } from '@/lib/ipfs';
import { NANOTON_PER_TON } from '@/lib/constants';

const BOUNTY_FACTORY_ADDRESS = import.meta.env.VITE_BOUNTY_FACTORY_ADDRESS as string;

// op codes must match contracts/contracts/messages.tact
const OP_CREATE_BOUNTY = 0x42435201;
const GAS_RESERVE_NANOTON = toNano('0.2');

export type CreateBountyInput = {
  title: string;
  body: string;
  category: string;
  tags: string[];
  durationSeconds: number;
  winnerSlots: number;
  rewardPerWinnerNanoTon: bigint;
};

/**
 * Orchestrates the full "create bounty" flow:
 *   1. Pin the description to IPFS (via the backend) → CID.
 *   2. Fetch a fresh signed TON/USD price attestation from the backend
 *      (relayed from Omniston) so the contract can verify the
 *      $0.10-per-winner minimum on-chain.
 *   3. Build and send the `CreateBounty` message to BountyFactory via TON
 *      Connect, attaching `rewardPerWinner * winnerSlots + gas reserve`
 *      worth of native TON.
 *
 * Funding with non-TON assets is handled upstream by `useSwapAndFund`, which
 * routes the swap output directly to the factory address before this message
 * is sent (or as part of the same TON Connect transaction batch).
 */
export function useCreateBounty() {
  const [tonConnectUI] = useTonConnectUI();
  const userAddress = useTonAddress();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createBounty = useCallback(
    async (input: CreateBountyInput) => {
      if (!userAddress) throw new Error('Connect a TON Connect wallet first');
      if (!BOUNTY_FACTORY_ADDRESS) throw new Error('VITE_BOUNTY_FACTORY_ADDRESS is not configured');

      setIsSubmitting(true);
      setError(null);
      try {
        const { cid: contentCid } = await ipfs.uploadBountyDescription({
          title: input.title,
          body: input.body,
          category: input.category,
          tags: input.tags,
        });

        const attestation = await api.getPriceAttestation();

        const pool = input.rewardPerWinnerNanoTon * BigInt(input.winnerSlots);
        const totalValue = pool + GAS_RESERVE_NANOTON;

        const body = beginCell()
          .storeUint(OP_CREATE_BOUNTY, 32)
          .storeStringRefTail(contentCid)
          .storeUint(input.durationSeconds, 32)
          .storeUint(input.winnerSlots, 8)
          .storeCoins(input.rewardPerWinnerNanoTon)
          .storeUint(BigInt(attestation.tonUsdPriceMilli), 64)
          .storeUint(attestation.timestamp, 32)
          .storeRef(beginCell().storeBuffer(Buffer.from(attestation.signature, 'hex')).endCell())
          .endCell();

        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 5 * 60,
          messages: [
            {
              address: BOUNTY_FACTORY_ADDRESS,
              amount: totalValue.toString(),
              payload: body.toBoc().toString('base64'),
            },
          ],
        });

        return { contentCid };
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Failed to create bounty');
        setError(e);
        throw e;
      } finally {
        setIsSubmitting(false);
      }
    },
    [tonConnectUI, userAddress],
  );

  return { createBounty, isSubmitting, error };
}

export function rewardToNanoTon(amountTon: number): bigint {
  return BigInt(Math.round(amountTon * Number(NANOTON_PER_TON)));
}

export function isFactoryAddressConfigured(): boolean {
  return Boolean(BOUNTY_FACTORY_ADDRESS);
}

export type { Address };
