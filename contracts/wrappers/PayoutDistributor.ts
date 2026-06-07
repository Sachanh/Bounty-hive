import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Dictionary } from '@ton/core';

export type PayoutDistributorConfig = {
    manager: Address;
    bountyId: bigint;
    creator: Address;
    winners: Map<number, Address>;
    totalWinners: number;
    amountPerWinner: bigint;
};

function winnersToDict(winners: Map<number, Address>): Dictionary<number, Address> {
    const dict = Dictionary.empty<number, Address>(Dictionary.Keys.Uint(16), Dictionary.Values.Address());
    for (const [index, address] of winners.entries()) {
        dict.set(index, address);
    }
    return dict;
}

// Mirrors `init(manager, bountyId, creator, winners, totalWinners, amountPerWinner)`
// in `payout_distributor.tact` — see the note on `bountyManagerConfigToCell` in
// `BountyManager.ts` for why the data cell holds init *parameters* (with a leading
// "not yet initialized" bit), not the contract's runtime field layout. Cross-checked
// against the generated `PayoutDistributor_init` in `build/PayoutDistributor/tact_PayoutDistributor.ts`.
export function payoutDistributorConfigToCell(config: PayoutDistributorConfig): Cell {
    const tailCell = beginCell()
        .storeInt(BigInt(config.totalWinners), 257)
        .storeInt(config.amountPerWinner, 257)
        .endCell();
    return beginCell()
        .storeUint(0, 1)
        .storeAddress(config.manager)
        .storeInt(config.bountyId, 257)
        .storeAddress(config.creator)
        .storeDict(winnersToDict(config.winners))
        .storeRef(tailCell)
        .endCell();
}

// `PayoutDistributor` is deployed deterministically by `BountyManager` via
// `initOf` — this wrapper exists mainly so tests can compute the same address
// and inspect distribution progress directly.
export class PayoutDistributor implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new PayoutDistributor(address);
    }

    static createFromConfig(config: PayoutDistributorConfig, code: Cell, workchain = 0) {
        const data = payoutDistributorConfigToCell(config);
        const init = { code, data };
        return new PayoutDistributor(contractAddress(workchain, init), init);
    }

    async getDistributionStatus(provider: ContractProvider) {
        const result = await provider.get('distributionStatus', []);
        return result.stack;
    }
}
