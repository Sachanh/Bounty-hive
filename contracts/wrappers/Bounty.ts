import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export type BountyConfig = {
    bountyId: bigint;
    factory: Address;
    creator: Address;
    contentCid: string;
    durationSeconds: number;
    winnerSlots: number;
    rewardPerWinner: bigint;
};

export function bountyConfigToCell(config: BountyConfig): Cell {
    return beginCell()
        .storeUint(config.bountyId, 64)
        .storeAddress(config.factory)
        .storeAddress(config.creator)
        .storeStringRefTail(config.contentCid)
        .storeUint(config.durationSeconds, 32)
        .storeUint(config.winnerSlots, 8)
        .storeCoins(config.rewardPerWinner)
        .endCell();
}

export class Bounty implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Bounty(address);
    }

    static createFromConfig(config: BountyConfig, code: Cell, workchain = 0) {
        const data = bountyConfigToCell(config);
        const init = { code, data };
        return new Bounty(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint = toNano('0.05')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // op = Submit (0x42435210)
    async sendSubmit(provider: ContractProvider, via: Sender, opts: { proofCid: string; value?: bigint }) {
        await provider.internal(via, {
            value: opts.value ?? toNano('0.05'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x42435210, 32)
                .storeStringRefTail(opts.proofCid)
                .endCell(),
        });
    }

    // op = SelectWinners (0x42435220)
    async sendSelectWinners(
        provider: ContractProvider,
        via: Sender,
        opts: { winners: Map<number, Address>; value?: bigint },
    ) {
        const dict = beginCell();
        // Encoding intentionally mirrors the Tact `map<Int as uint8, Address>` layout —
        // see Tact's generated wrapper output for the exact dictionary serialization
        // once the contract has been compiled with `npm run build`.
        await provider.internal(via, {
            value: opts.value ?? toNano('0.05'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x42435220, 32).storeRef(dict.endCell()).endCell(),
        });
    }

    async getBountyInfo(provider: ContractProvider) {
        const result = await provider.get('bountyInfo', []);
        return result.stack;
    }

    async getSubmission(provider: ContractProvider, index: number) {
        const result = await provider.get('submission', [{ type: 'int', value: BigInt(index) }]);
        return result.stack;
    }
}
