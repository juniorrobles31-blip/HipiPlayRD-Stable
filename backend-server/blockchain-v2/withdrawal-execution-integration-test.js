"use strict";

function jsonSafe(value) {
    return JSON.stringify(
        value,
        (_key, item) =>
            typeof item === "bigint"
                ? item.toString()
                : item,
        2
    );
}

const assert =
    require("node:assert/strict");

const crypto =
    require("node:crypto");

const fs =
    require("node:fs");

const os =
    require("node:os");

const path =
    require("node:path");

const {
    Contract,
    JsonRpcProvider
} = require("ethers");

const tokenAbi =
    require("./abi/MockUSDT.json");

const factoryAbi =
    require("./abi/VaultFactory.json");

const orchestratorAbi =
    require("./abi/WithdrawalOrchestrator.json");

const {
    BlockchainV2Database
} = require("./database");

const {
    PaymentIntentService
} = require("./payment-intent-service");

const {
    VaultFactoryClient
} = require("./vault-factory-client");

const {
    Erc20DepositWatcher
} = require("./erc20-deposit-watcher");

const {
    DepositLedgerService
} = require("./deposit-ledger-service");

const {
    WithdrawalReservationService
} = require("./withdrawal-reservation-service");

const {
    WithdrawalEip712Service
} = require("./withdrawal-eip712-service");

const {
    WithdrawalExecutionService
} = require("./withdrawal-execution-service");

const {
    ReconciliationService
} = require("./reconciliation-service");

const [
    rpcUrl,
    factoryAddress,
    orchestratorAddress,
    signerRegistryAddress,
    tokenAddress
] = process.argv.slice(2);

const databaseFile =
    path.join(
        os.tmpdir(),
        `hipiplay-withdrawal-e2e-${crypto.randomUUID()}.sqlite`
    );

const database =
    new BlockchainV2Database(
        databaseFile
    );

const provider =
    new JsonRpcProvider(
        rpcUrl
    );

const factoryClient =
    new VaultFactoryClient({
        rpcUrl,
        factoryAddress,
        tokenAddress,
        chainId:
            31337
    });

let watcher;

