import { Cell } from '@ton/core';

import { supabase } from '../db/client.js';
import { bountyFactoryAddress, tonClient, OP } from '../services/ton.js';
import { pinJson } from '../services/ipfs.js';
import { upsertBountyFromCreatedEvent, recordSubmission, recordWinners, markBountyPaidOut } from './handlers.js';

const CURSOR_ID = 'bounty_factory';

/**
 * Polls toncenter for new transactions on the BountyFactory address (and, by
 * extension, the Bounty instances it deploys — addresses are derived
 * deterministically via `contractAddress(initOf Bounty(...))`), decodes the
 * event bodies emitted via `emit(...)` in the Tact contracts, and persists a
 * normalized read model.
 *
 * This is intentionally written against toncenter's `getTransactions` for
 * portability — swap in a TonAPI/Anton subscription or a Pub/Sub stream for
 * higher-throughput production indexing without changing the handler layer.
 */
export async function processNewTransactions() {
  const { data: cursor } = await supabase
    .from('indexer_cursor')
    .select('last_lt, last_hash')
    .eq('id', CURSOR_ID)
    .single();

  const transactions = await tonClient.getTransactions(bountyFactoryAddress, {
    limit: 50,
    lt: cursor?.last_lt ? String(cursor.last_lt) : undefined,
    hash: cursor?.last_hash ?? undefined,
    archival: true,
  });

  // toncenter returns newest-first; process oldest-first so cursor advances monotonically.
  for (const tx of [...transactions].reverse()) {
    for (const message of tx.outMessages.values()) {
      if (message.info.type !== 'external-out') continue;
      const body = message.body.beginParse();
      if (body.remainingBits < 32) continue;

      const op = body.loadUint(32);
      await handleEvent(op, body);
    }
  }

  if (transactions.length > 0) {
    const latest = transactions[0];
    await supabase
      .from('indexer_cursor')
      .update({ last_lt: latest.lt.toString(), last_hash: latest.hash().toString('base64'), updated_at: new Date().toISOString() })
      .eq('id', CURSOR_ID);
  }
}

async function handleEvent(op: number, body: ReturnType<Cell['beginParse']>) {
  switch (op) {
    case OP.BountyCreated: {
      const bountyId = body.loadUintBig(64);
      const bountyAddress = body.loadAddress();
      const creator = body.loadAddress();
      const durationSeconds = body.loadUint(32);
      const winnerSlots = body.loadUint(8);
      const rewardPerWinner = body.loadCoins();
      const contentCid = body.loadStringRefTail();

      // Resolve the full description from IPFS so it's searchable in Postgres.
      const description = await resolveJsonFromCid<{ title: string; body: string; category: string; tags: string[] }>(
        contentCid,
      );

      await upsertBountyFromCreatedEvent({
        onchainId: bountyId,
        contractAddress: bountyAddress.toString(),
        creatorAddress: creator.toString(),
        contentCid,
        durationSeconds,
        winnerSlots,
        rewardPerWinnerNanoTon: rewardPerWinner,
        title: description?.title ?? `Bounty #${bountyId}`,
        descriptionMarkdown: description?.body ?? '',
        category: description?.category ?? 'General',
        tags: description?.tags ?? [],
      });
      break;
    }

    case OP.SubmissionLinked: {
      const bountyId = body.loadUintBig(64);
      const submitter = body.loadAddress();
      const proofCid = body.loadStringRefTail();
      const submittedAt = body.loadUint(32);

      const proof = await resolveJsonFromCid<{ summary: string }>(proofCid);
      await recordSubmission({
        onchainBountyId: bountyId,
        submitterAddress: submitter.toString(),
        proofCid,
        proofPreview: proof?.summary?.slice(0, 280) ?? '',
        submittedAt,
      });
      break;
    }

    case OP.WinnersSelected: {
      const bountyId = body.loadUintBig(64);
      // The `winners: map<Int as uint8, Address>` dictionary that follows is
      // best decoded with Tact's generated TypeScript wrapper (emitted under
      // contracts/build/Bounty/ once `npm run build` has been run in
      // contracts/), which knows the exact key/value serialization. Wire that
      // in here to mark the corresponding submissions `is_winner = true`.
      await recordWinners({ onchainBountyId: bountyId });
      break;
    }

    case OP.BountyPaidOut: {
      const bountyId = body.loadUintBig(64);
      const totalPaid = body.loadCoins();
      await markBountyPaidOut({ onchainBountyId: bountyId, totalPaidNanoTon: totalPaid });
      break;
    }

    default:
      break;
  }
}

async function resolveJsonFromCid<T>(cid: string): Promise<T | null> {
  try {
    // Re-pinning is a no-op for content already on IPFS; in production prefer
    // resolving through a gateway (IPFS_GATEWAY_URL) with retries/fallbacks.
    // This placeholder keeps the indexer self-contained for the scaffold.
    const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Re-export so handlers.ts can stay free of the IPFS dependency if desired.
export { pinJson };
