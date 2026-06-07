import "./messages.tact";

// `PayoutDistributor` is a small, single-purpose helper contract deployed
// fresh by `BountyManager` for each bounty whose winners have just been
// selected. `BountyManager` forwards the *entire* prize pool plus a sized gas
// reserve to it; this contract is solely responsible for getting that TON to
// the winners.
//
// Why a separate contract instead of looping `send()` straight from
// BountyManager? Two reasons, both straight from the playbook used by
// tact-lang/contract-payouts and TON's NFT/Jetton batch-mint patterns:
//
//   1. TON caps the number of outbound actions (messages) a single
//      transaction may produce at 255. A bounty could in principle have many
//      more winners than fit in one transaction.
//   2. Even well under that cap, sending dozens of messages in one
//      transaction can blow through reasonable gas limits.
//
// The fix is to *batch and continue*: pay out a small, fixed-size slice of
// winners, then send a message to *yourself* asking to continue from where
// you left off. Each resulting transaction does a small, bounded amount of
// work, and the chain of self-messages naturally drains to completion. This
// keeps the design isolated, auditable, and reusable for any "pay N people"
// problem — not just bounties.
contract PayoutDistributor {
    manager: Address;                         // the BountyManager that deployed this distributor
    bountyId: Int as uint64;
    creator: Address;                         // bounty creator — receives any leftover dust + final balance
    winners: map<Int as uint16, Address>;     // index -> winner address (validated complete by BountyManager)
    totalWinners: Int as uint16;
    amountPerWinner: Int as coins;
    paidCount: Int as uint16;
    totalPaid: Int as coins;
    finalized: Bool;

    init(
        manager: Address,
        bountyId: Int,
        creator: Address,
        winners: map<Int as uint16, Address>,
        totalWinners: Int,
        amountPerWinner: Int,
    ) {
        self.manager = manager;
        self.bountyId = bountyId;
        self.creator = creator;
        self.winners = winners;
        self.totalWinners = totalWinners;
        self.amountPerWinner = amountPerWinner;
        self.paidCount = 0;
        self.totalPaid = 0;
        self.finalized = false;
    }

    // Kicks off (or continues) distribution. Triggerable only by the
    // BountyManager that deployed this instance, or by the contract itself
    // (the self-addressed continuation message) — nobody else can replay or
    // redirect a payout run.
    receive(msg: DistributePayouts) {
        require(sender() == self.manager || sender() == myAddress(), "PayoutDistributor: unauthorized trigger");
        require(!self.finalized, "PayoutDistributor: distribution already finalized");
        require(msg.startIndex == self.paidCount, "PayoutDistributor: out-of-order or replayed batch");

        let processed: Int = 0;
        let i: Int = msg.startIndex;
        while (i < self.totalWinners && processed < PAYOUT_BATCH_SIZE) {
            let winner: Address? = self.winners.get(i);
            if (winner != null && self.amountPerWinner > 0) {
                // `bounce: true` ensures that if a winner's address can't
                // accept the message (e.g. uninitialized with a restrictive
                // contract), the value bounces back to us rather than
                // vanishing — it ends up swept into the final dust transfer.
                send(SendParameters{
                    to: winner!!,
                    value: self.amountPerWinner,
                    mode: SendIgnoreErrors,
                    bounce: true,
                    body: emptyCell(),
                });
                self.totalPaid += self.amountPerWinner;
            }
            i += 1;
            processed += 1;
        }

        // Effects before interactions: persist progress before sending the
        // continuation/completion message, so a replay of this exact message
        // is rejected by the `startIndex == self.paidCount` guard above.
        self.paidCount = i;

        if (self.paidCount >= self.totalWinners) {
            self.finalized = true;

            // Tell BountyManager we're done so it can emit the indexable
            // `PayoutDistributed` event — BountyManager independently verifies
            // `sender() == bounty.distributor` before trusting this.
            send(SendParameters{
                to: self.manager,
                value: PAYOUT_STEP_GAS,
                mode: SendIgnoreErrors,
                bounce: false,
                body: PayoutBatchComplete{
                    bountyId: self.bountyId,
                    totalPaid: self.totalPaid,
                    winnerCount: self.totalWinners,
                }.toCell(),
            });

            // Sweep any leftover balance — split-rounding dust, bounced
            // payments, and unused gas reserve — back to the bounty creator.
            // This also empties the contract, so it costs the network nothing
            // to keep around.
            send(SendParameters{
                to: self.creator,
                value: 0,
                mode: SendRemainingBalance | SendIgnoreErrors,
                bounce: false,
                body: emptyCell(),
            });
        } else {
            // Continue from where we left off in a fresh transaction.
            send(SendParameters{
                to: myAddress(),
                value: PAYOUT_STEP_GAS,
                mode: SendIgnoreErrors,
                bounce: false,
                body: DistributePayouts{ startIndex: self.paidCount }.toCell(),
            });
        }
    }

    get fun distributionStatus(): DistributionStatus {
        return DistributionStatus{
            bountyId: self.bountyId,
            totalWinners: self.totalWinners,
            paidCount: self.paidCount,
            totalPaid: self.totalPaid,
            finalized: self.finalized,
        };
    }
}
