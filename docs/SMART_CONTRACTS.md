# TONBounty — Smart Contracts

Source: [`contracts/contracts/`](../contracts/contracts). Written in [Tact](https://docs.tact-lang.org/),
built and tested via [Blueprint](https://github.com/ton-org/blueprint).

## Overview

| Contract | Role |
|---|---|
| `BountyFactory` | Single permissionless entry point; validates and deploys `Bounty` instances |
| `Bounty` | Per-bounty escrow holding native TON; accepts open submissions; pays out winners |
| `messages.tact` | Shared messages, structs, duration constants, and validation helpers |

## Fixed durations

Bounty durations are restricted to exactly five values, enforced by `isAllowedDuration`:

```
DURATION_2H  =  7,200 seconds
DURATION_4H  = 14,400 seconds
DURATION_8H  = 28,800 seconds
DURATION_12H = 43,200 seconds
DURATION_24H = 86,400 seconds
```

Both `BountyFactory.CreateBounty` and `Bounty.init` re-validate this — a malformed or malicious
client cannot bypass it by calling the `Bounty` constructor directly.

## `$0.10`-per-winner minimum & the price attestation

TVM contracts cannot make HTTP calls, so live pricing must be **attested off-chain and verified
on-chain**. The flow:

1. The backend relay (`backend/src/services/omniston.ts`) polls Omniston for the TON/USD price.
2. It encodes `(tonUsdPriceMilli: uint64, timestamp: uint32)` into a 12-byte payload
   (`attestationPayload`) and signs it with an ed25519 keypair. `tonUsdPriceMilli` is the price in
   **milli-dollars per TON** (e.g. `$5.1234/TON` → `5123`).
3. The signature + payload are served via `GET /api/price/attestation` and embedded by the frontend
   into the `CreateBounty` message.
4. `BountyFactory.receive(CreateBounty)`:
   - checks `now() - priceTimestamp <= 300` (price must be ≤ 5 minutes old),
   - calls `verifyPriceAttestation(priceMilli, timestamp, signature)` — **a placeholder that must be
     wired to a real `checkSignature`/`checkDataSignature` call** against the configured
     `priceOracle` public key before mainnet,
   - computes `usdMilliValue = (rewardPerWinner * tonUsdPriceMilli) / 1e9` and requires it to be
     `>= MIN_REWARD_PER_WINNER_USD_MILLIS` (100 milli-dollars == `$0.10`).

This keeps the **$0.10 minimum enforced trustlessly on-chain** without requiring a TVM-callable
oracle contract — the contract only needs to verify a signature from a key it already trusts.

> **Fixed-point convention**: all USD amounts in the contracts are expressed in *milli-dollars*
> (`$1.00` == `1000`). `MIN_REWARD_PER_WINNER_USD_MILLIS = 100` therefore represents `$0.10`.

## Message reference (`messages.tact`)

| Message | op | Direction | Purpose |
|---|---|---|---|
| `CreateBounty` | `0x42435201` | client → `BountyFactory` | Create & fund a new bounty |
| `BountyCreated` | `0x42435202` | `BountyFactory` → log (emit) | Indexed by the backend |
| `Submit` | `0x42435210` | anyone → `Bounty` | Register a submission (open, no allow-list) |
| `SubmissionLinked` | `0x42435211` | `Bounty` → log (emit) | Indexed by the backend |
| `SelectWinners` | `0x42435220` | creator → `Bounty` | Select winners post-deadline; triggers payout |
| `WinnersSelected` | `0x42435221` | `Bounty` → log (emit) | Indexed by the backend |
| `BountyPaidOut` | `0x42435222` | `Bounty` → log (emit) | Indexed by the backend |
| `ReclaimExpired` | `0x42435230` | creator → `Bounty` | Reclaim escrow if zero submissions at deadline |

All op-codes are mirrored in `backend/src/services/ton.ts` (`OP`) and
`frontend/src/hooks/useCreateBounty.ts` so the indexer and the client encode/decode messages
identically to the contracts.

## `Bounty` lifecycle

```
   init()                Submit (anyone, open)         SelectWinners (creator, post-deadline)
     │                          │                                  │
     ▼                          ▼                                  ▼
 [escrow funded]  ──►  [accepting submissions]  ──►  [winners finalized + paid out in TON]
     │                          │
     │                          └─── deadline reached, zero submissions ───► ReclaimExpired (creator)
     ▼
 [deadline = createdAt + durationSeconds]
```

Key invariants enforced in `bounty.tact`:
- `Submit` is rejected once `now() >= deadline` or winners are finalized — anyone may call it before
  then, with **no gating whatsoever**.
- `SelectWinners` requires `sender() == creator`, `now() >= deadline`, winners not yet finalized,
  and at least one submission to choose from.
- Payout (`payoutWinners`) sends `rewardPerWinner` in native TON to each selected winner address
  directly — no intermediate claim step — and refunds any dust to the creator.
- `paidOut` is a one-way latch; payout can only happen once.

## Building, testing, deploying

See [`contracts/README.md`](../contracts/README.md) for commands. In short:

```bash
cd contracts
npm install
npm run build   # compiles messages.tact / bounty.tact / bounty_factory.tact via tact.config.json
npm run test    # @ton/sandbox + Jest specs in tests/
PRICE_ORACLE_ADDRESS=<relay-address> npm run deploy
```

## Before mainnet

- [ ] Replace the placeholder `verifyPriceAttestation` with real ed25519 signature verification.
- [ ] Decide on oracle key custody / rotation (single relay vs. quorum).
- [ ] Run a third-party audit — these contracts move user funds directly.
- [ ] Add fuzz/property tests around winner-selection edge cases (duplicate addresses, partial
      slot fills, zero-submission expiry).
