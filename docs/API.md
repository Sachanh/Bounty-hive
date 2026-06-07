# TONBounty — Backend API

Base URL: `VITE_API_BASE_URL` (defaults to `http://localhost:4000`). All responses are JSON.
Source: [`backend/src/routes/`](../backend/src/routes).

This API serves the **indexed read model** — rich, searchable data joined from on-chain events and
IPFS content (see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the hybrid split). It never
custodies funds or signs transactions; all value-moving operations go directly from the frontend to
the chain via TON Connect.

## Health

```
GET /health
→ { "status": "ok" }
```

## Bounties

### `GET /api/bounties`
List/search bounties.

Query params (all optional): `category`, `status` (`open|awaiting_selection|completed|expired`),
`search` (full-text, matched against title + description).

```jsonc
→ [
  {
    "id": "uuid",
    "onchainId": "1",
    "contractAddress": "EQ...",
    "creatorAddress": "EQ...",
    "title": "Build a TON wallet adapter",
    "category": "Development",
    "durationSeconds": 14400,
    "deadline": "2026-06-07T18:00:00.000Z",
    "winnerSlots": 3,
    "rewardPerWinnerNanoTon": "1000000000",
    "submissionCount": 4,
    "status": "open"
  }
]
```

### `GET /api/bounties/:id`
Full bounty detail, including the resolved IPFS description.

```jsonc
→ {
  ...all fields from the list endpoint,
  "descriptionCid": "bafy...",
  "descriptionMarkdown": "## Task\n..."
}
```

### `GET /api/bounties/:id/submissions`
All submissions for a bounty, newest first.

```jsonc
→ [
  {
    "id": "uuid",
    "bountyId": "uuid",
    "submitterAddress": "EQ...",
    "proofCid": "bafy...",
    "proofPreview": "Implemented the adapter with...",
    "submittedAt": "2026-06-07T15:32:00.000Z",
    "isWinner": false
  }
]
```

## Categories

### `GET /api/categories`
Distinct categories across all indexed bounties (for filter UIs).

```jsonc
→ ["Content", "Design", "Development", "Research"]
```

## Price attestation (Omniston relay)

### `GET /api/price/attestation`
Returns a freshly signed TON/USD price attestation. Embed this directly in the on-chain
`CreateBounty` message — `BountyFactory.verifyPriceAttestation` checks the signature and the
implied USD value against the `$0.10`-per-winner minimum (see
[`docs/SMART_CONTRACTS.md`](./SMART_CONTRACTS.md)).

```jsonc
→ {
  "tonUsdPriceMilli": "5123",   // $5.123 / TON, fixed-point milli-dollars
  "timestamp": 1781234567,       // unix seconds
  "signature": "a1b2c3..."       // hex-encoded ed25519 signature
}
```

Attestations are cached for ~30 seconds; the contract additionally rejects attestations older than
5 minutes (`now() - priceTimestamp <= 300`), so always fetch a fresh one immediately before sending
the `CreateBounty` transaction.

## IPFS uploads

Credentials for the pinning provider (Pinata / web3.storage) live only on the backend — the
frontend always uploads through this proxy (see `frontend/src/lib/ipfs.ts`).

### `POST /api/ipfs/upload-json`
Pins either a **bounty description** or a **submission proof** as JSON.

Bounty description shape:
```json
{ "title": "string", "body": "markdown string", "category": "string", "tags": ["string", "..."] }
```

Submission proof shape:
```json
{ "summary": "string", "links": ["https://...", "..."] }
```

```jsonc
→ { "cid": "bafy..." }
```

### `POST /api/ipfs/upload-file`
`multipart/form-data` with a single `file` field (max 25 MB) — for raw proof artifacts
(screenshots, archives, etc.).

```jsonc
→ { "cid": "bafy..." }
```

## Error format

All error responses follow:

```json
{ "error": "human-readable message" }
```

with an appropriate HTTP status (`400` validation, `404` not found, `500` server/DB error, `502`
upstream provider failure — e.g. Omniston or the IPFS pinning service).
