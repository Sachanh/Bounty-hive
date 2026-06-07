import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  TONCENTER_API_KEY: z.string().optional(),
  TONCENTER_API_URL: z.string().url(),
  TONAPI_KEY: z.string().optional(),
  TONAPI_URL: z.string().url(),

  BOUNTY_FACTORY_ADDRESS: z.string().min(1),

  IPFS_PROVIDER: z.enum(['pinata', 'web3storage']).default('pinata'),
  PINATA_JWT: z.string().optional(),
  WEB3_STORAGE_TOKEN: z.string().optional(),

  OMNISTON_API_URL: z.string().url(),
  PRICE_ORACLE_PRIVATE_KEY: z.string().min(1),
  PRICE_ORACLE_PUBLIC_KEY: z.string().min(1),
});

// Parsed once at boot — fail fast if required configuration is missing so the
// service never serves traffic with an invalid setup (e.g. a misconfigured
// price-oracle key the on-chain factory wouldn't trust anyway).
export const env = envSchema.parse(process.env);
