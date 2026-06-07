import { NetworkProvider } from '@ton/blueprint';

import { deployBountyManager } from './deployBountyManager';

// Usage: `blueprint run deployBountyManagerTestnet`
//
// Make sure your Blueprint network selection / wallet is pointed at testnet
// (the CLI will prompt you), and that PLATFORM_WALLET_ADDRESS (and optionally
// PLATFORM_FEE_BPS / CREATION_FEE_TON) are set in your environment — see
// contracts/README.md for the full checklist.
export async function run(provider: NetworkProvider) {
    if (provider.network() !== 'testnet') {
        console.warn(
            `\n⚠️  Blueprint reports the active network as "${provider.network()}", not "testnet".\n` +
                'Re-select a testnet wallet/network if this is unexpected.\n',
        );
    }

    await deployBountyManager(provider);
}
