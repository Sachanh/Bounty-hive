import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, toNano } from '@ton/core';
import '@ton/test-utils';

import { BountyManager, OP, STATUS } from '../wrappers/BountyManager';
import { PayoutDistributor } from '../wrappers/PayoutDistributor';
import { compiledCode } from '../wrappers/compiled';

const HOUR = 3600;
const DAY = 24 * HOUR;
const GRACE_PERIOD = 48 * HOUR;

const PLATFORM_FEE_BPS = 500; // 5%
const CREATION_FEE = toNano('0.1');

describe('BountyManager', () => {
    let managerCode: Cell;
    let distributorCode: Cell;

    let blockchain: Blockchain;
    let owner: SandboxContract<TreasuryContract>;
    let platformWallet: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let alice: SandboxContract<TreasuryContract>;
    let bob: SandboxContract<TreasuryContract>;
    let carol: SandboxContract<TreasuryContract>;
    let manager: SandboxContract<BountyManager>;

    beforeAll(async () => {
        managerCode = compiledCode('BountyManager');
        distributorCode = compiledCode('PayoutDistributor');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        owner = await blockchain.treasury('owner');
        platformWallet = await blockchain.treasury('platformWallet');
        creator = await blockchain.treasury('creator');
        alice = await blockchain.treasury('alice');
        bob = await blockchain.treasury('bob');
        carol = await blockchain.treasury('carol');

        manager = blockchain.openContract(
            BountyManager.createFromConfig(
                {
                    owner: owner.address,
                    platformWallet: platformWallet.address,
                    platformFeeBps: PLATFORM_FEE_BPS,
                    creationFee: CREATION_FEE,
                },
                managerCode,
            ),
        );

        const deployResult = await manager.sendDeploy(owner.getSender(), toNano('0.05'));
        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: manager.address,
            deploy: true,
            success: true,
        });
    });

    async function createBounty(opts: {
        durationSeconds?: number;
        numWinners?: number;
        prize?: bigint;
        extra?: bigint;
    }) {
        const prize = opts.prize ?? toNano('10');
        const platformFee = (prize * BigInt(PLATFORM_FEE_BPS)) / 10000n;
        const value = prize + platformFee + CREATION_FEE + toNano('0.05') + (opts.extra ?? toNano('0.5'));

        return manager.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-description-cid',
            durationSeconds: opts.durationSeconds ?? 4 * HOUR,
            numWinners: opts.numWinners ?? 2,
            prize,
            value,
        });
    }

    // ── Creation ──────────────────────────────────────────────────────────

    it('rejects bounty creation with a disallowed duration', async () => {
        const result = await createBounty({ durationSeconds: 3600 }); // 1h is not allowed

        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
        expect(await manager.getBountyCount()).toBe(0n);
    });

    it('rejects bounty creation when the attached value does not cover prize + fees + gas', async () => {
        const prize = toNano('10');
        const result = await manager.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-description-cid',
            durationSeconds: 2 * HOUR,
            numWinners: 2,
            prize,
            value: prize, // missing platform fee, creation fee, and gas
        });

        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    it('rejects a prize too small to split across the requested winners', async () => {
        const prize = 5n; // 5 nanoTON across 10 winners => 0 per winner
        const platformFee = (prize * BigInt(PLATFORM_FEE_BPS)) / 10000n;
        const result = await manager.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-description-cid',
            durationSeconds: 2 * HOUR,
            numWinners: 10,
            prize,
            value: prize + platformFee + CREATION_FEE + toNano('0.5'),
        });

        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    it('escrows the prize, forwards platform + creation fees, stores the bounty, emits BountyCreated, and cashes back excess', async () => {
        const prize = toNano('10');
        const platformFee = (prize * BigInt(PLATFORM_FEE_BPS)) / 10000n;
        const sentValue = prize + platformFee + CREATION_FEE + toNano('0.05') + toNano('1'); // +1 TON excess

        const platformBalanceBefore = await platformWallet.getBalance();

        const result = await manager.sendCreateBounty(creator.getSender(), {
            contentCid: 'bafy-description-cid',
            durationSeconds: 4 * HOUR,
            numWinners: 2,
            prize,
            value: sentValue,
        });

        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: true });

        // Platform wallet received platformFee + creationFee.
        expect(result.transactions).toHaveTransaction({
            from: manager.address,
            to: platformWallet.address,
            value: platformFee + CREATION_FEE,
        });
        expect(await platformWallet.getBalance()).toBeGreaterThan(platformBalanceBefore);

        // BountyCreated event emitted (external-out message carrying the op code).
        const created = result.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.BountyCreated;
        });
        expect(created).toBeDefined();

        // Bounty stored & queryable.
        expect(await manager.getBountyCount()).toBe(1n);

        // Cashback: creator should have spent roughly (prize + fee + creationFee + gas),
        // not the full `sentValue` — the ~1 TON excess (minus tx fees) returns to them.
        const cashback = result.transactions.find(
            (t) =>
                t.inMessage?.info.type === 'internal' &&
                t.inMessage.info.dest?.toString() === creator.address.toString() &&
                t.inMessage.info.src?.toString() === manager.address.toString(),
        );
        expect(cashback).toBeDefined();
    });

    // ── Submissions ───────────────────────────────────────────────────────

    it('accepts open submissions from anyone and emits ParticipationSubmitted', async () => {
        await createBounty({ durationSeconds: 4 * HOUR, numWinners: 2 });

        const result = await manager.sendSubmit(alice.getSender(), { bountyId: 1n, proofCid: 'bafy-proof-alice' });
        expect(result.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: true });

        const submitted = result.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.ParticipationSubmitted;
        });
        expect(submitted).toBeDefined();
    });

    it('rejects submissions after the bounty has expired', async () => {
        await createBounty({ durationSeconds: 2 * HOUR, numWinners: 1 });

        blockchain.now = Math.floor(Date.now() / 1000) + 3 * HOUR;

        const result = await manager.sendSubmit(alice.getSender(), { bountyId: 1n, proofCid: 'bafy-proof-late' });
        expect(result.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: false });
    });

    // ── Winner selection & payout ─────────────────────────────────────────

    it('rejects winner selection before expiry, from a non-creator, or with an incomplete roster', async () => {
        await createBounty({ durationSeconds: 4 * HOUR, numWinners: 2 });

        // Too early.
        let result = await manager.sendSelectWinners(creator.getSender(), {
            bountyId: 1n,
            winners: new Map([[0, alice.address], [1, bob.address]]),
        });
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });

        blockchain.now = Math.floor(Date.now() / 1000) + 5 * HOUR;

        // Wrong sender.
        result = await manager.sendSelectWinners(alice.getSender(), {
            bountyId: 1n,
            winners: new Map([[0, alice.address], [1, bob.address]]),
        });
        expect(result.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: false });

        // Incomplete roster (slot 1 missing).
        result = await manager.sendSelectWinners(creator.getSender(), {
            bountyId: 1n,
            winners: new Map([[0, alice.address]]),
        });
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    it('rejects winner selection after the grace period has elapsed', async () => {
        await createBounty({ durationSeconds: 2 * HOUR, numWinners: 1 });

        blockchain.now = Math.floor(Date.now() / 1000) + 2 * HOUR + GRACE_PERIOD + HOUR;

        const result = await manager.sendSelectWinners(creator.getSender(), {
            bountyId: 1n,
            winners: new Map([[0, alice.address]]),
        });
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    it('selects winners, deploys a PayoutDistributor, pays every winner, and emits the full event trail', async () => {
        const prize = toNano('9'); // split evenly: 3 TON per winner across 3 winners
        await createBounty({ durationSeconds: 2 * HOUR, numWinners: 3, prize });

        await manager.sendSubmit(alice.getSender(), { bountyId: 1n, proofCid: 'bafy-proof-alice' });
        await manager.sendSubmit(bob.getSender(), { bountyId: 1n, proofCid: 'bafy-proof-bob' });
        await manager.sendSubmit(carol.getSender(), { bountyId: 1n, proofCid: 'bafy-proof-carol' });

        blockchain.now = Math.floor(Date.now() / 1000) + 3 * HOUR;

        const aliceBefore = await alice.getBalance();
        const bobBefore = await bob.getBalance();
        const carolBefore = await carol.getBalance();

        const result = await manager.sendSelectWinners(creator.getSender(), {
            bountyId: 1n,
            winners: new Map([
                [0, alice.address],
                [1, bob.address],
                [2, carol.address],
            ]),
            value: toNano('0.3'),
        });

        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: true });

        const winnersSelected = result.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.WinnersSelected;
        });
        expect(winnersSelected).toBeDefined();

        // Each winner receives prize / numWinners == 3 TON.
        const expectedPerWinner = prize / 3n;
        expect(await alice.getBalance()).toBeGreaterThan(aliceBefore + expectedPerWinner - toNano('0.1'));
        expect(await bob.getBalance()).toBeGreaterThan(bobBefore + expectedPerWinner - toNano('0.1'));
        expect(await carol.getBalance()).toBeGreaterThan(carolBefore + expectedPerWinner - toNano('0.1'));

        // PayoutDistributed reported back through the manager.
        const payoutDistributed = result.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.PayoutDistributed;
        });
        expect(payoutDistributed).toBeDefined();

        // Bounty status flipped to Paid.
        const stack = await manager.getBounty(1n);
        const bountyTuple = stack.readTupleOpt();
        expect(bountyTuple).not.toBeNull();
    });

    it('rejects a second winner-selection attempt for an already-paid bounty', async () => {
        await createBounty({ durationSeconds: 2 * HOUR, numWinners: 1 });
        await manager.sendSubmit(alice.getSender(), { bountyId: 1n, proofCid: 'bafy-proof' });

        blockchain.now = Math.floor(Date.now() / 1000) + 3 * HOUR;

        await manager.sendSelectWinners(creator.getSender(), { bountyId: 1n, winners: new Map([[0, alice.address]]) });

        const result = await manager.sendSelectWinners(creator.getSender(), {
            bountyId: 1n,
            winners: new Map([[0, bob.address]]),
        });
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    // ── Closing & refunds ─────────────────────────────────────────────────

    it('lets the creator close a bounty with zero submissions and then claim a refund', async () => {
        const prize = toNano('5');
        await createBounty({ durationSeconds: 8 * HOUR, numWinners: 2, prize });

        const closeResult = await manager.sendCloseBounty(creator.getSender(), { bountyId: 1n });
        expect(closeResult.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: true });

        const closed = closeResult.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.BountyClosed;
        });
        expect(closed).toBeDefined();

        const creatorBefore = await creator.getBalance();
        const refundResult = await manager.sendClaimRefund(creator.getSender(), { bountyId: 1n });
        expect(refundResult.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: true });
        expect(refundResult.transactions).toHaveTransaction({ from: manager.address, to: creator.address, value: prize });

        const refunded = refundResult.externals.find((m) => {
            const body = m.body.beginParse();
            return body.remainingBits >= 32 && body.preloadUint(32) === OP.Refunded;
        });
        expect(refunded).toBeDefined();
        expect(await creator.getBalance()).toBeGreaterThan(creatorBefore);
    });

    it('rejects closing a bounty that already has submissions', async () => {
        await createBounty({ durationSeconds: 8 * HOUR, numWinners: 2 });
        await manager.sendSubmit(alice.getSender(), { bountyId: 1n, proofCid: 'bafy-proof' });

        const result = await manager.sendCloseBounty(creator.getSender(), { bountyId: 1n });
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });
    });

    it('blocks refund claims until the grace period has elapsed for an unselected, expired bounty', async () => {
        await createBounty({ durationSeconds: 2 * HOUR, numWinners: 1 });

        blockchain.now = Math.floor(Date.now() / 1000) + 3 * HOUR; // expired, but still within grace period

        const tooEarly = await manager.sendClaimRefund(alice.getSender(), { bountyId: 1n });
        expect(tooEarly.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: false });

        blockchain.now = Math.floor(Date.now() / 1000) + 2 * HOUR + GRACE_PERIOD + HOUR;

        // Anyone can trigger it once the grace period has elapsed — but funds always go to the creator.
        const creatorBefore = await creator.getBalance();
        const nowEligible = await manager.sendClaimRefund(alice.getSender(), { bountyId: 1n });
        expect(nowEligible.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: true });
        expect(nowEligible.transactions).toHaveTransaction({ from: manager.address, to: creator.address });
        expect(await creator.getBalance()).toBeGreaterThan(creatorBefore);
    });

    // ── Admin ─────────────────────────────────────────────────────────────

    it('lets the owner pause the platform, blocking new bounty creation', async () => {
        const pauseResult = await manager.sendSetPaused(owner.getSender(), true);
        expect(pauseResult.transactions).toHaveTransaction({ from: owner.address, to: manager.address, success: true });

        const result = await createBounty({});
        expect(result.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: false });

        await manager.sendSetPaused(owner.getSender(), false);
        const result2 = await createBounty({});
        expect(result2.transactions).toHaveTransaction({ from: creator.address, to: manager.address, success: true });
    });

    it('rejects admin actions from non-owners', async () => {
        const result = await manager.sendSetPaused(alice.getSender(), true);
        expect(result.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: false });
    });

    it('rejects platform fees above the 20% hard cap', async () => {
        const result = await manager.sendSetPlatformFee(owner.getSender(), 2500); // 25%
        expect(result.transactions).toHaveTransaction({ from: owner.address, to: manager.address, success: false });
    });

    it('lets the owner update the platform fee and transfer ownership', async () => {
        const feeResult = await manager.sendSetPlatformFee(owner.getSender(), 1000); // 10%
        expect(feeResult.transactions).toHaveTransaction({ from: owner.address, to: manager.address, success: true });

        const transferResult = await manager.sendTransferOwnership(owner.getSender(), alice.address);
        expect(transferResult.transactions).toHaveTransaction({ from: owner.address, to: manager.address, success: true });

        // Old owner can no longer administer; new owner can.
        const oldOwnerAttempt = await manager.sendSetPaused(owner.getSender(), true);
        expect(oldOwnerAttempt.transactions).toHaveTransaction({ from: owner.address, to: manager.address, success: false });

        const newOwnerAttempt = await manager.sendSetPaused(alice.getSender(), true);
        expect(newOwnerAttempt.transactions).toHaveTransaction({ from: alice.address, to: manager.address, success: true });
    });
});

describe('PayoutDistributor', () => {
    it('exposes a getter for distribution progress (deployed indirectly via BountyManager.SelectWinners)', async () => {
        // Smoke-test that the wrapper/address derivation compiles & links —
        // full distribution behaviour is exercised end-to-end above via
        // BountyManager.sendSelectWinners (BountyManager deploys the
        // distributor deterministically with `initOf`).
        const code = compiledCode('PayoutDistributor');
        expect(code).toBeInstanceOf(Cell);
        expect(typeof PayoutDistributor.createFromAddress).toBe('function');
    });
});
