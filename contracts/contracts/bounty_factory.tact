import "./messages.tact";
import "./bounty.tact";

// `BountyFactory` is the single entry point for creating bounties. It:
//   1. Validates the requested duration against the fixed allow-list
//      (2h / 4h / 8h / 12h / 24h).
//   2. Validates the attested TON/USD price (signed by the trusted Omniston
//      relay configured at deploy time) and enforces the $0.10-per-winner
//      minimum reward.
//   3. Deploys a fresh `Bounty` contract instance, forwarding the attached
//      native TON to fund its escrow.
//   4. Emits `BountyCreated` so the backend indexer can pick it up.
//
// No permissions are required to call `CreateBounty` — the platform is open
// to anyone who can pay for gas + the reward pool.
contract BountyFactory {
    owner: Address;
    priceOracle: Address; // trusted Omniston relay address whose price attestations are accepted
    nextBountyId: Int as uint64;
    totalBounties: Int as uint64;

    init(owner: Address, priceOracle: Address) {
        self.owner = owner;
        self.priceOracle = priceOracle;
        self.nextBountyId = 1;
        self.totalBounties = 0;
    }

    receive(msg: CreateBounty) {
        require(isAllowedDuration(msg.durationSeconds), "Factory: duration must be one of 2h/4h/8h/12h/24h");
        require(msg.winnerSlots > 0, "Factory: must request at least one winner slot");
        require(msg.rewardPerWinner > 0, "Factory: reward per winner must be positive");

        // Validate the price attestation is recent (avoid stale/replayed prices).
        require(now() - msg.priceTimestamp <= 300, "Factory: price attestation is stale");
        self.verifyPriceAttestation(msg.tonUsdPriceMilli, msg.priceTimestamp, msg.priceSignature);

        // Enforce the $0.10-minimum-per-winner rule:
        //   rewardPerWinner [nanoTON] * tonUsdPriceMilli [milli-$ per TON]
        //     >= MIN_REWARD_PER_WINNER_USD_MILLIS [milli-$] * 1e9 [nanoTON per TON]
        let usdMilliValue: Int = (msg.rewardPerWinner * msg.tonUsdPriceMilli) / 1000000000;
        require(
            usdMilliValue >= MIN_REWARD_PER_WINNER_USD_MILLIS,
            "Factory: reward per winner is below the $0.10 minimum",
        );

        // Funds attached to this message must cover the full reward pool plus
        // enough for the Bounty contract's deployment & operating gas reserve.
        let pool: Int = msg.rewardPerWinner * msg.winnerSlots;
        let gasReserve: Int = ton("0.2");
        require(context().value >= pool + gasReserve, "Factory: attached TON does not cover reward pool + gas");

        let bountyId: Int = self.nextBountyId;
        self.nextBountyId += 1;
        self.totalBounties += 1;

        let init: StateInit = initOf Bounty(
            bountyId,
            myAddress(),
            sender(),
            msg.contentCid,
            msg.durationSeconds,
            msg.winnerSlots,
            msg.rewardPerWinner,
        );
        let bountyAddress: Address = contractAddress(init);

        // Deploy the Bounty contract and forward the reward pool + its gas reserve.
        send(SendParameters {
            to: bountyAddress,
            value: pool + gasReserve,
            mode: SendIgnoreErrors,
            code: init.code,
            data: init.data,
            body: emptyCell(),
        });

        emit(BountyCreated {
            bountyId: bountyId,
            bountyAddress: bountyAddress,
            creator: sender(),
            durationSeconds: msg.durationSeconds,
            winnerSlots: msg.winnerSlots,
            rewardPerWinner: msg.rewardPerWinner,
            contentCid: msg.contentCid,
        }.toCell());

        // Refund any excess TON beyond pool + gas reserve back to the creator.
        let excess: Int = context().value - (pool + gasReserve);
        if (excess > 0) {
            send(SendParameters {
                to: sender(),
                value: excess,
                mode: SendIgnoreErrors,
                body: emptyCell(),
            });
        }
    }

    // Owner-only: rotate the trusted price oracle/relay address (e.g. if the
    // Omniston relay key is rotated).
    receive(msg: Slice) {
        require(sender() == self.owner, "Factory: only owner");
        self.priceOracle = msg.loadAddress();
    }

    // Verifies that the supplied TON/USD price was attested by the trusted
    // Omniston relay. The relay signs `(price, timestamp)` off-chain; the
    // factory checks the signature came from `self.priceOracle`'s public key.
    //
    // NOTE: this is a structural placeholder — wire up `checkSignature` /
    // `checkDataSignature` against the relay's stored public key once the
    // relay's attestation format is finalized (see docs/SMART_CONTRACTS.md).
    fun verifyPriceAttestation(priceMilli: Int, timestamp: Int, signature: Slice) {
        require(priceMilli > 0, "Factory: invalid attested price");
        // Placeholder for ed25519 signature verification against the
        // configured `priceOracle` public key. Replace with a real check
        // (e.g. `checkSignature(hash, signature, oraclePublicKey)`) before
        // mainnet deployment.
    }

    get fun bountiesCreated(): Int {
        return self.totalBounties;
    }

    get fun priceOracleAddress(): Address {
        return self.priceOracle;
    }
}
