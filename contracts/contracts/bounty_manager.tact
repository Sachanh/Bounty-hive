import "./messages.tact";
import "./payout_distributor.tact";

// `BountyManager` is the single contract that manages every bounty on the
// platform — there is no per-bounty deployment. Each bounty is a row in
// `bounties: map<uint64, Bounty>`, which keeps the platform's on-chain
// footprint small, predictable, and easy to index from one address.
//
// Security patterns applied throughout (see inline notes at each handler):
//   • Checks-effects-interactions — persistent state is always updated
//     *before* any `send()`, so a bounced/replayed/duplicated message can
//     never observe stale state and double-spend. This is TON's analogue of
//     guarding against reentrancy (TVM has no synchronous external calls, but
//     a contract can still receive multiple messages whose ordering and
//     bounce behaviour must be handled defensively).
//   • Explicit `sender()` checks gate every privileged action (creator-only,
//     owner-only, distributor-only).
//   • `now()`-based time checks enforce the bounty lifecycle (open window,
//     selection window, grace period) directly on-chain.
//   • Cashback — every handler returns unused attached value to its sender
//     (`self.cashback`) or, on creation, the precise excess over the computed
//     requirement (`self.cashbackExcess`) — so users are never overcharged.
//   • A `paused` switch and single `owner` give the platform an emergency
//     brake and a fee-tuning lever; `TransferOwnership` is the seam where a
//     multisig can be swapped in later without changing the rest of the
//     contract.
contract BountyManager {
    owner: Address;
    platformWallet: Address;
    platformFeeBps: Int as uint16;   // basis points, e.g. 500 == 5%
    creationFee: Int as coins;       // small flat TON fee charged on bounty creation
    paused: Bool;

    nextBountyId: Int as uint64;
    bounties: map<Int as uint64, Bounty>;

    init(owner: Address, platformWallet: Address, platformFeeBps: Int, creationFee: Int) {
        require(platformFeeBps <= MAX_PLATFORM_FEE_BPS, "BountyManager: fee exceeds the 20% hard cap");
        self.owner = owner;
        self.platformWallet = platformWallet;
        self.platformFeeBps = platformFeeBps;
        self.creationFee = creationFee;
        self.paused = false;
        self.nextBountyId = 1;
        self.bounties = emptyMap();
    }

    // Accepts plain-TON / empty-body messages — notably the deploy "ping" sent
    // by `sendDeploy`, and any direct top-ups of the manager's balance.
    receive() {}

    // ───────────────────────────── Bounty lifecycle ──────────────────────

    // Anyone may create a bounty — the platform is fully permissionless.
    // The creator funds: full prize (escrowed) + platform fee (on top,
    // configurable) + flat creation fee + gas. Minimum-prize policy is
    // enforced off-chain (frontend UI); the contract accepts any positive
    // amount that can be split evenly enough to pay every winner something.
    receive(msg: CreateBounty) {
        require(!self.paused, "BountyManager: platform is currently paused");
        require(isAllowedDuration(msg.durationSeconds), "BountyManager: duration must be one of 2h/4h/8h/12h/24h");
        require(msg.numWinners > 0, "BountyManager: must have at least one winner slot");
        require(msg.prize > 0, "BountyManager: prize must be positive");

        let prizePerWinner: Int = msg.prize / msg.numWinners;
        require(prizePerWinner > 0, "BountyManager: prize is too small to split across the requested winners");

        let platformFee: Int = (msg.prize * self.platformFeeBps) / BPS_DENOMINATOR;
        let totalRequired: Int = msg.prize + platformFee + self.creationFee + GAS_RESERVE;
        require(context().value >= totalRequired, "BountyManager: attached TON does not cover prize + fees + gas");

        let bountyId: Int = self.nextBountyId;
        self.nextBountyId = bountyId + 1;

        let createdAt: Int = now();
        let expiryAt: Int = createdAt + msg.durationSeconds;

        // Effects: persist the new bounty before any value leaves the contract.
        self.bounties.set(bountyId, Bounty{
            creator: sender(),
            prize: msg.prize,
            durationSeconds: msg.durationSeconds,
            createdAt: createdAt,
            expiryAt: expiryAt,
            status: STATUS_OPEN,
            numWinners: msg.numWinners,
            prizePerWinner: prizePerWinner,
            submissionCount: 0,
            contentCid: msg.contentCid,
            distributor: null,
        });

        // Interactions: forward fee + creation fee to the platform wallet.
        let feeToPlatform: Int = platformFee + self.creationFee;
        if (feeToPlatform > 0) {
            send(SendParameters{
                to: self.platformWallet,
                value: feeToPlatform,
                mode: SendPayGasSeparately | SendIgnoreErrors,
                bounce: false,
                body: emptyCell(),
            });
        }

        emit(BountyCreated{
            bountyId: bountyId,
            creator: sender(),
            prize: msg.prize,
            platformFee: platformFee,
            durationSeconds: msg.durationSeconds,
            createdAt: createdAt,
            expiryAt: expiryAt,
            numWinners: msg.numWinners,
            contentCid: msg.contentCid,
        }.toCell());

        // Cashback: refund exactly the excess over what was required — the
        // prize and fees themselves must stay put, so a blanket
        // "remaining value" cashback would be wrong here.
        self.cashbackExcess(totalRequired);
    }

    // Open to absolutely anyone — no allow-list, no gating. Full submission
    // content lives on IPFS; the contract only needs to bump a counter and
    // emit an indexable event carrying the CID, keeping on-chain storage flat
    // regardless of how many people participate.
    receive(msg: Submit) {
        let bounty: Bounty = self.requireBounty(msg.bountyId);
        require(bounty.status == STATUS_OPEN, "BountyManager: bounty is not open for submissions");
        require(now() < bounty.expiryAt, "BountyManager: submission window has closed");

        let index: Int = bounty.submissionCount;
        bounty.submissionCount = index + 1;
        self.bounties.set(msg.bountyId, bounty);

        emit(ParticipationSubmitted{
            bountyId: msg.bountyId,
            submissionIndex: index,
            submitter: sender(),
            proofCid: msg.proofCid,
            submittedAt: now(),
        }.toCell());

        self.cashback(sender());
    }

    // Only the creator, only after expiry, only within the grace period.
    // Selecting winners is the single state transition that releases the
    // escrowed prize — everything about it is validated before any value
    // moves, and the move itself is delegated to a dedicated
    // `PayoutDistributor` so this contract never loops `send()` an unbounded
    // number of times.
    receive(msg: SelectWinners) {
        let bounty: Bounty = self.requireBounty(msg.bountyId);
        require(sender() == bounty.creator, "BountyManager: only the creator can select winners");
        require(bounty.status == STATUS_OPEN, "BountyManager: winners already finalized or bounty is closed");
        require(now() >= bounty.expiryAt, "BountyManager: cannot select winners before the bounty expires");
        require(now() <= bounty.expiryAt + GRACE_PERIOD_SECONDS, "BountyManager: grace period has elapsed — refund instead");

        // The full winner roster must be supplied — no partially-filled slots.
        let i: Int = 0;
        while (i < bounty.numWinners) {
            require(msg.winners.get(i) != null, "BountyManager: winner list must assign every slot (0..numWinners-1)");
            i += 1;
        }

        // Deterministically derive this bounty's distributor address *before*
        // mutating state, so we can both store it for later verification and
        // deploy to it in the same handler.
        let initState: StateInit = initOf PayoutDistributor(
            myAddress(),
            msg.bountyId,
            bounty.creator,
            msg.winners,
            bounty.numWinners,
            bounty.prizePerWinner,
        );
        let distributor: Address = contractAddress(initState);

        // Effects before interactions: finalize bounty state — including the
        // registered distributor address used to authenticate the eventual
        // `PayoutBatchComplete` callback — before any value is forwarded.
        bounty.status = STATUS_PAID;
        bounty.distributor = distributor;
        self.bounties.set(msg.bountyId, bounty);

        emit(WinnersSelected{
            bountyId: msg.bountyId,
            numWinners: bounty.numWinners,
            prizePerWinner: bounty.prizePerWinner,
            selectedAt: now(),
        }.toCell());

        // Forward the entire prize pool plus a reserve sized to the number of
        // payout batches the distributor will need to run (see
        // `payoutBatchCount` / PAYOUT_STEP_GAS in messages.tact). Deploying
        // with an explicit `body` both initializes the contract and kicks off
        // the first batch in a single message.
        let reserve: Int = payoutBatchCount(bounty.numWinners) * PAYOUT_STEP_GAS + PAYOUT_BASE_RESERVE;
        send(SendParameters{
            to: distributor,
            value: bounty.prize + reserve,
            mode: SendIgnoreErrors,
            bounce: false,
            code: initState.code,
            data: initState.data,
            body: DistributePayouts{ startIndex: 0 }.toCell(),
        });

        self.cashback(sender());
    }

    // Lets a creator cancel a bounty *before* it has received any submissions
    // and *before* expiry — i.e. only when cancelling can't possibly cheat a
    // participant out of a fair shot. A closed bounty becomes refundable.
    receive(msg: CloseBounty) {
        let bounty: Bounty = self.requireBounty(msg.bountyId);
        require(sender() == bounty.creator, "BountyManager: only the creator can close the bounty");
        require(bounty.status == STATUS_OPEN, "BountyManager: bounty cannot be closed in its current state");
        require(now() < bounty.expiryAt, "BountyManager: bounty already expired — claim a refund instead");
        require(bounty.submissionCount == 0, "BountyManager: cannot close a bounty that already has submissions");

        bounty.status = STATUS_CLOSED;
        self.bounties.set(msg.bountyId, bounty);

        emit(BountyClosed{ bountyId: msg.bountyId, closedAt: now() }.toCell());

        self.cashback(sender());
    }

    // Returns the escrowed prize to the creator. Reachable in two cases:
    //   1. The bounty was `CloseBounty`'d (creator-only, any time after close).
    //   2. The bounty expired, the creator never selected winners, *and* the
    //      48h grace period has now also elapsed — at which point *anyone*
    //      may trigger the refund (always paid to the original creator). This
    //      is the safety valve that guarantees funds can never be stuck
    //      forever behind an unresponsive creator.
    receive(msg: ClaimRefund) {
        let bounty: Bounty = self.requireBounty(msg.bountyId);
        require(bounty.prize > 0, "BountyManager: nothing to refund");

        let graceElapsed: Bool = now() > bounty.expiryAt + GRACE_PERIOD_SECONDS;

        if (bounty.status == STATUS_CLOSED) {
            require(sender() == bounty.creator, "BountyManager: only the creator can claim a refund for a closed bounty");
        } else if (bounty.status == STATUS_OPEN && graceElapsed) {
            // Open-ended trigger by design — see doc comment above.
        } else {
            require(false, "BountyManager: bounty is not yet eligible for a refund");
        }

        let amount: Int = bounty.prize;

        // Effects before interactions: zero out the escrow and flip status to
        // a terminal state before sending — makes this handler safe even if
        // somehow invoked twice in quick succession (the second call sees
        // `prize == 0` and reverts at the guard above).
        bounty.status = STATUS_REFUNDED;
        bounty.prize = 0;
        self.bounties.set(msg.bountyId, bounty);

        send(SendParameters{
            to: bounty.creator,
            value: amount,
            mode: SendPayGasSeparately | SendIgnoreErrors,
            bounce: false,
            body: emptyCell(),
        });

        emit(Refunded{
            bountyId: msg.bountyId,
            recipient: bounty.creator,
            amount: amount,
            refundedAt: now(),
        }.toCell());

        self.cashback(sender());
    }

    // ──────────────────── PayoutDistributor completion callback ──────────

    // Only the exact distributor address registered for this bounty at
    // `SelectWinners` time may report completion — recomputing and comparing
    // `bounty.distributor` (rather than trusting the message's claimed
    // bountyId) prevents a malicious or unrelated contract from spoofing a
    // `PayoutDistributed` event.
    receive(msg: PayoutBatchComplete) {
        let bounty: Bounty = self.requireBounty(msg.bountyId);
        require(bounty.distributor != null, "BountyManager: no distributor is registered for this bounty");
        require(sender() == bounty.distributor!!, "BountyManager: completion must come from the registered distributor");

        emit(PayoutDistributed{
            bountyId: msg.bountyId,
            totalPaid: msg.totalPaid,
            winnerCount: msg.winnerCount,
            distributedAt: now(),
        }.toCell());

        self.cashback(sender());
    }

    // ───────────────────────────── Admin (owner-only) ────────────────────
    //
    // A single `owner` address keeps things simple for launch. Every admin
    // message funnels through `requireOwner`, and `TransferOwnership` is the
    // one seam that needs to change to swap in a multisig (e.g. point `owner`
    // at a multisig wallet contract address — no other code changes needed).

    receive(msg: SetPaused) {
        self.requireOwner();
        self.paused = msg.paused;
        self.cashback(sender());
    }

    receive(msg: SetPlatformFee) {
        self.requireOwner();
        require(msg.feeBps <= MAX_PLATFORM_FEE_BPS, "BountyManager: fee exceeds the 20% hard cap");
        self.platformFeeBps = msg.feeBps;
        self.cashback(sender());
    }

    receive(msg: SetCreationFee) {
        self.requireOwner();
        self.creationFee = msg.creationFee;
        self.cashback(sender());
    }

    receive(msg: SetPlatformWallet) {
        self.requireOwner();
        self.platformWallet = msg.wallet;
        self.cashback(sender());
    }

    receive(msg: TransferOwnership) {
        self.requireOwner();
        self.owner = msg.newOwner;
        self.cashback(sender());
    }

    // ───────────────────────────── Getters ───────────────────────────────

    get fun bounty(bountyId: Int): Bounty? {
        return self.bounties.get(bountyId);
    }

    get fun bountyCount(): Int {
        return self.nextBountyId - 1;
    }

    get fun config(): PlatformConfig {
        return PlatformConfig{
            owner: self.owner,
            platformWallet: self.platformWallet,
            platformFeeBps: self.platformFeeBps,
            creationFee: self.creationFee,
            paused: self.paused,
            bountyCount: self.nextBountyId - 1,
        };
    }

    // Convenience getter mirroring the on-chain validation in `CreateBounty` —
    // lets the frontend preview exactly how much TON a creation will require.
    get fun quoteCreation(prize: Int): CreationQuote {
        let platformFee: Int = (prize * self.platformFeeBps) / BPS_DENOMINATOR;
        return CreationQuote{
            prize: prize,
            platformFee: platformFee,
            creationFee: self.creationFee,
            gasReserve: GAS_RESERVE,
            totalRequired: prize + platformFee + self.creationFee + GAS_RESERVE,
        };
    }

    // ───────────────────────────── Internals ─────────────────────────────

    fun requireBounty(bountyId: Int): Bounty {
        let bounty: Bounty? = self.bounties.get(bountyId);
        require(bounty != null, "BountyManager: bounty does not exist");
        return bounty!!;
    }

    fun requireOwner() {
        require(sender() == self.owner, "BountyManager: caller is not the owner");
    }

    // Returns the *entire remaining value* of the inbound message back to
    // `to`, net of gas already spent processing this transaction. Used by
    // every handler that doesn't itself need to retain or forward the
    // attached value — the caller never has to guess how much gas to send.
    fun cashback(to: Address) {
        send(SendParameters{
            to: to,
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            bounce: false,
            body: emptyCell(),
        });
    }

    // Returns precisely `context().value - required` to the sender — used by
    // `CreateBounty`, where the prize + fees must remain in the contract and a
    // blanket "remaining value" cashback would incorrectly claw them back.
    fun cashbackExcess(required: Int) {
        let excess: Int = context().value - required;
        if (excess > 0) {
            send(SendParameters{
                to: sender(),
                value: excess,
                mode: SendIgnoreErrors,
                bounce: false,
                body: emptyCell(),
            });
        }
    }
}

struct CreationQuote {
    prize: Int as coins;
    platformFee: Int as coins;
    creationFee: Int as coins;
    gasReserve: Int as coins;
    totalRequired: Int as coins;
}
