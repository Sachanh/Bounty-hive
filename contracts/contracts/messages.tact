// Shared message & struct definitions for the TONBounty contracts.
//
// Durations are encoded as an enum-like set of constants (seconds) so the
// contract can reject any duration that isn't one of the allowed values:
// 2h, 4h, 8h, 12h, 24h.

const DURATION_2H: Int = 7200;
const DURATION_4H: Int = 14400;
const DURATION_8H: Int = 28800;
const DURATION_12H: Int = 43200;
const DURATION_24H: Int = 86400;

// Minimum reward per winner, expressed in nano-USD-cents (i.e. $0.10 == 10 cents == 1000 in
// hundredths-of-a-cent fixed point) compared against an attested TON/USD price. See
// `docs/SMART_CONTRACTS.md` for the fixed-point conventions used across the price oracle.
const MIN_REWARD_PER_WINNER_USD_MILLIS: Int = 100; // $0.10 expressed in milli-dollars

// ── Outgoing/incoming operation messages ────────────────────────────────────

// Sent to BountyFactory to deploy a new Bounty escrow.
message(0x42435201) CreateBounty {
    contentCid: Slice;          // IPFS CID of the bounty description (off-chain rich content)
    durationSeconds: Int as uint32;
    winnerSlots: Int as uint8;  // number of winners that will be paid out
    rewardPerWinner: Int as coins; // nanoTON reward promised to each winner
    tonUsdPriceMilli: Int as uint64; // attested TON/USD price (milli-dollars per TON) at creation time
    priceTimestamp: Int as uint32;   // unix time the price attestation was produced
    priceSignature: Slice;           // signature from the trusted Omniston relay over the price payload
}

// Emitted by BountyFactory once a Bounty instance has been deployed and funded.
message(0x42435202) BountyCreated {
    bountyId: Int as uint64;
    bountyAddress: Address;
    creator: Address;
    durationSeconds: Int as uint32;
    winnerSlots: Int as uint8;
    rewardPerWinner: Int as coins;
    contentCid: Slice;
}

// Sent by anyone to a Bounty contract to register a submission (open participation, no allow-list).
message(0x42435210) Submit {
    proofCid: Slice; // IPFS CID of the submission proof / writeup
}

// Emitted by a Bounty contract when a submission has been linked on-chain.
message(0x42435211) SubmissionLinked {
    bountyId: Int as uint64;
    submitter: Address;
    proofCid: Slice;
    submittedAt: Int as uint32;
}

// Sent by the bounty creator after the deadline to select winners and trigger payout.
message(0x42435220) SelectWinners {
    winners: map<Int as uint8, Address>; // slot index -> winner address
}

// Emitted once winners are recorded and payout has been queued.
message(0x42435221) WinnersSelected {
    bountyId: Int as uint64;
    winners: map<Int as uint8, Address>;
    selectedAt: Int as uint32;
}

// Emitted once native TON has been transferred to all winners.
message(0x42435222) BountyPaidOut {
    bountyId: Int as uint64;
    totalPaid: Int as coins;
    paidAt: Int as uint32;
}

// Allows the creator to reclaim escrowed TON if the bounty expires with zero submissions.
message(0x42435230) ReclaimExpired {
    reason: Slice;
}

inline fun isAllowedDuration(durationSeconds: Int): Bool {
    return durationSeconds == DURATION_2H
        || durationSeconds == DURATION_4H
        || durationSeconds == DURATION_8H
        || durationSeconds == DURATION_12H
        || durationSeconds == DURATION_24H;
}
