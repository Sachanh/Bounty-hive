# TONBounty

**TONBounty** is an open, permissionless bounty platform built natively on **TON**, delivered as a
**Telegram Mini App**. Anyone can create a bounty, fund it with native TON (or swap any token into TON
on the fly via **Omniston**), accept submissions, and pick winners — all enforced on-chain by **Tact**
smart contracts, with a backend indexer providing rich search, metadata, and history.

> Working name: `TONBounty`. Rename freely — `tonbounty` is used as the npm scope/package prefix
> throughout this repo and can be find-and-replaced.

## Monorepo layout

```
.
├── contracts/    Tact smart contracts (Blueprint project)
├── frontend/     Telegram Mini App — Vite + React + TypeScript + Tailwind + shadcn/ui
├── backend/      Node.js/Express API — event indexer + Postgres (Supabase)
├── docs/         Architecture, API and smart-contract documentation
└── package.json  npm workspaces root
```

Each workspace has its own README with setup instructions:

- [`contracts/README.md`](./contracts/README.md)
- [`frontend/README.md`](./frontend/README.md)
- [`backend/README.md`](./backend/README.md)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

## Core product rules

- **Native TON only.** Bounties are created, funded, escrowed, and paid out exclusively in TON coin
  (no jettons as the settlement asset). Users who hold other assets can swap into TON at funding time.
- **Open participation.** No allow-lists, KYC, or gating — anyone with a TON wallet can create or
  join a bounty.
- **Fixed durations.** A bounty must run for exactly one of: `2h`, `4h`, `8h`, `12h`, `24h`. The
  contract rejects any other duration at creation time.
- **Minimum reward enforcement.** Each winner slot must be funded with at least **$0.10** worth of
  TON, measured against a live TON/USD price fed by **Omniston** at creation time and re-validated
  by the contract using a signed price attestation.
- **Hybrid on-chain / off-chain design.** The chain is the source of truth for *value* and *critical
  state transitions*; the backend is the source of truth for *searchable, descriptive* data (full
  text, categories, submission browsing, notifications).

## High-level architecture

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
 │                                                                            │
 │        ┌──────────────┐   ┌───────────────┐   ┌────────────────────┐     │
 │        │ Browse/Search│   │ Create Bounty │   │ Submission & Vote   │     │
 │        └──────────────┘   └───────────────┘   └────────────────────┘     │
 └───────────────┬───────────────────────────────────────────┬───────────────┘
                 │ REST / WebSocket                          │ TON Connect
                 ▼                                           ▼
 ┌───────────────────────────────────────┐   ┌───────────────────────────────────┐
 │            BACKEND (backend/)         │   │     TON BLOCKCHAIN (contracts/)   │
 │   Node.js + Express + Postgres         │   │           Tact contracts          │
 │   (Supabase)                           │   │                                   │
 │                                        │   │  BountyFactory                    │
 │   • REST API (bounties, submissions,   │   │   └── deploys Bounty (per id)     │
 │     categories, search, profiles)      │   │         ├── escrow (native TON)   │
 │   • Event indexer (listens to TON      │◄──┤         ├── duration enum         │
 │     contract events via TonAPI/        │   │         │   (2h/4h/8h/12h/24h)    │
 │     toncenter, persists to Postgres)   │   │         ├── winner selection       │
 │   • IPFS pinning helpers (Pinata /     │   │         └── payout in TON          │
 │     web3.storage)                      │   │                                   │
 │   • Omniston price oracle relay        │   │  Emits events:                    │
 │     (signs/attests TON/USD price)      │   │   BountyCreated, SubmissionLinked,│
 └───────────────────────┬────────────────┘   │   WinnersSelected, BountyPaidOut  │
                         │                     └───────────────────────────────────┘
                         ▼
              ┌───────────────────────┐
              │   Postgres / Supabase │
              │  bounties, submissions│
              │  categories, indexes  │
              └───────────────────────┘

              ┌───────────────────────┐
              │         IPFS          │
              │ (Pinata / web3.storage│
              │  bounty descriptions, │
              │  submission proofs)   │
              └───────────────────────┘

              ┌───────────────────────┐
              │       Omniston        │
              │  • live TON/USD price │
              │  • swap quoting/route │
              │    (any token → TON)  │
              └───────────────────────┘
```

### Why hybrid?

| Concern | Lives on-chain (Tact contract) | Lives off-chain (backend/Postgres) |
|---|---|---|
| Holding & releasing TON (escrow) | ✅ source of truth | — |
| Bounty duration / deadline enforcement | ✅ enforced in contract | mirrored for UI |
| Minimum-per-winner ($0.10) check | ✅ validated against attested price | price feed relay |
| Winner selection & payout | ✅ atomic, on-chain | indexed for history |
| Full bounty description, tags, search | content hash only (IPFS CID) | ✅ full text + search index |
| Submission browsing / filtering / comments | proof hash only (IPFS CID) | ✅ rich queries |
| Notifications, profiles, leaderboards | — | ✅ |

## End-to-end flows

### 1. Create a bounty
1. Creator writes a description in the Mini App → uploaded to **IPFS** (Pinata/web3.storage), CID returned.
2. Creator picks a duration (`2h`/`4h`/`8h`/`12h`/`24h`) and number of winners + reward per winner.
3. Frontend fetches the live TON/USD price from **Omniston** and checks reward-per-winner ≥ $0.10.
4. If the user wants to fund with USDT/another jetton, the **"Swap & Fund"** flow quotes a route via
   Omniston, swaps to TON, and forwards the resulting TON straight into the bounty escrow — all in
   one TON Connect transaction sequence.
5. `BountyFactory` deploys a new `Bounty` contract instance, escrowing the native TON and storing the
   IPFS CID, duration, and winner configuration on-chain.
6. The backend indexer picks up the `BountyCreated` event and stores the full record (joining on-chain
   state with the IPFS-hosted description) in Postgres for search/browsing.

### 2. Submit & select winners
1. Participants upload their proof of work to IPFS and call `submit()` on the `Bounty` contract with
   the resulting CID (open to anyone — no allow-list).
2. The backend indexes `SubmissionLinked` events and resolves the full submission content from IPFS.
3. When the duration elapses, the creator selects winners. The contract validates the selection
   against its on-chain state and **pays out native TON directly to winners' wallets**.
4. `WinnersSelected` / `BountyPaidOut` events are indexed for history, leaderboards, and notifications.

## Tech stack

| Layer | Technology |
|---|---|
| Smart contracts | [Tact](https://docs.tact-lang.org/) + [Blueprint](https://github.com/ton-org/blueprint) |
| Frontend | [Telegram Mini Apps React template](https://github.com/Telegram-Mini-Apps/reactjs-template), Vite, React, TypeScript, Tailwind CSS, shadcn/ui |
| Wallet / payments | [@tonconnect/ui-react](https://github.com/ton-connect/sdk), [@tma.js/sdk](https://github.com/Telegram-Mini-Apps/tma.js) |
| Price feed & swaps | [Omniston](https://docs.ston.fi/docs/developer-section/omniston) |
| Storage | IPFS via Pinata or web3.storage |
| Backend | Node.js, Express (or NestJS), TypeScript |
| Database | PostgreSQL via [Supabase](https://supabase.com/) |
| Chain access | TonAPI / toncenter (event indexing) |

## Getting started

```bash
# install all workspaces
npm install

# run the frontend Mini App locally
npm run dev:frontend

# run the backend indexer + API
npm run dev:backend

# build & test the contracts
npm run build:contracts
npm run test:contracts
```

See each workspace's README for environment variables and detailed setup.

## License

MIT
