// ─────────────────────────────────────────────────────────────────────────
// Shared constants, structs, and messages for the TONBounty `BountyManager`
// (single contract managing all bounties via `map<uint64, Bounty>`) and its
// `PayoutDistributor` helper (batched multi-winner payout pattern).
// ─────────────────────────────────────────────────────────────────────────

// Allowed bounty durations, in seconds. Both the contract and the frontend UI
// enforce this — a bounty may run for exactly one of these durations.
const DURATION_2H: Int = 7200;
const DURATION_4H: Int = 14400;
const DURATION_8H: Int = 28800;
const DURATION_12H: Int = 43200;
const DURATION_24H: Int = 86400;

// Window after `expiryAt` during which the creator may still call
// `SelectWinners`. Once it elapses, anyone may trigger a refund to the
// creator so funds are never permanently stuck.
const GRACE_PERIOD_SECONDS: Int = 172800; // 48 hours

// Bounty status codes — stored as `Int as uint8` on `Bounty.status`.
const STATUS_OPEN: Int = 0;     // accepting submissions
const STATUS_CLOSED: Int = 1;   // creator cancelled early (no submissions yet) — refundable
const STATUS_PAID: Int = 2;     // winners selected; payout dispatched to PayoutDistributor
const STATUS_REFUNDED: Int = 3; // escrowed prize returned to the creator

// Platform fee precision — `platformFeeBps` is in basis points (1 bps = 0.01%).
const BPS_DENOMINATOR: Int = 10000;
const MAX_PLATFORM_FEE_BPS: Int = 2000; // hard cap: fee can never exceed 20%

// Gas reserved for bookkeeping sends so recipients always have enough to
// process (and, where relevant, bounce) safely. Any unused portion is always
// cashed back to the original sender — see `BountyManager.cashback`.
const GAS_RESERVE: Int = ton("0.05");

// Multi-winner payout tuning — mirrors the batching approach used in
// tact-lang/contract-payouts: a dedicated distributor contract pays winners
// in small fixed-size batches across multiple transactions (via
// self-addressed continuation messages) so a single transaction's outbound
// message count and gas usage stay bounded no matter how many winners a
// bounty has (TON caps outbound actions per transaction at 255).
const PAYOUT_BATCH_SIZE: Int = 50;
const PAYOUT_STEP_GAS: Int = ton("0.02");      // gas attached to each continuation / completion message
const PAYOUT_BASE_RESERVE: Int = ton("0.05");  // flat buffer on top of the per-batch estimate

inline fun isAllowedDuration(seconds: Int): Bool {
    return seconds == DURATION_2H
        || seconds == DURATION_4H
        || seconds == DURATION_8H
        || seconds == DURATION_12H
        || seconds == DURATION_24H;
}

// Number of batches a PayoutDistributor will need to fully pay `numWinners`
// winners — used by BountyManager to size the gas reserve forwarded at deploy.
inline fun payoutBatchCount(numWinners: Int): Int {
    return (numWinners + PAYOUT_BATCH_SIZE - 1) / PAYOUT_BATCH_SIZE;
}

// ── Core data ─────────────────────────────────────────────────────────────

struct Bounty {
    creator: Address;
    prize: Int as coins;             // net amount escrowed for winners (platform fee is charged on top, not deducted)
    durationSeconds: Int as uint32;
    createdAt: Int as uint32;
    expiryAt: Int as uint32;
    status: Int as uint8;            // STATUS_OPEN | STATUS_CLOSED | STATUS_PAID | STATUS_REFUNDED
    numWinners: Int as uint8;
    prizePerWinner: Int as coins;    // floor(prize / numWinners); remainder ("dust") returns to the creator after payout
    submissionCount: Int as uint32;  // count only — full submissions are emitted as events and indexed off-chain
    contentCid: String;              // IPFS CID of the bounty description
    distributor: Address?;           // set once SelectWinners deploys the PayoutDistributor for this bounty
}

struct PlatformConfig {
    owner: Address;
    platformWallet: Address;
    platformFeeBps: Int as uint16;
    creationFee: Int as coins;
    paused: Bool;
    bountyCount: Int as uint64;
}

struct DistributionStatus {
    bountyId: Int as uint64;
    totalWinners: Int as uint16;
    paidCount: Int as uint16;
    totalPaid: Int as coins;
    finalized: Bool;
}

// ── Inbound operations (BountyManager) ───────────────────────────────────

message(0x42440001) CreateBounty {
    contentCid: String;
    durationSeconds: Int as uint32;
    numWinners: Int as uint8;
    prize: Int as coins;
}

message(0x42440002) Submit {
    bountyId: Int as uint64;
    proofCid: String;
}

message(0x42440003) SelectWinners {
    bountyId: Int as uint64;
    winners: map<Int as uint16, Address>;
}

message(0x42440004) CloseBounty {
    bountyId: Int as uint64;
}

message(0x42440005) ClaimRefund {
    bountyId: Int as uint64;
}

// ── Admin operations (owner-only) ────────────────────────────────────────

message(0x42440010) SetPaused {
    paused: Bool;
}

message(0x42440011) SetPlatformFee {
    feeBps: Int as uint16;
}

message(0x42440012) SetCreationFee {
    creationFee: Int as coins;
}

message(0x42440013) SetPlatformWallet {
    wallet: Address;
}

message(0x42440014) TransferOwnership {
    newOwner: Address;
}

// ── Manager <-> PayoutDistributor protocol ───────────────────────────────

message(0x42440020) DistributePayouts {
    startIndex: Int as uint16;
}

message(0x42440021) PayoutBatchComplete {
    bountyId: Int as uint64;
    totalPaid: Int as coins;
    winnerCount: Int as uint16;
}

// ── Indexing events (emitted via `emit(...)`, never expected to be received) ─

message(0x42440100) BountyCreated {
    bountyId: Int as uint64;
    creator: Address;
    prize: Int as coins;
    platformFee: Int as coins;
    durationSeconds: Int as uint32;
    createdAt: Int as uint32;
    expiryAt: Int as uint32;
    numWinners: Int as uint8;
    contentCid: String;
}

message(0x42440101) ParticipationSubmitted {
    bountyId: Int as uint64;
    submissionIndex: Int as uint32;
    submitter: Address;
    proofCid: String;
    submittedAt: Int as uint32;
}

message(0x42440102) WinnersSelected {
    bountyId: Int as uint64;
    numWinners: Int as uint8;
    prizePerWinner: Int as coins;
    selectedAt: Int as uint32;
}

message(0x42440103) PayoutDistributed {
    bountyId: Int as uint64;
    totalPaid: Int as coins;
    winnerCount: Int as uint16;
    distributedAt: Int as uint32;
}

message(0x42440104) BountyClosed {
    bountyId: Int as uint64;
    closedAt: Int as uint32;
}

message(0x42440105) Refunded {
    bountyId: Int as uint64;
    recipient: Address;
    amount: Int as coins;
    refundedAt: Int as uint32;
}
