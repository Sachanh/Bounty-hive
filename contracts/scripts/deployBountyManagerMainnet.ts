import { NetworkProvider } from '@ton/blueprint';

import { deployBountyManager } from './deployBountyManager';

// Usage: `CONFIRM_MAINNET=yes blueprint run deployBountyManagerMainnet`
//
// This is identical to the testnet deploy script except it refuses to run
// against mainnet unless `CONFIRM_MAINNET=yes` is explicitly set — a small
// guard rail against accidentally promoting a half-checked configuration to
// production. Review the printed configuration block carefully before
// approving the transaction in your wallet.
export async function run(provider: NetworkProvider) {
    if (provider.network() !== 'mainnet') {
        throw new Error(
            `This script deploys to mainnet, but Blueprint reports the active network as "${provider.network()}". ` +
                'Re-select a mainnet wallet/network and try again — or use deployBountyManagerTestnet for testnet.',
        );
    }

    await deployBountyManager(provider, { requireMainnetConfirmation: true });
}
