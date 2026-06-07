import { toNano, Address } from '@ton/core';
import { BountyFactory } from '../wrappers/BountyFactory';
import { compile, NetworkProvider } from '@ton/blueprint';

// Usage: `blueprint run deployBountyFactory`
// Required env vars:
//   PRICE_ORACLE_ADDRESS — address of the trusted Omniston price-attestation relay
export async function run(provider: NetworkProvider) {
    const ownerAddress = provider.sender().address;
    if (!ownerAddress) {
        throw new Error('Sender address is not available — connect a wallet first');
    }

    const priceOracleEnv = process.env.PRICE_ORACLE_ADDRESS;
    if (!priceOracleEnv) {
        throw new Error('Set PRICE_ORACLE_ADDRESS to the trusted Omniston relay address before deploying');
    }
    const priceOracle = Address.parse(priceOracleEnv);

    const factory = provider.open(
        BountyFactory.createFromConfig(
            { owner: ownerAddress, priceOracle },
            await compile('BountyFactory'),
        ),
    );

    await factory.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(factory.address);

    console.log('BountyFactory deployed at:', factory.address.toString());
    console.log('Bounties created so far:', await factory.getBountiesCreated());
}
