import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';

import { BountyManager } from '../wrappers/BountyManager';
import { compiledCode } from '../wrappers/compiled';

// Shared deploy routine for `BountyManager`, used by both the testnet and
// mainnet entry-point scripts below. Configuration is sourced from
// environment variables so the same compiled artifact can be promoted from
// testnet to mainnet without code changes — only the network and the env
// values differ.
//
// Required env vars:
//   PLATFORM_WALLET_ADDRESS — where platform fees + creation fees are forwarded
// Optional env vars:
//   PLATFORM_FEE_BPS  — basis points, default 500 (5%), hard-capped on-chain at 2000 (20%)
//   CREATION_FEE_TON  — flat TON creation fee, default "0.1"
export async function deployBountyManager(provider: NetworkProvider, opts: { requireMainnetConfirmation?: boolean } = {}) {
    const network = provider.network();

    if (opts.requireMainnetConfirmation && network === 'mainnet' && process.env.CONFIRM_MAINNET !== 'yes') {
        throw new Error(
            'Refusing to deploy to mainnet without explicit confirmation. ' +
                'Re-run with CONFIRM_MAINNET=yes once you have double-checked the configuration below.',
        );
    }

    const ownerAddress = provider.sender().address;
    if (!ownerAddress) {
        throw new Error('Sender address is not available — connect a wallet first');
    }

    const platformWalletEnv = process.env.PLATFORM_WALLET_ADDRESS;
    if (!platformWalletEnv) {
        throw new Error('Set PLATFORM_WALLET_ADDRESS to the wallet that should receive platform + creation fees');
    }
    const platformWallet = Address.parse(platformWalletEnv);

    const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? '500');
    const creationFee = toNano(process.env.CREATION_FEE_TON ?? '0.1');

    if (platformFeeBps < 0 || platformFeeBps > 2000) {
        throw new Error(`PLATFORM_FEE_BPS must be between 0 and 2000 (20%) — got ${platformFeeBps}`);
    }

    console.log(`\nDeploying BountyManager to ${network}`);
    console.log('─'.repeat(60));
    console.log('owner            :', ownerAddress.toString());
    console.log('platformWallet   :', platformWallet.toString());
    console.log('platformFeeBps   :', platformFeeBps, `(${(platformFeeBps / 100).toFixed(2)}%)`);
    console.log('creationFee      :', process.env.CREATION_FEE_TON ?? '0.1', 'TON');
    console.log('─'.repeat(60), '\n');

    const manager = provider.open(
        BountyManager.createFromConfig(
            { owner: ownerAddress, platformWallet, platformFeeBps, creationFee },
            compiledCode('BountyManager'),
        ),
    );

    await manager.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(manager.address);

    console.log('BountyManager deployed at:', manager.address.toString());
    console.log('Bounties created so far  :', await manager.getBountyCount());
    console.log('\nNext steps:');
    console.log(`  • Set VITE_BOUNTY_MANAGER_ADDRESS=${manager.address.toString()} in frontend/.env`);
    console.log(`  • Set BOUNTY_MANAGER_ADDRESS=${manager.address.toString()} in backend/.env`);

    return manager;
}
