/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TONCONNECT_MANIFEST_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_TON_NETWORK: 'mainnet' | 'testnet';
  readonly VITE_BOUNTY_FACTORY_ADDRESS: string;
  readonly VITE_OMNISTON_API_URL: string;
  readonly VITE_IPFS_GATEWAY_URL: string;
  readonly VITE_TELEGRAM_BOT_USERNAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
