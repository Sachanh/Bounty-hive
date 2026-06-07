import "./messages.tact";

// `Bounty` is the per-bounty escrow contract. It is deployed by `BountyFactory`,
// holds the full reward pool in native TON, accepts open submissions, and pays
// out winners selected by the creator once the (fixed) duration has elapsed.
//
// Design notes:
//  - Value & critical state live here: escrowed balance, deadline, submitter
//    list (by address), winner selection, payout. This is the source of truth.
//  - Rich content (description, submission write-ups) is referenced only by
//    IPFS CID — the backend indexer resolves and serves the full content.
contract Bounty {
    bountyId: Int as uint64;
    factory: Address;
    creator: Address;

    contentCid: Slice;
    durationSeconds: Int as uint32;
    createdAt: Int as uint32;
    deadline: Int as uint32;

    winnerSlots: Int as uint8;
    rewardPerWinner: Int as coins;

    submissionCount: Int as uint32;
    submitters: map<Int as uint32, Address>;   // index -> submitter (open participation)
    proofCids: map<Int as uint32, Slice>;       // index -> IPFS CID of proof

    winners: map<Int as uint8, Address>;
    winnersFinalized: Bool;
    paidOut: Bool;

    init(
        bountyId: Int,
        factory: Address,
        creator: Address,
        contentCid: Slice,
        durationSeconds: Int,
        winnerSlots: Int,
        rewardPerWinner: Int,
    ) {
        require(isAllowedDuration(durationSeconds), "Bounty: duration must be one of 2h/4h/8h/12h/24h");
        require(winnerSlots > 0, "Bounty: must have at least one winner slot");
        require(rewardPerWinner > 0, "Bounty: reward per winner must be positive");

        self.bountyId = bountyId;
        self.factory = factory;
        self.creator = creator;

        self.contentCid = contentCid;
        self.durationSeconds = durationSeconds;
        self.createdAt = now();
        self.deadline = self.createdAt + durationSeconds;

        self.winnerSlots = winnerSlots;
        self.rewardPerWinner = rewardPerWinner;

        self.submissionCount = 0;
        self.submitters = emptyMap();
        self.proofCids = emptyMap();

        self.winners = emptyMap();
        self.winnersFinalized = false;
        self.paidOut = false;
    }

    // Anyone may submit — there is no allow-list or gating of any kind.
    receive(msg: Submit) {
        require(now() < self.deadline, "Bounty: submission window has closed");
        require(!self.winnersFinalized, "Bounty: winners already selected");

        let index: Int = self.submissionCount;
        self.submitters.set(index, sender());
        self.proofCids.set(index, msg.proofCid);
        self.submissionCount = index + 1;

        emit(SubmissionLinked {
            bountyId: self.bountyId,
            submitter: sender(),
            proofCid: msg.proofCid,
            submittedAt: now(),
        }.toCell());
    }

    // Only the creator may select winners, and only after the deadline has passed.
    receive(msg: SelectWinners) {
        require(sender() == self.creator, "Bounty: only the creator can select winners");
        require(now() >= self.deadline, "Bounty: cannot select winners before the deadline");
        require(!self.winnersFinalized, "Bounty: winners already selected");
        require(self.submissionCount > 0, "Bounty: no submissions to select from");

        let count: Int = 0;
        let i: Int = 0;
        while (i < self.winnerSlots) {
            let winner: Address? = msg.winners.get(i);
            if (winner != null) {
                self.winners.set(i, winner!!);
                count += 1;
            }
            i += 1;
        }
        require(count > 0, "Bounty: must select at least one winner");

        self.winnersFinalized = true;

        emit(WinnersSelected {
            bountyId: self.bountyId,
            winners: self.winners,
            selectedAt: now(),
        }.toCell());

        self.payoutWinners();
    }

    // Lets the creator reclaim escrowed TON if the deadline passed with zero
    // submissions — guards against funds being permanently locked.
    receive(msg: ReclaimExpired) {
        require(sender() == self.creator, "Bounty: only the creator can reclaim");
        require(now() >= self.deadline, "Bounty: cannot reclaim before the deadline");
        require(self.submissionCount == 0, "Bounty: cannot reclaim once submissions exist");
        require(!self.paidOut, "Bounty: already paid out");

        self.paidOut = true;
        send(SendParameters {
            to: self.creator,
            value: 0,
            mode: SendRemainingBalance | SendIgnoreErrors,
            body: msg.reason.asCell(),
        });
    }

    // Internal: pays the full reward pool out to the selected winners in native TON.
    fun payoutWinners() {
        require(!self.paidOut, "Bounty: already paid out");
        self.paidOut = true;

        let total: Int = 0;
        let i: Int = 0;
        while (i < self.winnerSlots) {
            let winner: Address? = self.winners.get(i);
            if (winner != null) {
                send(SendParameters {
                    to: winner!!,
                    value: self.rewardPerWinner,
                    mode: SendIgnoreErrors,
                    body: emptyCell(),
                });
                total += self.rewardPerWinner;
            }
            i += 1;
        }

        emit(BountyPaidOut {
            bountyId: self.bountyId,
            totalPaid: total,
            paidAt: now(),
        }.toCell());

        // Return any remaining dust/change to the creator.
        send(SendParameters {
            to: self.creator,
            value: 0,
            mode: SendRemainingBalance | SendIgnoreErrors,
            body: emptyCell(),
        });
    }

    get fun bountyInfo(): BountyInfo {
        return BountyInfo {
            bountyId: self.bountyId,
            creator: self.creator,
            contentCid: self.contentCid,
            durationSeconds: self.durationSeconds,
            createdAt: self.createdAt,
            deadline: self.deadline,
            winnerSlots: self.winnerSlots,
            rewardPerWinner: self.rewardPerWinner,
            submissionCount: self.submissionCount,
            winnersFinalized: self.winnersFinalized,
            paidOut: self.paidOut,
        };
    }

    get fun submission(index: Int): Submission? {
        let submitter: Address? = self.submitters.get(index);
        let proofCid: Slice? = self.proofCids.get(index);
        if (submitter == null || proofCid == null) {
            return null;
        }
        return Submission {
            submitter: submitter!!,
            proofCid: proofCid!!,
        };
    }

    get fun winnerAt(slot: Int): Address? {
        return self.winners.get(slot);
    }
}

struct BountyInfo {
    bountyId: Int as uint64;
    creator: Address;
    contentCid: Slice;
    durationSeconds: Int as uint32;
    createdAt: Int as uint32;
    deadline: Int as uint32;
    winnerSlots: Int as uint8;
    rewardPerWinner: Int as coins;
    submissionCount: Int as uint32;
    winnersFinalized: Bool;
    paidOut: Bool;
}

struct Submission {
    submitter: Address;
    proofCid: Slice;
}
