import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export type BountyFactoryConfig = {
    owner: Address;
    priceOracle: Address;
};

export function bountyFactoryConfigToCell(config: BountyFactoryConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeAddress(config.priceOracle)
        .storeUint(1, 64) // nextBountyId
        .storeUint(0, 64) // totalBounties
        .endCell();
}

export type CreateBountyOpts = {
    contentCid: string;
    durationSeconds: number;
    winnerSlots: number;
    rewardPerWinner: bigint;
    tonUsdPriceMilli: bigint;
    priceTimestamp: number;
    priceSignature: Buffer;
    value: bigint; // total TON attached: rewardPerWinner * winnerSlots + gas reserve + fees
};

export class BountyFactory implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new BountyFactory(address);
    }

    static createFromConfig(config: BountyFactoryConfig, code: Cell, workchain = 0) {
        const data = bountyFactoryConfigToCell(config);
        const init = { code, data };
        return new BountyFactory(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint = toNano('0.05')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // op = CreateBounty (0x42435201)
    async sendCreateBounty(provider: ContractProvider, via: Sender, opts: CreateBountyOpts) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x42435201, 32)
                .storeStringRefTail(opts.contentCid)
                .storeUint(opts.durationSeconds, 32)
                .storeUint(opts.winnerSlots, 8)
                .storeCoins(opts.rewardPerWinner)
                .storeUint(opts.tonUsdPriceMilli, 64)
                .storeUint(opts.priceTimestamp, 32)
                .storeRef(beginCell().storeBuffer(opts.priceSignature).endCell())
                .endCell(),
        });
    }

    async getBountiesCreated(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('bountiesCreated', []);
        return result.stack.readBigNumber();
    }

    async getPriceOracleAddress(provider: ContractProvider): Promise<Address> {
        const result = await provider.get('priceOracleAddress', []);
        return result.stack.readAddress();
    }
}