async function run() {
    await factoryClient.initialize();

    const owner =
        await provider.getSigner(0);

    const signerOne =
        await provider.getSigner(1);

    const signerTwo =
        await provider.getSigner(2);

    const destination =
        await provider.getSigner(8);

    const destinationAddress =
        await destination.getAddress();

    const token =
        new Contract(
            tokenAddress,
            tokenAbi,
            owner
        );

    const factory =
        new Contract(
            factoryAddress,
            factoryAbi,
            owner
        );

    const orchestrator =
        new Contract(
            orchestratorAddress,
            orchestratorAbi,
            owner
        );

    let uuidCounter = 0;

    const paymentIntentService =
        new PaymentIntentService({
            database,
            network:
                "hardhat-local",
            chainId:
                31337,
            tokenSymbol:
                "USDT",
            tokenAddress,
            tokenDecimals:
                6,
            expirationMinutes:
                30,
            predictVaultAddress:
                vaultId =>
                    factoryClient
                        .predictVaultAddress(
                            vaultId
                        ),
            randomUUID:
                () => {
                    uuidCounter++;

                    return (
                        "12345678-1234-4234-8234-" +
                        uuidCounter
                            .toString()
                            .padStart(12, "0")
                    );
                }
        });

    const intentOneResult =
        await paymentIntentService
            .createPaymentIntent({
                playerId:
                    "usr_execution_test",
                amount:
                    "30"
            });

    const intentTwoResult =
        await paymentIntentService
            .createPaymentIntent({
                playerId:
                    "usr_execution_test",
                amount:
                    "25"
            });

    const intentOne =
        intentOneResult.intent;

    const intentTwo =
        intentTwoResult.intent;

    const mintOne =
        await token.mint(
            intentOne.depositAddress,
            30000000n
        );

    const receiptOne =
        await mintOne.wait();

    const mintTwo =
        await token.mint(
            intentTwo.depositAddress,
            25000000n
        );

    const receiptTwo =
        await mintTwo.wait();

    const deployOne =
        await factory.deployVault(
            intentOne.vaultId
        );

    await deployOne.wait();

    const deployTwo =
        await factory.deployVault(
            intentTwo.vaultId
        );

    await deployTwo.wait();

    assert.equal(
        await token.balanceOf(
            intentOne.depositAddress
        ),
        30000000n
    );

    assert.equal(
        await token.balanceOf(
            intentTwo.depositAddress
        ),
        25000000n
    );

    watcher =
        new Erc20DepositWatcher({
            database,
            rpcUrl,
            chainId:
                31337,
            tokenAddress,
            requiredConfirmations:
                1,
            startBlock:
                Math.min(
                    Number(
                        receiptOne.blockNumber
                    ),
                    Number(
                        receiptTwo.blockNumber
                    )
                ),
            maxBlockRange:
                100
        });

    await watcher.initialize();

    const watcherResult =
        await watcher.scanOnce();

    assert.equal(
        watcherResult.newlyRecorded,
        2
    );

    const ledgerService =
        new DepositLedgerService({
            database
        });

    const creditResult =
        ledgerService
            .creditFinalizedDeposits();

    assert.equal(
        creditResult.entriesCreated,
        2
    );

    assert.equal(
        ledgerService
            .getPlayerBalanceAtomic(
                "usr_execution_test",
                "USDT"
            ),
        55000000n
    );

    const reservationService =
        new WithdrawalReservationService({
            database,
            network:
                "hardhat-local",
            chainId:
                31337,
            tokenSymbol:
                "USDT",
            tokenAddress,
            tokenDecimals:
                6,
            randomUUID:
                () =>
                    "abcdefab-cdef-4abc-8def-000000000001"
        });

    const withdrawal =
        reservationService
            .reserveWithdrawal({
                playerId:
                    "usr_execution_test",
                destinationAddress,
                amount:
                    "40"
            });

    assert.equal(
        withdrawal.status,
        "RESERVED"
    );

    assert.equal(
        withdrawal.sources.length,
        2
    );

    assert.equal(
        withdrawal.sources[0]
            .amountAtomic,
        "30000000"
    );

    assert.equal(
        withdrawal.sources[1]
            .amountAtomic,
        "10000000"
    );

    assert.equal(
        ledgerService
            .getPlayerBalanceAtomic(
                "usr_execution_test",
                "USDT"
            ),
        15000000n
    );

    const signingService =
        new WithdrawalEip712Service({
            database,
            provider,
            orchestratorAddress,
            chainId:
                31337,
            signatureTtlSeconds:
                3600
        });

    const signingStatus =
        await signingService.initialize();

    const prepared =
        await signingService
            .prepareWithdrawal(
                withdrawal.withdrawalId
            );

    const signed =
        await signingService
            .signAndStore(
                prepared,
                [
                    signerOne,
                    signerTwo
                ]
            );

    assert.equal(
        signed.length,
        2
    );

    const storedSigned =
        database.connection
            .prepare(`
                SELECT
                    status,
                    nonce
                FROM withdrawals_v2
                WHERE withdrawal_id = ?
            `)
            .get(
                withdrawal.withdrawalId
            );

    assert.equal(
        storedSigned.status,
        "SIGNED"
    );

    assert.equal(
        storedSigned.nonce,
        "0"
    );

    const destinationBefore =
        await token.balanceOf(
            destinationAddress
        );

    const vaultOneBefore =
        await token.balanceOf(
            intentOne.depositAddress
        );

    const vaultTwoBefore =
        await token.balanceOf(
            intentTwo.depositAddress
        );

    assert.equal(
        destinationBefore,
        0n
    );

    assert.equal(
        vaultOneBefore,
        30000000n
    );

    assert.equal(
        vaultTwoBefore,
        25000000n
    );

    const executionService =
        new WithdrawalExecutionService({
            database,
            provider,
            orchestratorAddress,
            chainId:
                31337
        });

    const executionStatus =
        await executionService.initialize();

    const execution =
        await executionService
            .executeWithdrawal(
                withdrawal.withdrawalId,
                owner
            );

    assert.equal(
        execution.status,
        "CONFIRMED"
    );

    const destinationAfter =
        await token.balanceOf(
            destinationAddress
        );

    const vaultOneAfter =
        await token.balanceOf(
            intentOne.depositAddress
        );

    const vaultTwoAfter =
        await token.balanceOf(
            intentTwo.depositAddress
        );

    assert.equal(
        destinationAfter,
        40000000n
    );

    assert.equal(
        vaultOneAfter,
        0n
    );

    assert.equal(
        vaultTwoAfter,
        15000000n
    );

    const nextNonceAfter =
        await orchestrator.nextNonce();

    assert.equal(
        nextNonceAfter,
        1n
    );

    const usedWithdrawalId =
        await orchestrator
            .usedWithdrawalIds(
                execution.payload
                    .withdrawalIdHash
            );

    assert.equal(
        usedWithdrawalId,
        true
    );

    const storedConfirmed =
        database.connection
            .prepare(`
                SELECT
                    status,
                    tx_hash,
                    submitted_at,
                    confirmed_at
                FROM withdrawals_v2
                WHERE withdrawal_id = ?
            `)
            .get(
                withdrawal.withdrawalId
            );

    assert.equal(
        storedConfirmed.status,
        "CONFIRMED"
    );

    assert.equal(
        storedConfirmed.tx_hash
            .toLowerCase(),
        execution.transactionHash
            .toLowerCase()
    );

    let replayRejected =
        false;

    try {
        const replayMethod =
            orchestrator.getFunction(
                orchestrator.interface
                    .getFunction(
                        "executeWithdrawal"
                    )
                    .format(
                        "sighash"
                    )
            );

        const replayTransaction =
            await replayMethod(
                ...execution
                    .contractArguments
            );

        await replayTransaction.wait();
    } catch {
        replayRejected =
            true;
    }

    assert.equal(
        replayRejected,
        true
    );

    const nonceAfterReplayAttempt =
        await orchestrator.nextNonce();

    assert.equal(
        nonceAfterReplayAttempt,
        1n
    );

    assert.equal(
        await token.balanceOf(
            destinationAddress
        ),
        40000000n
    );

    assert.equal(
        ledgerService
            .getPlayerBalanceAtomic(
                "usr_execution_test",
                "USDT"
            ),
        15000000n
    );

    const reconciliationService =
        new ReconciliationService({
            database,

            getVaultBalanceAtomic:
                address =>
                    token.balanceOf(
                        address
                    )
        });

    const reconciliation =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        reconciliation.status,
        "OK"
    );

    assert.equal(
        reconciliation.expectedVaultTotalAtomic,
        "15000000"
    );

    assert.equal(
        reconciliation.observedVaultTotalAtomic,
        "15000000"
    );

    const registry =
        new Contract(
            signerRegistryAddress,
            [
                "function threshold() view returns (uint256)",
                "function signerCount() view returns (uint256)"
            ],
            provider
        );

    assert.equal(
        await registry.threshold(),
        2n
    );

    assert.equal(
        await registry.signerCount(),
        3n
    );

    console.log(
        jsonSafe({
            ok:
                true,

            watcherResult,

            creditResult,

            signingStatus,

            executionStatus,

            withdrawalId:
                withdrawal.withdrawalId,

            withdrawalIdHash:
                execution.payload
                    .withdrawalIdHash,

            signatureCount:
                signed.length,

            sourceCount:
                withdrawal.sources.length,

            transactionHash:
                execution.transactionHash,

            transactionBlock:
                execution.blockNumber,

            gasUsed:
                execution.gasUsed,

            destinationBalanceBefore:
                destinationBefore,

            destinationBalanceAfter:
                destinationAfter,

            vaultOneBalanceBefore:
                vaultOneBefore,

            vaultOneBalanceAfter:
                vaultOneAfter,

            vaultTwoBalanceBefore:
                vaultTwoBefore,

            vaultTwoBalanceAfter:
                vaultTwoAfter,

            nextNonceBefore:
                executionStatus.nextNonce,

            nextNonceAfter:
                nextNonceAfter,

            withdrawalIdMarkedUsed:
                usedWithdrawalId,

            replayRejected,

            nonceAfterReplayAttempt,

            playerLedgerBalanceAfterWithdrawal:
                ledgerService
                    .getPlayerBalanceAtomic(
                        "usr_execution_test",
                        "USDT"
                    ),

            withdrawalDatabaseStatus:
                storedConfirmed.status,

            reconciliationStatus:
                reconciliation.status,

            expectedVaultTotalAtomic:
                reconciliation
                    .expectedVaultTotalAtomic,

            observedVaultTotalAtomic:
                reconciliation
                    .observedVaultTotalAtomic,

            bscTestnetUsed:
                false,

            serverJsModified:
                false
        })
    );
}

run()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (watcher) {
            await watcher.close();
        }

        await factoryClient.close();

        if (
            typeof provider.destroy ===
            "function"
        ) {
            await provider.destroy();
        }

        database.close();

        for (
            const suffix of [
                "",
                "-wal",
                "-shm"
            ]
        ) {
            fs.rmSync(
                `${databaseFile}${suffix}`,
                {
                    force:
                        true
                }
            );
        }
    });