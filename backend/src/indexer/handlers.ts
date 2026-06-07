import { supabase } from '../db/client.js';

const DURATION_TO_DEADLINE = (createdAt: Date, durationSeconds: number) =>
  new Date(createdAt.getTime() + durationSeconds * 1000);

export async function upsertBountyFromCreatedEvent(input: {
  onchainId: bigint;
  contractAddress: string;
  creatorAddress: string;
  contentCid: string;
  durationSeconds: number;
  winnerSlots: number;
  rewardPerWinnerNanoTon: bigint;
  title: string;
  descriptionMarkdown: string;
  category: string;
  tags: string[];
}) {
  const createdAt = new Date();
  const { error } = await supabase.from('bounties').upsert(
    {
      onchain_id: input.onchainId.toString(),
      contract_address: input.contractAddress,
      creator_address: input.creatorAddress,
      title: input.title,
      category: input.category,
      tags: input.tags,
      description_cid: input.contentCid,
      description_markdown: input.descriptionMarkdown,
      duration_seconds: input.durationSeconds,
      created_at: createdAt.toISOString(),
      deadline: DURATION_TO_DEADLINE(createdAt, input.durationSeconds).toISOString(),
      winner_slots: input.winnerSlots,
      reward_per_winner_nanoton: input.rewardPerWinnerNanoTon.toString(),
      submission_count: 0,
      status: 'open',
    },
    { onConflict: 'onchain_id' },
  );

  if (error) console.error('[indexer] failed to upsert bounty:', error);
}

export async function recordSubmission(input: {
  onchainBountyId: bigint;
  submitterAddress: string;
  proofCid: string;
  proofPreview: string;
  submittedAt: number;
}) {
  const bounty = await findBountyByOnchainId(input.onchainBountyId);
  if (!bounty) return;

  const { error: insertError } = await supabase.from('submissions').upsert(
    {
      bounty_id: bounty.id,
      submitter_address: input.submitterAddress,
      proof_cid: input.proofCid,
      proof_preview: input.proofPreview,
      submitted_at: new Date(input.submittedAt * 1000).toISOString(),
      is_winner: false,
    },
    { onConflict: 'bounty_id,submitter_address,proof_cid' },
  );
  if (insertError) {
    console.error('[indexer] failed to record submission:', insertError);
    return;
  }

  const { error: updateError } = await supabase
    .from('bounties')
    .update({ submission_count: bounty.submission_count + 1 })
    .eq('id', bounty.id);
  if (updateError) console.error('[indexer] failed to bump submission_count:', updateError);
}

export async function recordWinners(input: { onchainBountyId: bigint }) {
  const bounty = await findBountyByOnchainId(input.onchainBountyId);
  if (!bounty) return;

  const { error } = await supabase.from('bounties').update({ status: 'awaiting_selection' }).eq('id', bounty.id);
  if (error) console.error('[indexer] failed to mark bounty awaiting_selection:', error);

  // Marking individual `submissions.is_winner = true` requires decoding the
  // `winners` dictionary from the WinnersSelected event payload — see the
  // note in indexer/processor.ts about using Tact's generated wrapper.
}

export async function markBountyPaidOut(input: { onchainBountyId: bigint; totalPaidNanoTon: bigint }) {
  const bounty = await findBountyByOnchainId(input.onchainBountyId);
  if (!bounty) return;

  const { error } = await supabase.from('bounties').update({ status: 'completed' }).eq('id', bounty.id);
  if (error) console.error('[indexer] failed to mark bounty completed:', error);
}

async function findBountyByOnchainId(onchainId: bigint) {
  const { data, error } = await supabase
    .from('bounties')
    .select('id, submission_count')
    .eq('onchain_id', onchainId.toString())
    .maybeSingle();

  if (error) {
    console.error('[indexer] failed to look up bounty:', error);
    return null;
  }
  return data;
}
