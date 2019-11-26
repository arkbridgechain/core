import { DatabaseService } from "@arkecosystem/core-database";
import { Container, Contracts, Services, Utils } from "@arkecosystem/core-kernel";
import { Crypto, Managers } from "@arkecosystem/crypto";

import { Delegate } from "./interfaces";

/**
 * @export
 * @class DelegateTracker
 */
@Container.injectable()
export class DelegateTracker {
    /**
     * @protected
     * @type {Services.Config.ConfigRepository}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.ConfigRepository)
    protected readonly configRepository!: Services.Config.ConfigRepository;

    /**
     * @private
     * @type {Contracts.Kernel.Logger}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    /**
     * @private
     * @type {Contracts.Blockchain.Blockchain}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.BlockchainService)
    private readonly blockchainService!: Contracts.Blockchain.Blockchain;

    /**
     * @protected
     * @type {DatabaseService}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.DatabaseService)
    protected readonly databaseService!: DatabaseService;

    /**
     * @protected
     * @type {Contracts.TransactionPool.Connection}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.TransactionPoolService)
    protected readonly transactionPoolService!: Contracts.TransactionPool.Connection;

    /**
     * @protected
     * @type {Contracts.State.WalletRepository}
     * @memberof DelegateTracker
     */
    @Container.inject(Container.Identifiers.WalletRepository)
    protected readonly walletRepository!: Contracts.State.WalletRepository;

    /**
     * @returns {Promise<void>}
     * @memberof DelegateTracker
     */
    public async execute(delegates: Delegate[]): Promise<void> {
        // Arrange...
        const { height, timestamp } = this.blockchainService.getLastBlock().data;
        const delegatesCount = Managers.configManager.getMilestone(height).activeDelegates;
        const blockTime: number = Managers.configManager.getMilestone(height).blocktime;
        const round: Contracts.Shared.RoundInfo = Utils.roundCalculator.calculateRound(height);

        const activeDelegates: (string | undefined)[] = (await this.databaseService.getActiveDelegates(round)).map(
            (delegate: Contracts.State.Wallet) => delegate.publicKey,
        );

        // Determine Next Forgers...
        const nextForgers: string[] = [];
        for (let i = 2; i <= delegatesCount; i++) {
            const delegate: string | undefined =
                activeDelegates[(Crypto.Slots.getSlotNumber(timestamp) + i) % delegatesCount];

            if (delegate) {
                nextForgers.push(delegate);
            }
        }

        // Determine Next Forger Usernames...
        this.logger.debug(
            `Next Forgers: ${JSON.stringify(
                nextForgers.slice(0, 5).map((publicKey: string) => this.getUsername(publicKey)),
            )}`,
        );

        let secondsToNextRound: number | undefined;
        for (const delegate of delegates) {
            let secondsToForge: number = 0;
            for (let i = 0; i < nextForgers.length; i++) {
                if (nextForgers[i] === delegate.publicKey) {
                    break;
                }

                secondsToForge += blockTime;
            }

            // Round Information...
            secondsToNextRound = (delegatesCount - (height % delegatesCount)) * blockTime;

            if (secondsToForge === 0) {
                this.logger.debug(`${this.getUsername(delegate.publicKey)} will forge next.`);
            } else if (secondsToForge > secondsToNextRound) {
                this.logger.debug(
                    `${this.getUsername(delegate.publicKey)} will forge in ${Utils.prettyTime(secondsToForge * 1000)}.`,
                );
            } else {
                this.logger.debug(`${this.getUsername(delegate.publicKey)} has already forged.`);
            }
        }

        if (secondsToNextRound) {
            this.logger.debug(`Round ${round.round} will end in ${Utils.prettyTime(secondsToNextRound * 1000)}.`);
        }
    }

    /**
     * @private
     * @param {string} publicKey
     * @returns {string}
     * @memberof DelegateTracker
     */
    private getUsername(publicKey: string): string {
        return this.walletRepository.findByPublicKey(publicKey).getAttribute("delegate.username");
    }
}