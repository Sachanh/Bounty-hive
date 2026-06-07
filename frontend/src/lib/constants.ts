// Bounty durations supported by the platform — must match the constants
// enforced on-chain in contracts/contracts/messages.tact (DURATION_2H ... DURATION_24H).
export const BOUNTY_DURATIONS = [
  { label: '2 hours', seconds: 2 * 60 * 60 },
  { label: '4 hours', seconds: 4 * 60 * 60 },
  { label: '8 hours', seconds: 8 * 60 * 60 },
  { label: '12 hours', seconds: 12 * 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
] as const;

export type BountyDurationSeconds = (typeof BOUNTY_DURATIONS)[number]['seconds'];

// Minimum reward each winner must receive, in USD — enforced both client-side
// (for UX) and on-chain (BountyFactory.verifyPriceAttestation + the $0.10 check).
export const MIN_REWARD_PER_WINNER_USD = 0.1;

export const NANOTON_PER_TON = 1_000_000_000n;
