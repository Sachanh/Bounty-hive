import { Router } from 'express';

import { supabase, type BountyRow, type SubmissionRow } from '../db/client.js';

export const bountiesRouter = Router();

function serializeBounty(row: BountyRow) {
  return {
    id: row.id,
    onchainId: row.onchain_id,
    contractAddress: row.contract_address,
    creatorAddress: row.creator_address,
    title: row.title,
    category: row.category,
    durationSeconds: row.duration_seconds,
    deadline: row.deadline,
    winnerSlots: row.winner_slots,
    rewardPerWinnerNanoTon: row.reward_per_winner_nanoton,
    submissionCount: row.submission_count,
    status: row.status,
  };
}

function serializeSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    bountyId: row.bounty_id,
    submitterAddress: row.submitter_address,
    proofCid: row.proof_cid,
    proofPreview: row.proof_preview,
    submittedAt: row.submitted_at,
    isWinner: row.is_winner,
  };
}

// GET /api/bounties?category=&status=&search=
bountiesRouter.get('/', async (req, res) => {
  const { category, status, search } = req.query as Record<string, string | undefined>;

  let query = supabase.from('bounties').select('*').order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);
  if (search) query = query.textSearch('title', search, { type: 'websearch', config: 'english' });

  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });

  res.json((data ?? []).map(serializeBounty));
});

// GET /api/bounties/:id
bountiesRouter.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('bounties').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Bounty not found' });

  res.json({ ...serializeBounty(data), descriptionCid: data.description_cid, descriptionMarkdown: data.description_markdown });
});

// GET /api/bounties/:id/submissions
bountiesRouter.get('/:id/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('bounty_id', req.params.id)
    .order('submitted_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json((data ?? []).map(serializeSubmission));
});

