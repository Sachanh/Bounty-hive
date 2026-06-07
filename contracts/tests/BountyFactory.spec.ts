import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, toNano } from '@ton/core';
import '@ton/test-utils';
import { BountyFactory } from '../wrappers/BountyFactory';
import { compile } from '@ton/blueprint';

// These tests describe the expected behaviour of BountyFactory. Run `npm run build`
// first so that `compile('BountyFactory')` / `compile('Bounty')` can resolve the
// compiled Tact artifacts under `build/`.
describe('BountyFactory', () => {
    let factoryCode: Cell;
    let bountyCode: Cell;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let priceOracle: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let factory: SandboxContract<BountyFactory>;

    beforeAll(async () => {
        factoryCode = await compile('BountyFactory');
        bountyCode = await compile('Bounty');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        priceOracle = await blockchain.treasury('priceOracle');
        creator = await blockchain.treasury('creator');

        factory = blockchain.openContract(
            BountyFactory.createFromConfig(
                { owner: deployer.address, priceOracle: priceOracle.address },
                factoryCode,
            ),
        );

        const deployResult = await factory.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: factory.address,
            deploy: true,
            success: true,
        });
    });

    it('rejects bounty creation with a disallowed duration', async () => {
        const result = await factory.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-example-description-cid',
            durationSeconds: 3600, // 1h — not in the allowed set {2,4,8,12,24}h
            winnerSlots: 1,
            rewardPerWinner: toNano('1'),
            tonUsdPriceMilli: 5000n, // $5.00 / TON
            priceTimestamp: Math.floor(Date.now() / 1000),
            priceSignature: Buffer.alloc(64),
            value: toNano('1.5'),
        });

        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: factory.address,
            success: false,
        });
    });

    it('rejects rewards below the $0.10-per-winner minimum', async () => {
        // At $5.00/TON, 0.1 TON ≈ $0.50 (fine) but a tiny reward like 0.001 TON ≈ $0.005 should fail.
        const result = await factory.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-example-description-cid',
            durationSeconds: 7200, // 2h — allowed
            winnerSlots: 1,
            rewardPerWinner: toNano('0.001'),
            tonUsdPriceMilli: 5000n,
            priceTimestamp: Math.floor(Date.now() / 1000),
            priceSignature: Buffer.alloc(64),
            value: toNano('0.5'),
        });

        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: factory.address,
            success: false,
        });
    });

    it('deploys a Bounty escrow and emits BountyCreated for a valid request', async () => {
        const result = await factory.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-example-description-cid',
            durationSeconds: 14400, // 4h — allowed
            winnerSlots: 3,
            rewardPerWinner: toNano('1'), // at $5/TON => $5.00 per winner, well above $0.10
            tonUsdPriceMilli: 5000n,
            priceTimestamp: Math.floor(Date.now() / 1000),
            priceSignature: Buffer.alloc(64),
            value: toNano('3.5'),
        });

        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: factory.address,
            success: true,
        });

        expect(await factory.getBountiesCreated()).toBe(1n);
    });
});
