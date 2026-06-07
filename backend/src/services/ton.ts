import { TonClient, Address } from '@ton/ton';

import { env } from '../config/env.js';

// Thin wrapper around TonClient (toncenter) for the indexer's chain-reading
// needs: fetching transactions for the BountyFactory and the Bounty instances
// it deploys, and decoding the events emitted by the contracts in
// contracts/contracts/messages.tact.
export const tonClient = new TonClient({
  endpoint: `${env.TONCENTER_API_URL}/jsonRPC`,
  apiKey: env.TONCENTER_API_KEY,
});

export const bountyFactoryAddress = Address.parse(env.BOUNTY_FACTORY_ADDRESS);

// Operation codes — must match contracts/contracts/messages.tact message(...) declarations.
export const OP = {
  CreateBounty: 0x42435201,
  BountyCreated: 0x42435202,
  Submit: 0x42435210,
  SubmissionLinked: 0x42435211,
  SelectWinners: 0x42435220,
  WinnersSelected: 0x42435221,
  BountyPaidOut: 0x42435222,
  ReclaimExpired: 0x42435230,
} as const;
