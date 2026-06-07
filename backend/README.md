# `backend/` — TONBounty API, indexer & relay

A Node.js + Express + TypeScript service that provides:

1. **REST API** for browsing/searching bounties, submissions, and categories — backed by Postgres
   (Supabase).
2. **On-chain event indexer** that watches `BountyFactory`/`Bounty` contract events and mirrors them
   into the read model, joining on-chain state with content resolved from IPFS.
3. **IPFS pinning proxy** so Pinata/web3.storage credentials never reach the client.
4. **Omniston price-attestation relay** — signs the live TON/USD price so `BountyFactory` can verify
   the `$0.10`-per-winner minimum on-chain without making any HTTP calls itself.

## Layout

```
backend/
├── src/
│   ├── index.ts              HTTP server entry point
│   ├── app.ts                Express app & route wiring
│   ├── config/env.ts         zod-validated environment config
│   ├── db/
│   │   ├── client.ts         Supabase client + row types
│   │   └── schema.sql        Postgres schema (bounties, submissions, indexer_cursor)
│   ├── routes/
│   │   ├── bounties.ts       GET /api/bounties, /api/bounties/:id, /:id/submissions
│   │   ├── categories.ts     GET /api/categories
│   │   ├── price.ts          GET /api/price/attestation (signed Omniston price)
│   │   └── ipfs.ts           POST /api/ipfs/upload-json, /upload-file
│   ├── services/
│   │   ├── ton.ts            TonClient + contract op-code constants
│   │   ├── omniston.ts       price fetching + ed25519 attestation signing
│   │   └── ipfs.ts           Pinata / web3.storage pinning
│   └── indexer/
│       ├── run.ts            standalone polling loop (`npm run indexer`)
│       ├── processor.ts      decodes contract events from on-chain transactions
│       └── handlers.ts       upserts the Postgres read model
└── .env.example
```

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase, TON, IPFS, and Omniston relay credentials

# apply the schema (Supabase SQL editor, `supabase db push`, or psql)
psql "$DATABASE_URL" -f src/db/schema.sql

# run the API
npm run dev

# run the indexer (separate process)
npm run indexer
```

## Why a hybrid backend?

The `Bounty`/`BountyFactory` Tact contracts (see `../contracts`) are the source of truth for
**value and critical state** — escrow balances, deadlines, winner selection, payouts. They are
deliberately minimal: they store IPFS **content hashes (CIDs)**, not full text, to keep on-chain
storage and gas costs low.

This backend is the source of truth for **everything that needs to be searched, browsed, or
displayed richly**:

- Full bounty descriptions and submission write-ups (resolved from IPFS, cached in Postgres).
- Categories, tags, full-text search (`bounties_search_idx` in `schema.sql`).
- Submission history and winner annotations.
- A consistent `status` derived from on-chain events (`open` → `awaiting_selection` → `completed`/`expired`).

The indexer (`src/indexer/`) is what keeps these two worlds in sync: it watches the chain, decodes
the `BountyCreated` / `SubmissionLinked` / `WinnersSelected` / `BountyPaidOut` events emitted by the
contracts (op-codes defined in `contracts/contracts/messages.tact` and mirrored in
`src/services/ton.ts`), resolves the referenced IPFS content, and upserts normalized rows.

## Omniston price-attestation relay

`BountyFactory` enforces a `$0.10`-minimum reward per winner, but TVM contracts cannot fetch live
prices. `src/services/omniston.ts` bridges this gap:

1. Polls Omniston for the live TON/USD price.
2. Encodes `(priceMilli, timestamp)` into a fixed 12-byte payload (`attestationPayload`).
3. Signs it with an ed25519 keypair (`PRICE_ORACLE_PRIVATE_KEY`) whose **public key matches the
   `priceOracle` address configured on the deployed `BountyFactory`**.
4. Serves the attestation via `GET /api/price/attestation`.

The frontend embeds this attestation directly in the `CreateBounty` message
(`frontend/src/hooks/useCreateBounty.ts`); the contract verifies the signature and the
implied USD value before accepting the bounty. Replace the placeholder verification in
`verifyPriceAttestation` (contracts side) with a real `checkSignature` call using the same wire
format before going to mainnet — see `docs/SMART_CONTRACTS.md`.

## Indexer cursor & idempotency

`indexer_cursor` (see `schema.sql`) tracks the last processed logical time (`lt`) / hash so the
poller can resume safely after restarts. `bounties` and `submissions` use `upsert` with unique
constraints (`onchain_id`, `(bounty_id, submitter_address, proof_cid)`) so re-processing the same
event is a no-op.
