import { createClient } from '@supabase/supabase-js';

import { env } from '../config/env.js';

// Service-role client — used only on the backend (never exposed to the
// frontend). Holds the indexed read model: bounties, submissions, categories,
// and search metadata. The chain remains canonical for value & critical state;
// see docs/ARCHITECTURE.md for the split.
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export type BountyRow = {
  id: string;
  onchain_id: string;
  contract_address: string;
  creator_address: string;
  title: string;
  category: string;
  tags: string[];
  description_cid: string;
  description_markdown: string;
  duration_seconds: number;
  created_at: string;
  deadline: string;
  winner_slots: number;
  reward_per_winner_nanoton: string;
  submission_count: number;
  status: 'open' | 'awaiting_selection' | 'completed' | 'expired';
};

export type SubmissionRow = {
  id: string;
  bounty_id: string;
  submitter_address: string;
  proof_cid: string;
  proof_preview: string;
  submitted_at: string;
  is_winner: boolean;
};
