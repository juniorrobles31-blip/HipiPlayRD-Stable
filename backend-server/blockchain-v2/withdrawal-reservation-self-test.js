"use strict";

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
    BlockchainV2Database
} = require("./database");

const {
    DepositLedgerService
} = require("./deposit-ledger-service");

const {
    WithdrawalReservationService
} = require("./withdrawal-reservation-service");

const databaseFile =
    path.join(
        os.tmpdir(),
        `hipiplay-withdrawal-reservation-${crypto.randomUUID()}.sqlite`
    );

const database =
    new BlockchainV2Database(
        databaseFile
    );

const tokenAddress =
    "0x0000000000000000000000000000000000001000";

const vaultOne =
    "0x0000000000000000000000000000000000002000";

const vaultTwo =
    "0x0000000000000000000000000000000000002001";

const otherUserVault =
    "0x0000000000000000000000000000000000002999";

function createIntent({
    intentId,
    playerId,
    vaultIdCharacter,
    vaultAddress,
    amountAtomic,
    createdAt
}) {
    database.createPaymentIntent({
        intentId,
        playerId,
        network:
            "hardhat-local",
        chainId:
            31337,
        tokenSymbol:
            "USDT",
        tokenAddress,
        vaultId:
            "0x" +
            vaultIdCharacter.repeat(64),
        vaultAddress,
        expectedAmountAtomic:
            amountAtomic,
        status:
            "PAID",
        expiresAt:
            "2026-06-27T00:00:00.000Z",
        createdAt
    });
}

function createDeposit({
    txCharacter,
    blockCharacter,
    vaultAddress,
    amountAtomic,
    blockNumber
}) {
    database.recordChainEvent({
        chainId:
            31337,
        txHash:
            "0x" +
            txCharacter.repeat(64),
        logIndex:
            0,
        blockNumber,
        blockHash:
            "0x" +
            blockCharacter.repeat(64),
        contractAddress:
            tokenAddress,
        eventName:
            "Transfer",
        fromAddress:
            "0x0000000000000000000000000000000000003000",
        toAddress:
            vaultAddress,
        amountAtomic,
        confirmations:
            12,
        status:
            "FINALIZED"
    });
}

