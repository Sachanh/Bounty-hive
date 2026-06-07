# TONBounty — Architecture

## Goals

- **Native TON only** — bounties are funded, escrowed, and paid out exclusively in native TON.
  Users holding other assets can swap into TON inline via Omniston.
- **Open & permissionless** — no allow-lists, KYC, or admin gating for creating or participating.
- **Cheap on-chain footprint** — only value and critical state transitions live on-chain; rich
  content (descriptions, submissions) is stored on IPFS and indexed off-chain.
- **Verifiable minimums** — every winner must receive at least **$0.10** worth of TON, enforced
  on-chain against a signed live-price attestation.
- **Fixed durations** — `2h / 4h / 8h / 12h / 24h` only, validated both client-side and on-chain.

## System diagram

```
                                ┌──────────────────────────────┐
                                │        Telegram Client       │
                                │  (Mini App WebView / TMA)    │
                                └───────────────┬──────────────┘
                                                │ @tma.js/sdk
                                                ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │                              FRONTEND (frontend/)                         │
 │   Vite + React + TypeScript + Tailwind + shadcn/ui                        │
 │                                                                            │
 │   • @tonconnect/ui-react  → wallet connect, tx signing                    │
 │   • Omniston SDK          → live TON/USD price + "Swap & Fund" routing    │
 │   • IPFS client           → upload bounty descriptions / submission proof │
 └───────────────┬───────────────────────────────────────────┬───────────────┘
                 │ REST / WebSocket                          │ TON Connect
                 ▼                                           ▼
 ┌───────────────────────────────────────┐   ┌───────────────────────────────────┐
 │            BACKEND (backend/)         │   │     TON BLOCKCHAIN (contracts/)   │
 │   Node.js + Express + Postgres         │   │           Tact contracts          │
 │   (Supabase)                           │   │                                   │
 │                                        │   │  BountyFactory                    │
 │   • REST API                           │   │   └── deploys Bounty (per id)     │
 │   • Event indexer                      │◄──┤         ├── escrow (native TON)   │
 │   • IPFS pinning proxy                 │   │         ├── duration enum         │
 │   • Omniston price-attestation relay   │   │         ├── winner selection      │
 │                                        │   │         └── payout in TON         │
 └───────────────────┬────────────────────┘   └───────────────────────────────────┘
                     ▼
          ┌───────────────────────┐        ┌───────────────────────┐
          │   Postgres / Supabase │        │         IPFS          │
          │  bounties, submissions│        │ (Pinata / web3.storage│
          │  categories, indexes  │        │  descriptions, proofs)│
          └───────────────────────┘        └───────────────────────┘

                                            ┌───────────────────────┐
                                            │       Omniston        │
                                            │  • live TON/USD price │
                                            │  • swap quoting/route │
                                            └───────────────────────┘
```

## The hybrid split, in detail

| Concern | On-chain (Tact) | Off-chain (Postgres / IPFS) |
|---|---|---|
| Escrowed TON balance | ✅ canonical | mirrored for display |
| Deadline / duration enforcement | ✅ enforced (`isAllowedDuration`) | mirrored for UI countdowns |
| `$0.10`-per-winner minimum | ✅ enforced via signed price attestation | live price shown for UX |
| Winner selection | ✅ creator-only, post-deadline, atomic | indexed for history/leaderboards |
| Payout | ✅ native TON sent directly to winners | indexed `BountyPaidOut` event |
| Bounty description (full text) | content hash (IPFS CID) only | ✅ full text, search index |
| Submission proof (full content) | content hash (IPFS CID) only | ✅ resolved & previewed |
| Search / filter / categories | — | ✅ Postgres full-text search |
| Notifications / profiles | — | ✅ |

This split keeps gas costs predictable (fixed-size messages, no large strings on-chain) while still
giving users a rich, searchable experience — the chain is asked only to adjudicate the things that
actually require trustless consensus: *who gets paid, how much, and when*.

## End-to-end flows

### Create
1. Creator writes title/body/category/tags → **uploaded to IPFS** by the backend → CID returned.
2. Frontend fetches a **signed TON/USD price attestation** from the backend (`/api/price/attestation`,
   relayed from Omniston).
3. If funding with TON directly: frontend sends `CreateBounty` (with the CID, duration, winner
   count, reward, and price attestation) to `BountyFactory` via TON Connect, attaching
   `reward × winners + gas reserve` worth of TON.
4. If funding with another asset (e.g. USDT): the **Swap & Fund** flow quotes a route via Omniston,
   and routes the resulting TON straight to the factory in the same UX.
5. `BountyFactory` validates duration, price freshness/signature, the `$0.10` minimum, and attached
   value; deploys a new `Bounty` instance (`initOf` + `contractAddress`); forwards the reward pool;
   emits `BountyCreated`.
6. The indexer picks up `BountyCreated`, resolves the IPFS content, and stores a normalized row.

### Submit
1. Anyone uploads proof of work to IPFS (via the backend proxy) → CID.
2. They send `Submit { proofCid }` directly to the `Bounty` contract — **no allow-list check**.
3. The contract appends `(submitter, proofCid)` to its on-chain submitter map and emits
   `SubmissionLinked`.
4. The indexer resolves the proof content and stores a searchable submission row.

### Select winners & payout
1. After the deadline, the creator sends `SelectWinners { winners }` to the `Bounty` contract.
2. The contract validates the caller, the deadline, and the selection; records winners; and
   **immediately sends native TON to each winner** in the same transaction.
3. `WinnersSelected` and `BountyPaidOut` events are emitted and indexed for history and
   notifications.

### Reclaim (edge case)
If a bounty's deadline passes with **zero submissions**, the creator may send `ReclaimExpired` to
recover the escrowed TON — preventing funds from being permanently locked in an empty bounty.

## Trust assumptions & areas to harden before mainnet

- **Price oracle key** — `BountyFactory.priceOracle` is a single trusted relay key (the backend's
  `PRICE_ORACLE_PRIVATE_KEY`). Production deployments should consider a multi-relay quorum or an
  established on-chain price oracle once TVM-compatible options mature.
- **Signature verification** — `verifyPriceAttestation` in `bounty_factory.tact` is currently a
  structural placeholder; wire up real ed25519 verification (`checkSignature`) against the
  configured oracle public key before mainnet.
- **Indexer liveness** — the read model can lag the chain; the frontend should treat backend data
  as "best effort, eventually consistent" and always read final state (escrow balance, winners,
  payout) from the contract for anything safety-critical.
