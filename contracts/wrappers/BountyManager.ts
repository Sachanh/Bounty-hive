import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';

export type BountyManagerConfig = {
    owner: Address;
    platformWallet: Address;
    platformFeeBps: number; // basis points, e.g. 500 == 5%
    creationFee: bigint;
};

// Tact contracts deploy with their *init parameters* (not their runtime storage
// layout) in the initial data cell, prefixed with a single "not yet initialized"
// bit — `init()` runs on the first received message and rewrites storage into the
// contract's actual field layout. This must mirror the `init(owner, platformWallet,
// platformFeeBps, creationFee)` signature in `bounty_manager.tact` exactly (all
// plain `Int` params serialize as 257-bit signed integers); see the generated
// `BountyManager_init` in `build/BountyManager/tact_BountyManager.ts` after `npm run build`.
export function bountyManagerConfigToCell(config: BountyManagerConfig): Cell {
    const creationFeeCell = beginCell().storeInt(config.creationFee, 257).endCell();
    return beginCell()
        .storeUint(0, 1)
        .storeAddress(config.owner)
        .storeAddress(config.platformWallet)
        .storeInt(BigInt(config.platformFeeBps), 257)
        .storeRef(creationFeeCell)
        .endCell();
}

// Op codes — must match the `message(0x...) ...` declarations in
// contracts/contracts/messages.tact
export const OP = {
    CreateBounty: 0x42440001,
    Submit: 0x42440002,
    SelectWinners: 0x42440003,
    CloseBounty: 0x42440004,
    ClaimRefund: 0x42440005,

    SetPaused: 0x42440010,
    SetPlatformFee: 0x42440011,
    SetCreationFee: 0x42440012,
    SetPlatformWallet: 0x42440013,
    TransferOwnership: 0x42440014,

    DistributePayouts: 0x42440020,
    PayoutBatchComplete: 0x42440021,

    BountyCreated: 0x42440100,
    ParticipationSubmitted: 0x42440101,
    WinnersSelected: 0x42440102,
    PayoutDistributed: 0x42440103,
    BountyClosed: 0x42440104,
    Refunded: 0x42440105,
} as const;

export const STATUS = {
    Open: 0,
    Closed: 1,
    Paid: 2,
    Refunded: 3,
} as const;

export type CreateBountyOpts = {
    contentCid: string;
    durationSeconds: number;
    numWinners: number;
    prize: bigint;
    value: bigint; // prize + platformFee + creationFee + gas — see `quoteCreation` getter
    queryId?: number;
};

export type SelectWinnersOpts = {
    bountyId: bigint;
    winners: Map<number, Address>; // slot index -> winner address
    value?: bigint;
};

function winnersToDict(winners: Map<number, Address>): Dictionary<number, Address> {
    const dict = Dictionary.empty<number, Address>(Dictionary.Keys.Uint(16), Dictionary.Values.Address());
    for (const [index, address] of winners.entries()) {
        dict.set(index, address);
    }
    return dict;
}

export class BountyManager implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new BountyManager(address);
    }

    static createFromConfig(config: BountyManagerConfig, code: Cell, workchain = 0) {
        const data = bountyManagerConfigToCell(config);
        const init = { code, data };
        return new BountyManager(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint = toNano('0.05')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // NOTE: Tact messages declared with an explicit `message(0x...)` op code do
    // **not** carry an implicit 64-bit queryId — the wire format is exactly
    // `<32-bit op><fields in declaration order>` (see `messages.tact`). Don't
    // insert one here; the contract's parser would desynchronize on every field.
    async sendCreateBounty(provider: ContractProvider, via: Sender, opts: CreateBountyOpts) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP.CreateBounty, 32)
                .storeStringRefTail(opts.contentCid)
                .storeUint(opts.durationSeconds, 32)
                .storeUint(opts.numWinners, 8)
                .storeCoins(opts.prize)
                .endCell(),
        });
    }

    async sendSubmit(
        provider: ContractProvider,
        via: Sender,
        opts: { bountyId: bigint; proofCid: string; value?: bigint },
    ) {
        await provider.internal(via, {
            value: opts.value ?? toNano('0.05'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP.Submit, 32)
                .storeUint(opts.bountyId, 64)
                .storeStringRefTail(opts.proofCid)
                .endCell(),
        });
    }

    async sendSelectWinners(provider: ContractProvider, via: Sender, opts: SelectWinnersOpts) {
        await provider.internal(via, {
            value: opts.value ?? toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP.SelectWinners, 32)
                .storeUint(opts.bountyId, 64)
                .storeDict(winnersToDict(opts.winners))
                .endCell(),
        });
    }

    async sendCloseBounty(provider: ContractProvider, via: Sender, opts: { bountyId: bigint; value?: bigint }) {
        await provider.internal(via, {
            value: opts.value ?? toNano('0.05'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OP.CloseBounty, 32).storeUint(opts.bountyId, 64).endCell(),
        });
    }

    async sendClaimRefund(provider: ContractProvider, via: Sender, opts: { bountyId: bigint; value?: bigint }) {
        await provider.internal(via, {
            value: opts.value ?? toNano('0.05'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OP.ClaimRefund, 32).storeUint(opts.bountyId, 64).endCell(),
        });
    }

    async sendSetPaused(provider: ContractProvider, via: Sender, paused: boolean, value: bigint = toNano('0.02')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OP.SetPaused, 32).storeBit(paused).endCell(),
        });
    }

    async sendSetPlatformFee(provider: ContractProvider, via: Sender, feeBps: number, value: bigint = toNano('0.02')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OP.SetPlatformFee, 32).storeUint(feeBps, 16).endCell(),
        });
    }

    async sendTransferOwnership(provider: ContractProvider, via: Sender, newOwner: Address, value: bigint = toNano('0.02')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OP.TransferOwnership, 32).storeAddress(newOwner).endCell(),
        });
    }

    async getBounty(provider: ContractProvider, bountyId: bigint) {
        const result = await provider.get('bounty', [{ type: 'int', value: bountyId }]);
        return result.stack;
    }

    async getBountyCount(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('bountyCount', []);
        return result.stack.readBigNumber();
    }

    async getConfig(provider: ContractProvider) {
        const result = await provider.get('config', []);
        return result.stack;
    }

    async getQuoteCreation(provider: ContractProvider, prize: bigint) {
        const result = await provider.get('quoteCreation', [{ type: 'int', value: prize }]);
        return result.stack;
    }
}
