# `contracts/` — TONBounty Tact contracts

A [Blueprint](https://github.com/ton-org/blueprint) project containing the [Tact](https://docs.tact-lang.org/)
smart contracts that power TONBounty's on-chain escrow, submissions, and payouts.

## Architecture: one manager, many bounties

Unlike a factory-per-bounty design, **`BountyManager` is the single contract that manages every
bounty** — each bounty is a row in `bounties: map<uint64, Bounty>`. This keeps the platform's
on-chain footprint to one well-known address (simple to index, simple to audit, cheap to keep
alive) while still isolating the one operation that genuinely benefits from its own contract:
**paying out many winners**, handled by a small per-payout `PayoutDistributor` helper.

```
                 ┌───────────────────────────────────────────┐
                 │              BountyManager                │
                 │  owner, platformWallet, fees, paused      │
                 │  bounties: map<uint64, Bounty>            │
                 │                                           │
                 │  CreateBounty ─┐                          │
                 │  Submit        │  escrow + bookkeeping    │
                 │  SelectWinners ┤  (single contract,       │
                 │  CloseBounty   │   single address)        │
                 │  ClaimRefund ──┘                          │
                 └───────────────────┬───────────────────────┘
                                     │ on SelectWinners: deploys (initOf) +
                                     │ funds with the full prize pool
                                     ▼
                 ┌───────────────────────────────────────────┐
                 │            PayoutDistributor              │
                 │  one short-lived instance per bounty      │
                 │  pays winners in capped batches via       │
                 │  self-addressed continuation messages,    │
                 │  reports back, sweeps dust to creator,    │
                 │  then empties itself                      │
                 └───────────────────────────────────────────┘
```

## Contracts

### `BountyManager` (`contracts/bounty_manager.tact`)
The single, permissionless entry point for the entire platform.

**Bounty record (`Bounty` struct, `messages.tact`)** — `creator`, `prize`, `durationSeconds`,
`createdAt`, `expiryAt`, `status` (`Open`/`Closed`/`Paid`/`Refunded`), `numWinners`,
`prizePerWinner`, `submissionCount`, `contentCid` (IPFS), and `distributor` (set once winners are
selected, used to authenticate the payout-completion callback).

**Lifecycle messages:**
- `CreateBounty` — permissionless. Validates the duration against the fixed allow-list
  (`isAllowedDuration`: 2h/4h/8h/12h/24h), requires a positive prize that splits evenly enough to
  pay every winner something, computes the **platform fee** (`platformFeeBps`, configurable,
  hard-capped on-chain at 20%) **on top of** the prize, requires the attached value to cover
  `prize + platformFee + creationFee + gas`, escrows the full prize, forwards
  `platformFee + creationFee` to the platform wallet, stores the bounty, emits `BountyCreated`,
  and **cashes back the exact excess** over what was required.
- `Submit` — open to **anyone**, no allow-list, while `now() < expiryAt` and the bounty is `Open`.
  Bumps a counter and emits `ParticipationSubmitted` with the submitter + IPFS proof CID — full
  submission content lives off-chain (see "Why no on-chain submitter list?" below).
- `SelectWinners` — **creator-only**, only once `now() >= expiryAt` and within the 48-hour grace
  period (`GRACE_PERIOD_SECONDS`). Requires every winner slot (`0..numWinners-1`) to be filled,
  finalizes the bounty (`status = Paid`, records the deterministic `distributor` address),
  emits `WinnersSelected`, then deploys & funds a `PayoutDistributor` with the full prize pool plus
  a reserve sized to the number of payout batches required.
- `CloseBounty` — **creator-only**, only while `Open`, before expiry, and **only if zero
  submissions exist** (so cancelling can never cheat a participant who already did the work).
  Marks the bounty `Closed` and refundable.
- `ClaimRefund` — returns the escrowed prize to the creator. Reachable either (a) any time after a
  `Closed` bounty (creator-only), or (b) once an `Open` bounty has expired **and** its 48h grace
  period has also elapsed — at which point **anyone** may trigger the refund (always paid to the
  original creator), guaranteeing funds can never be permanently stuck behind an inactive creator.
- `PayoutBatchComplete` — internal callback from the registered `PayoutDistributor`; verified via
  `sender() == bounty.distributor` before the manager emits the indexable `PayoutDistributed` event.

**Admin messages (owner-only):** `SetPaused`, `SetPlatformFee` (≤ 20%), `SetCreationFee`,
`SetPlatformWallet`, `TransferOwnership`. A single `owner` address keeps launch simple;
`TransferOwnership` is the one seam to point at a multisig later without touching anything else.

**Getters:** `bounty(id)`, `bountyCount()`, `config()` (owner/fees/paused/count), and
`quoteCreation(prize)` — lets the frontend preview the exact `totalRequired` TON for a given prize
using the same arithmetic the contract enforces.

### `PayoutDistributor` (`contracts/payout_distributor.tact`)
A small, short-lived helper deployed fresh (via `initOf`/`contractAddress`) for each bounty whose
winners have just been selected. It implements the **batched continuation-message payout pattern**
used by `tact-lang/contract-payouts` and TON's NFT/Jetton batch-mint contracts:

1. Pay a fixed-size slice (`PAYOUT_BATCH_SIZE = 50`) of winners from the current index.
2. If more remain, send **itself** a `DistributePayouts{ startIndex }` continuation message and
   return — keeping each transaction's outbound-message count and gas usage bounded regardless of
   how many winners a bounty has (TON caps outbound actions per transaction at 255).
3. Once done, report `PayoutBatchComplete` back to `BountyManager` (which authenticates the sender
   against the bounty's registered `distributor` address) and sweep any leftover balance — split
   rounding "dust", bounced payments, unused gas — back to the bounty creator via
   `SendRemainingBalance`, emptying itself in the process.

### `messages.tact`
Shared structs (`Bounty`, `PlatformConfig`, `DistributionStatus`, `CreationQuote`), every inbound
message / admin message / manager↔distributor protocol message / indexing event (each with an
explicit, stable op code), the fixed duration & grace-period constants, fee-precision constants,
and the `isAllowedDuration` / `payoutBatchCount` helpers shared by both contracts.

## Why no on-chain submitter list?

`Bounty` only stores a `submissionCount`; the full `(submitter, proofCid)` pairs are emitted as
`ParticipationSubmitted` events and indexed off-chain (`backend/`). For a *single contract that
manages every bounty on the platform*, persistent storage cost matters platform-wide — keeping
per-submission state out of the manager's storage keeps it flat regardless of how many bounties or
participants the platform accumulates, while events give the indexer everything it needs. The
trade-off: the contract trusts the creator's winner selection rather than validating it against an
on-chain submitter set — which mirrors how bounty platforms work in practice (the creator judges
submission *quality*, which can't be done on-chain anyway).

## Security patterns applied

- **Checks-effects-interactions** (TON's analogue of reentrancy protection — TVM has no
  synchronous external calls, but a contract can still receive bounced/duplicated/replayed
  messages whose ordering must be handled defensively): every handler updates `self.bounties`
  **before** calling `send()`. E.g. `SelectWinners` flips `status = Paid` and records the
  distributor address before forwarding any value; `ClaimRefund` zeroes `bounty.prize` and flips to
  `Refunded` before sending — so a replay immediately fails the `prize > 0` / `status` guards.
- **Explicit sender checks** gate every privileged action: `sender() == bounty.creator` (select
  winners, close, creator-refund), `sender() == self.owner` (admin), and
  `sender() == bounty.distributor!!` (payout completion — prevents event spoofing).
- **Time checks** via `now()` enforce the entire lifecycle on-chain: submission window
  (`now() < expiryAt`), selection window (`expiryAt <= now() <= expiryAt + GRACE_PERIOD_SECONDS`),
  and the refund safety valve (`now() > expiryAt + GRACE_PERIOD_SECONDS`).
- **Cashback on every receive**: `cashback(to)` returns the remaining value of the inbound message
  (`SendRemainingValue | SendIgnoreErrors`, `bounce: false`) for bookkeeping-only handlers;
  `cashbackExcess(required)` returns *exactly* `context().value - required` for `CreateBounty`,
  where the prize and fees must stay escrowed. Nobody is ever overcharged for gas they didn't use.
- **Bounded outbound actions**: `PayoutDistributor`'s batch-and-continue design guarantees no
  transaction ever attempts more than `PAYOUT_BATCH_SIZE` sends, regardless of `numWinners`.
- **`paused` switch + owner**: `SetPaused` gives the platform an emergency brake on new bounty
  creation without affecting in-flight bounties (submissions, selection, refunds all still work —
  intentionally, so existing participants are never stranded by a pause).

## Project layout

```
contracts/
├── contracts/
│   ├── messages.tact            shared structs, messages, events, constants
│   ├── bounty_manager.tact      the single manager contract (map<uint64, Bounty>)
│   └── payout_distributor.tact  per-bounty multi-winner payout helper
├── wrappers/                    TypeScript wrappers (BountyManager.ts, PayoutDistributor.ts)
├── tests/                       Jest + @ton/sandbox tests (BountyManager.spec.ts)
├── scripts/
│   ├── deployBountyManager.ts          shared deploy routine (env-driven config)
│   ├── deployBountyManagerTestnet.ts   `npm run deploy:testnet`
│   └── deployBountyManagerMainnet.ts   `npm run deploy:mainnet` (requires CONFIRM_MAINNET=yes)
└── tact.config.json             Tact compiler project config
```

## Setup

```bash
npm install

# compile contracts (outputs to build/)
npm run build

# run sandbox tests
npm run test
```

## Deploying

Both deploy scripts share `deployBountyManager.ts` and read their configuration from environment
variables, so the exact same compiled artifact can be promoted from testnet to mainnet by changing
only the network and the env values:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PLATFORM_WALLET_ADDRESS` | ✅ | — | Wallet that receives platform + creation fees |
| `PLATFORM_FEE_BPS` | – | `500` (5%) | Basis points; hard-capped on-chain at `2000` (20%) |
| `CREATION_FEE_TON` | – | `0.1` | Flat TON fee charged per bounty creation |
| `CONFIRM_MAINNET` | mainnet only | — | Must be exactly `yes` to allow a mainnet deploy |

```bash
# Testnet — Blueprint will prompt you to choose/connect a testnet wallet
PLATFORM_WALLET_ADDRESS=<wallet-address> npm run deploy:testnet

# Mainnet — extra confirmation guard rail; review the printed config before approving in-wallet
PLATFORM_WALLET_ADDRESS=<wallet-address> CONFIRM_MAINNET=yes npm run deploy:mainnet
```

Both scripts print the deployed address along with the exact env vars to copy into
`frontend/.env` (`VITE_BOUNTY_MANAGER_ADDRESS`) and `backend/.env` (`BOUNTY_MANAGER_ADDRESS`).

## Notes on dictionary / map encodings

`wrappers/BountyManager.ts` builds the `winners: map<Int as uint16, Address>` payload for
`SelectWinners` using `Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Address())`,
matching the Tact-side `map<Int as uint16, Address>` serialization. If you regenerate contracts
with `npm run build`, Tact also emits fully-typed wrappers under `build/<Contract>/` — prefer
those (or cross-check the dictionary key/value codecs against them) if the map shape ever changes.
