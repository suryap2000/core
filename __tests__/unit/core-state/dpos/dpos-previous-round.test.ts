import "jest-extended";

import { CryptoSuite } from "@packages/core-crypto";
import { IBlock } from "@packages/core-crypto/src/interfaces";
import { Container, Utils } from "@packages/core-kernel/src";
import { RoundInfo } from "@packages/core-kernel/src/contracts/shared";
import { DposPreviousRoundStateProvider } from "@packages/core-kernel/src/contracts/state";
import { DposState } from "@packages/core-state/src/dpos/dpos";
import { WalletRepository } from "@packages/core-state/src/wallets";

import { buildDelegateAndVoteWallets } from "../__utils__/build-delegate-and-vote-balances";
import { makeChainedBlocks } from "../__utils__/make-chained-block";
import { makeVoteTransactions } from "../__utils__/make-vote-transactions";
import { addTransactionsToBlock } from "../__utils__/transactions";
import { setUp } from "../setup";

const crypto = new CryptoSuite.CryptoSuite(CryptoSuite.CryptoManager.findNetworkByName("testnet"));

let dposState: DposState;
let dposPreviousRoundStateProv: DposPreviousRoundStateProvider;
let walletRepo: WalletRepository;
let factory;
let blockState;

let initialEnv;

beforeAll(async () => {
    initialEnv = await setUp(crypto);
    dposState = initialEnv.dPosState;
    dposPreviousRoundStateProv = initialEnv.dposPreviousRound;
    walletRepo = initialEnv.walletRepo;
    factory = initialEnv.factory;
    blockState = initialEnv.blockState;
});

afterEach(() => jest.clearAllMocks());

describe("dposPreviousRound", () => {
    let round: RoundInfo;
    let blocks: IBlock[];

    beforeEach(async () => {
        walletRepo.reset();

        round = Utils.roundCalculator.calculateRound(1, crypto.CryptoManager.MilestoneManager.getMilestones());

        buildDelegateAndVoteWallets(5, walletRepo, crypto.CryptoManager);

        dposState.buildVoteBalances();
        dposState.buildDelegateRanking();
        round.maxDelegates = 5;
        dposState.setDelegatesRound(round);

        blocks = makeChainedBlocks(101, factory.get("Block"));

        jest.clearAllMocks();
    });

    describe("getAllDelegates", () => {
        it("should get all delegates", async () => {
            const previousRound = await dposPreviousRoundStateProv([], round);

            expect(previousRound.getAllDelegates()).toEqual(walletRepo.allByUsername());
        });
    });

    describe("getRoundDelegates", () => {
        it("should get round delegates", async () => {
            const previousRound = await dposPreviousRoundStateProv([], round);

            expect(previousRound.getRoundDelegates()).toContainAllValues(walletRepo.allByUsername() as any);
        });
    });

    describe("revert", () => {
        it("should revert blocks", async () => {
            const spyBuildDelegateRanking = jest.spyOn(dposState, "buildDelegateRanking");
            const spySetDelegatesRound = jest.spyOn(dposState, "setDelegatesRound");
            const spyRevertBlock = jest.spyOn(blockState, "revertBlock");

            /**
             * @FIXME
             * Why do we need to rebind them?
             * Modifications to dposState and blockState should be in the container
             * because they are the same objects as in the container while being modified.
             */
            initialEnv.sandbox.app.rebind(Container.Identifiers.DposState).toConstantValue(dposState);
            initialEnv.sandbox.app.rebind(Container.Identifiers.BlockState).toConstantValue(blockState);

            const generatorWallet = walletRepo.findByPublicKey(blocks[0].data.generatorPublicKey);

            generatorWallet.setAttribute("delegate", {
                username: "test",
                forgedFees: Utils.BigNumber.ZERO,
                forgedRewards: Utils.BigNumber.ZERO,
                producedBlocks: 0,
                lastBlock: undefined,
            });

            walletRepo.index(generatorWallet);

            addTransactionsToBlock(
                makeVoteTransactions(
                    3,
                    [`+${"03287bfebba4c7881a0509717e71b34b63f31e40021c321f89ae04f84be6d6ac37"}`],
                    crypto,
                ),
                blocks[0],
            );
            blocks[0].data.height = 2;

            await blockState.applyBlock(blocks[0]);

            await dposPreviousRoundStateProv([blocks[0]], round);

            expect(spyBuildDelegateRanking).toHaveBeenCalled();
            expect(spySetDelegatesRound).toHaveBeenCalledWith(round);
            expect(spyRevertBlock).toHaveBeenCalledWith(blocks[0]);
        });

        it("should not revert the blocks when height is one", async () => {
            const spyBuildDelegateRanking = jest.spyOn(dposState, "buildDelegateRanking");
            const spySetDelegatesRound = jest.spyOn(dposState, "setDelegatesRound");
            const spyRevertBlock = jest.spyOn(blockState, "revertBlock");

            /**
             * @FIXME
             * Why do we need to rebind them?
             * Modifications to dposState and blockState should be in the container
             * because they are the same objects as in the container while being modified.
             */
            initialEnv.sandbox.app.rebind(Container.Identifiers.DposState).toConstantValue(dposState);
            initialEnv.sandbox.app.rebind(Container.Identifiers.BlockState).toConstantValue(blockState);

            blocks[0].data.height = 1;

            await dposPreviousRoundStateProv([blocks[0]], round);

            expect(spyBuildDelegateRanking).toHaveBeenCalled();
            expect(spySetDelegatesRound).toHaveBeenCalled();
            expect(spyRevertBlock).not.toHaveBeenCalled();
        });
    });
});
