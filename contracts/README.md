# `contracts/` — TONBounty Tact contracts

A [Blueprint](https://github.com/ton-org/blueprint) project containing the [Tact](https://docs.tact-lang.org/)
smart contracts that power TONBounty's on-chain escrow, submissions, and payouts.

## Contracts

### `BountyFactory` (`contracts/bounty_factory.tact`)
The single, permissionless entry point for creating bounties.

- Accepts a `CreateBounty` message carrying the IPFS content CID, duration, winner count,
  reward-per-winner, and a **signed TON/USD price attestation** from the trusted Omniston relay.
- Validates:
  - the duration is exactly one of `2h / 4h / 8h / 12h / 24h` (`isAllowedDuration`, `messages.tact`),
  - the price attestation is fresh (≤ 5 minutes old) and signed by the configured `priceOracle`,
  - `rewardPerWinner × tonUsdPrice ≥ $0.10` (the platform-wide minimum payout per winner),
  - enough native TON is attached to cover the full reward pool plus a gas reserve.
- Deploys a new `Bounty` instance via `initOf` + `contractAddress`, forwards the reward pool, and
  emits `BountyCreated` for the backend indexer.
- Refunds any excess attached TON back to the creator.

### `Bounty` (`contracts/bounty.tact`)
The per-bounty escrow. One instance per bounty, deployed by the factory.

- Holds the full native-TON reward pool.
- `Submit` — **anyone** may register a submission by sending an IPFS CID (no allow-list, open to all).
- `SelectWinners` — only the creator, only after the deadline, picks winners from the submitter set
  and the contract **pays out native TON directly** to each winner in the same transaction.
- `ReclaimExpired` — lets the creator reclaim escrowed TON if the deadline passes with zero
  submissions (prevents funds being stuck forever).
- Exposes `bountyInfo()`, `submission(index)`, `winnerAt(slot)` getters for the indexer/frontend.

### `messages.tact`
Shared message/struct definitions, the fixed duration constants (`DURATION_2H` … `DURATION_24H`),
the `$0.10`-per-winner constant, and the `isAllowedDuration` helper used by both contracts.

## Project layout

```
contracts/
├── contracts/
│   ├── messages.tact        shared messages, structs, constants
│   ├── bounty.tact          per-bounty escrow contract
│   └── bounty_factory.tact  factory / entry point contract
├── wrappers/                TypeScript wrappers (Bounty.ts, BountyFactory.ts)
├── tests/                   Jest + @ton/sandbox tests
├── scripts/                 Blueprint deploy scripts
└── tact.config.json         Tact compiler project config
```

## Setup

```bash
npm install

# compile contracts (outputs to build/)
npm run build

# run sandbox tests
npm run test

# deploy (requires PRICE_ORACLE_ADDRESS env var — see below)
PRICE_ORACLE_ADDRESS=<relay-address> npm run deploy
```

## Price oracle / Omniston integration

`BountyFactory` does **not** fetch prices itself — TVM contracts can't make HTTP calls. Instead:

1. The backend (`backend/src/services/omniston.ts`) polls **Omniston** for the live TON/USD price.
2. It signs `(price, timestamp)` with the relay's private key and exposes the attestation via the
   `/price/attestation` API.
3. The frontend includes that attestation in the `CreateBounty` message it sends through TON Connect.
4. `BountyFactory.verifyPriceAttestation` checks the signature against the configured `priceOracle`
   address before accepting the bounty (replace the placeholder `checkSignature` call with a real
   ed25519 verification once the relay's attestation format is finalized — see
   `docs/SMART_CONTRACTS.md`).

This keeps the **$0.10-per-winner minimum** enforced on-chain without requiring an oracle contract
or external TVM-callable price feed.

## Notes on dictionary / map encodings

The TypeScript wrappers in `wrappers/` sketch the message layout that mirrors the Tact `message(...)`
declarations in `messages.tact`. Once you run `npm run build`, Tact also emits fully-typed wrappers
under `build/<Contract>/` — prefer those generated wrappers (or merge their dictionary
serialization helpers into the hand-written ones here) for production use, especially for the
`map<Int as uint8, Address>` winner selection payload.
