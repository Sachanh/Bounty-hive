# `frontend/` — TONBounty Telegram Mini App

A [Telegram Mini App](https://core.telegram.org/bots/webapps) built on the official
[`Telegram-Mini-Apps/reactjs-template`](https://github.com/Telegram-Mini-Apps/reactjs-template)
patterns: Vite + React + TypeScript + Tailwind CSS + shadcn/ui, wired up with
[`@tma.js/sdk`](https://github.com/Telegram-Mini-Apps/tma.js) and
[`@tonconnect/ui-react`](https://github.com/ton-connect/sdk).

## What's here

```
frontend/
├── public/
│   └── tonconnect-manifest.json   TON Connect app manifest (must be served over HTTPS)
├── src/
│   ├── main.tsx                   SDKProvider + TonConnectUIProvider + router bootstrap
│   ├── App.tsx                    shell layout, nav, TonConnectButton
│   ├── index.css                  Tailwind layers + Telegram safe-area handling
│   ├── pages/
│   │   ├── BountyListPage.tsx     browse/search bounties (reads from backend API)
│   │   ├── BountyDetailPage.tsx   bounty detail + submissions feed
│   │   └── CreateBountyPage.tsx   create-bounty form (duration, reward, IPFS upload, funding)
│   ├── components/
│   │   ├── ui/                    shadcn/ui primitives (button, card, input, label, badge)
│   │   ├── BountyCard.tsx
│   │   ├── DurationPicker.tsx     enforces the fixed 2h/4h/8h/12h/24h durations
│   │   └── SwapAndFundDialog.tsx  "Swap & Fund": pay in USDT/other tokens, land in TON escrow
│   ├── hooks/
│   │   ├── useTelegramTheme.ts    syncs Telegram theme params -> Tailwind CSS vars
│   │   ├── useOmnistonPrice.ts    live TON/USD price (Omniston) + $0.10 minimum helper
│   │   ├── useSwapAndFund.ts      Omniston RFQ quoting + swap execution via TON Connect
│   │   └── useCreateBounty.ts     builds & sends the on-chain CreateBounty message
│   └── lib/
│       ├── api.ts                 typed client for the backend REST API
│       ├── ipfs.ts                uploads descriptions/proofs via the backend IPFS proxy
│       ├── constants.ts           fixed durations & minimum-reward constants (mirror on-chain)
│       └── utils.ts               `cn()` className helper (shadcn convention)
└── .env.example
```

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Telegram Mini Apps must be served over **HTTPS**. For local development inside Telegram, tunnel
the Vite dev server (e.g. `ngrok http 5173` or Cloudflare Tunnel) and register the HTTPS URL with
[@BotFather](https://t.me/BotFather) (`/newapp`). You can also open the app directly in a normal
browser during development — `@tma.js/sdk` gracefully degrades outside Telegram.

## TON Connect manifest

`public/tonconnect-manifest.json` must be reachable at a public HTTPS URL (set
`VITE_TONCONNECT_MANIFEST_URL` accordingly). Update `url`, `name`, and `iconUrl` to your deployed
domain before going live — see the [TON Connect manifest docs](https://docs.ton.org/develop/dapps/ton-connect/manifest).

## Key integration points

- **Wallet & transactions** — `@tonconnect/ui-react` (`TonConnectButton`, `useTonConnectUI`,
  `useTonAddress`). All on-chain writes (`CreateBounty`, `Submit`, `SelectWinners`) are sent as TON
  Connect transactions; see `hooks/useCreateBounty.ts` for how the message body is encoded to match
  `contracts/contracts/messages.tact`.
- **Telegram environment** — `@tma.js/sdk-react`'s `SDKProvider` plus `hooks/useTelegramTheme.ts`,
  which mirrors Telegram theme params onto CSS variables consumed by `tailwind.config.js`.
- **Live pricing & swaps (Omniston)** — `hooks/useOmnistonPrice.ts` polls the live TON/USD price to
  enforce the $0.10-per-winner minimum in the UI (the contract re-validates on-chain via a signed
  attestation fetched from the backend). `hooks/useSwapAndFund.ts` + `components/SwapAndFundDialog.tsx`
  implement the "pay with USDT → swap to TON → fund escrow" flow using Omniston's quoting API.
- **IPFS** — `lib/ipfs.ts` proxies uploads through the backend (`/api/ipfs/*`) so pinning provider
  keys never reach the client; reads resolve through a configurable public gateway
  (`VITE_IPFS_GATEWAY_URL`).
- **Backend API** — `lib/api.ts` is a thin typed client over the indexer/search REST API exposed by
  the `backend/` workspace.

## Environment variables

See [`.env.example`](./.env.example) for the full list (`VITE_TONCONNECT_MANIFEST_URL`,
`VITE_API_BASE_URL`, `VITE_TON_NETWORK`, `VITE_BOUNTY_FACTORY_ADDRESS`, `VITE_OMNISTON_API_URL`,
`VITE_IPFS_GATEWAY_URL`, `VITE_TELEGRAM_BOT_USERNAME`).