async function run() {
    createIntent({
        intentId:
            "INT-WDR-001",
        playerId:
            "usr_withdrawal_test",
        vaultIdCharacter:
            "a",
        vaultAddress:
            vaultOne,
        amountAtomic:
            30000000n,
        createdAt:
            "2026-06-26T20:00:00.000Z"
    });

    createIntent({
        intentId:
            "INT-WDR-002",
        playerId:
            "usr_withdrawal_test",
        vaultIdCharacter:
            "b",
        vaultAddress:
            vaultTwo,
        amountAtomic:
            25000000n,
        createdAt:
            "2026-06-26T20:01:00.000Z"
    });

    createIntent({
        intentId:
            "INT-WDR-OTHER",
        playerId:
            "usr_other_player",
        vaultIdCharacter:
            "c",
        vaultAddress:
            otherUserVault,
        amountAtomic:
            100000000n,
        createdAt:
            "2026-06-26T20:02:00.000Z"
    });

    createDeposit({
        txCharacter:
            "1",
        blockCharacter:
            "d",
        vaultAddress:
            vaultOne,
        amountAtomic:
            30000000n,
        blockNumber:
            100
    });

    createDeposit({
        txCharacter:
            "2",
        blockCharacter:
            "e",
        vaultAddress:
            vaultTwo,
        amountAtomic:
            25000000n,
        blockNumber:
            101
    });

    createDeposit({
        txCharacter:
            "3",
        blockCharacter:
            "f",
        vaultAddress:
            otherUserVault,
        amountAtomic:
            100000000n,
        blockNumber:
            102
    });

    const ledgerService =
        new DepositLedgerService({
            database
        });

    const creditResult =
        ledgerService
            .creditFinalizedDeposits();

    assert.equal(
        creditResult.entriesCreated,
        3
    );

    let uuidCounter = 0;

    const service =
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
            clock:
                () =>
                    new Date(
                        "2026-06-26T20:30:00.000Z"
                    ),
            randomUUID:
                () => {
                    uuidCounter++;

                    return (
                        "aaaaaaaa-bbbb-4ccc-8ddd-" +
                        uuidCounter
                            .toString()
                            .padStart(12, "0")
                    );
                }
        });

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        55000000n
    );

    const firstWithdrawal =
        service.reserveWithdrawal({
            playerId:
                "usr_withdrawal_test",
            destinationAddress:
                "0x0000000000000000000000000000000000004000",
            amount:
                "40"
        });

    assert.equal(
        firstWithdrawal.status,
        "RESERVED"
    );

    assert.equal(
        firstWithdrawal.amountAtomic,
        "40000000"
    );

    assert.equal(
        firstWithdrawal.sources.length,
        2
    );

    assert.equal(
        firstWithdrawal.sources[0]
            .vaultAddress.toLowerCase(),
        vaultOne.toLowerCase()
    );

    assert.equal(
        firstWithdrawal.sources[0]
            .amountAtomic,
        "30000000"
    );

    assert.equal(
        firstWithdrawal.sources[1]
            .vaultAddress.toLowerCase(),
        vaultTwo.toLowerCase()
    );

    assert.equal(
        firstWithdrawal.sources[1]
            .amountAtomic,
        "10000000"
    );

    assert.equal(
        firstWithdrawal.sources.some(
            source =>
                source.vaultAddress
                    .toLowerCase() ===
                otherUserVault
                    .toLowerCase()
        ),
        false
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        15000000n
    );

    let insufficientBalanceRejected =
        false;

    try {
        service.reserveWithdrawal({
            playerId:
                "usr_withdrawal_test",
            destinationAddress:
                "0x0000000000000000000000000000000000004001",
            amount:
                "16"
        });
    } catch (error) {
        insufficientBalanceRejected =
            error.message.includes(
                "Balance V2 insuficiente"
            );
    }

    assert.equal(
        insufficientBalanceRejected,
        true
    );

    const secondWithdrawal =
        service.reserveWithdrawal({
            playerId:
                "usr_withdrawal_test",
            destinationAddress:
                "0x0000000000000000000000000000000000004001",
            amount:
                "15"
        });

    assert.equal(
        secondWithdrawal.sources.length,
        1
    );

    assert.equal(
        secondWithdrawal.sources[0]
            .vaultAddress.toLowerCase(),
        vaultTwo.toLowerCase()
    );

    assert.equal(
        secondWithdrawal.sources[0]
            .amountAtomic,
        "15000000"
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        0n
    );

    const cancelledFirst =
        service.cancelReservation(
            firstWithdrawal.withdrawalId
        );

    assert.equal(
        cancelledFirst.released,
        true
    );

    assert.equal(
        cancelledFirst.withdrawal.status,
        "CANCELLED"
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        40000000n
    );

    /*
     * Después de cancelar el primer retiro existen:
     *
     * - 40 USDT disponibles en el ledger.
     * - 40 USDT disponibles en las bóvedas.
     *
     * Para comprobar la protección de liquidez añadimos
     * temporalmente 10 USDT contables no respaldados por
     * depósitos blockchain. Así el ledger tendrá 50 USDT,
     * pero las bóvedas solamente podrán cubrir 40 USDT.
     */

    database.connection
        .prepare(`
            INSERT INTO account_ledger (
                player_id,
                asset,
                direction,
                amount_atomic,
                reference_type,
                reference_id,
                entry_type,
                created_at
            )
            VALUES (
                ?, ?, 'CREDIT', ?,
                ?, ?, ?, ?
            )
        `)
        .run(
            "usr_withdrawal_test",
            "USDT",
            "10000000",
            "SELF_TEST",
            "UNBACKED-CREDIT-001",
            "UNBACKED_TEST_CREDIT",
            "2026-06-26T20:31:00.000Z"
        );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        50000000n
    );

    let vaultAvailabilityRejected =
        false;

    try {
        service.reserveWithdrawal({
            playerId:
                "usr_withdrawal_test",

            destinationAddress:
                "0x0000000000000000000000000000000000004002",

            amount:
                "45"
        });
    } catch (error) {
        vaultAvailabilityRejected =
            error.message.includes(
                "Fondos disponibles en bóvedas insuficientes"
            );
    }

    assert.equal(
        vaultAvailabilityRejected,
        true
    );

    /*
     * Revertir el crédito artificial para continuar
     * la prueba con el saldo real de 40 USDT.
     */

    database.connection
        .prepare(`
            INSERT INTO account_ledger (
                player_id,
                asset,
                direction,
                amount_atomic,
                reference_type,
                reference_id,
                entry_type,
                created_at
            )
            VALUES (
                ?, ?, 'DEBIT', ?,
                ?, ?, ?, ?
            )
        `)
        .run(
            "usr_withdrawal_test",
            "USDT",
            "10000000",
            "SELF_TEST",
            "UNBACKED-DEBIT-001",
            "UNBACKED_TEST_REVERSAL",
            "2026-06-26T20:32:00.000Z"
        );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        40000000n
    );

    const cancelledSecond =
        service.cancelReservation(
            secondWithdrawal.withdrawalId
        );

    assert.equal(
        cancelledSecond.released,
        true
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        55000000n
    );

    const repeatedCancellation =
        service.cancelReservation(
            secondWithdrawal.withdrawalId
        );

    assert.equal(
        repeatedCancellation.released,
        false
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        55000000n
    );

    const finalWithdrawal =
        service.reserveWithdrawal({
            playerId:
                "usr_withdrawal_test",
            destinationAddress:
                "0x0000000000000000000000000000000000004003",
            amount:
                "55"
        });

    assert.equal(
        finalWithdrawal.sources.length,
        2
    );

    assert.equal(
        finalWithdrawal.sources[0]
            .amountAtomic,
        "30000000"
    );

    assert.equal(
        finalWithdrawal.sources[1]
            .amountAtomic,
        "25000000"
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_withdrawal_test"
        ),
        0n
    );

    assert.equal(
        service.getPlayerBalanceAtomic(
            "usr_other_player"
        ),
        100000000n
    );

    let invalidDecimalsRejected =
        false;

    try {
        service.reserveWithdrawal({
            playerId:
                "usr_other_player",
            destinationAddress:
                "0x0000000000000000000000000000000000004004",
            amount:
                "1.0000001"
        });
    } catch {
        invalidDecimalsRejected =
            true;
    }

    assert.equal(
        invalidDecimalsRejected,
        true
    );

    const duplicateReleaseCount =
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM account_ledger
                WHERE reference_type =
                    'WITHDRAWAL'
                  AND reference_id = ?
                  AND entry_type =
                    'WITHDRAWAL_RESERVATION_RELEASED'
            `)
            .get(
                secondWithdrawal
                    .withdrawalId
            );

    assert.equal(
        Number(
            duplicateReleaseCount.total
        ),
        1
    );

    const sourceTotals =
        database.connection
            .prepare(`
                SELECT
                    withdrawal_id,
                    amount_atomic
                FROM withdrawal_sources
                WHERE withdrawal_id = ?
                ORDER BY source_index ASC
            `)
            .all(
                finalWithdrawal
                    .withdrawalId
            )
            .reduce(
                (
                    total,
                    source
                ) =>
                    total +
                    BigInt(
                        source.amount_atomic
                    ),
                0n
            );

    assert.equal(
        sourceTotals,
        55000000n
    );

    console.log(
        JSON.stringify(
            {
                ok:
                    true,

                initialBalanceAtomic:
                    "55000000",

                firstWithdrawalSources:
                    firstWithdrawal.sources,

                balanceAfterFirstReservation:
                    "15000000",

                insufficientBalanceRejected,

                secondWithdrawalSources:
                    secondWithdrawal.sources,

                balanceAfterSecondReservation:
                    "0",

                firstReservationReleased:
                    cancelledFirst.released,

                vaultAvailabilityProtected:
                    vaultAvailabilityRejected,

                secondReservationReleased:
                    cancelledSecond.released,

                repeatedCancellationCreatedCredit:
                    repeatedCancellation.released,

                duplicateReleaseEntries:
                    Number(
                        duplicateReleaseCount.total
                    ),

                finalWithdrawalSources:
                    finalWithdrawal.sources,

                finalWithdrawalSourceTotal:
                    sourceTotals.toString(),

                otherUserVaultSelected:
                    finalWithdrawal.sources.some(
                        source =>
                            source.vaultAddress
                                .toLowerCase() ===
                            otherUserVault
                                .toLowerCase()
                    ),

                invalidDecimalsRejected,

                transactionsSigned:
                    false,

                transactionsBroadcast:
                    false,

                serverJsModified:
                    false
            },
            null,
            2
        )
    );
}

run()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
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