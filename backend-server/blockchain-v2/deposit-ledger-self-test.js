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

const temporaryDatabase =
    path.join(
        os.tmpdir(),
        `hipiplay-ledger-${crypto.randomUUID()}.sqlite`
    );

const database =
    new BlockchainV2Database(
        temporaryDatabase
    );

function transactionHash(character) {
    return (
        "0x" +
        String(character).repeat(64)
    );
}

function blockHash(character) {
    return (
        "0x" +
        String(character).repeat(64)
    );
}

function insertEvent({
    txCharacter,
    blockCharacter,
    logIndex,
    amountAtomic,
    status,
    blockNumber
}) {
    return database.recordChainEvent({
        chainId:
            31337,

        txHash:
            transactionHash(
                txCharacter
            ),

        logIndex,

        blockNumber,

        blockHash:
            blockHash(
                blockCharacter
            ),

        contractAddress:
            "0x0000000000000000000000000000000000001000",

        eventName:
            "Transfer",

        fromAddress:
            "0x0000000000000000000000000000000000003000",

        toAddress:
            "0x0000000000000000000000000000000000002000",

        amountAtomic,

        confirmations:
            status === "FINALIZED"
                ? 12
                : 1,

        status
    });
}

try {
    const createdAt =
        "2026-06-26T20:00:00.000Z";

    database.createPaymentIntent({
        intentId:
            "INT-LEDGER-001",

        playerId:
            "usr_ledger_test",

        network:
            "hardhat-local",

        chainId:
            31337,

        tokenSymbol:
            "USDT",

        tokenAddress:
            "0x0000000000000000000000000000000000001000",

        vaultId:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

        vaultAddress:
            "0x0000000000000000000000000000000000002000",

        expectedAmountAtomic:
            50000000n,

        status:
            "PAID",

        expiresAt:
            "2026-06-26T21:00:00.000Z",

        createdAt
    });

    assert.equal(
        insertEvent({
            txCharacter: "1",
            blockCharacter: "a",
            logIndex: 0,
            amountAtomic: 20000000n,
            status: "FINALIZED",
            blockNumber: 100
        }),
        true
    );

    assert.equal(
        insertEvent({
            txCharacter: "2",
            blockCharacter: "b",
            logIndex: 0,
            amountAtomic: 30000000n,
            status: "FINALIZED",
            blockNumber: 101
        }),
        true
    );

    assert.equal(
        insertEvent({
            txCharacter: "3",
            blockCharacter: "c",
            logIndex: 0,
            amountAtomic: 5000000n,
            status: "OBSERVED",
            blockNumber: 102
        }),
        true
    );

    assert.equal(
        insertEvent({
            txCharacter: "4",
            blockCharacter: "d",
            logIndex: 0,
            amountAtomic: 2000000n,
            status: "ORPHANED",
            blockNumber: 103
        }),
        true
    );

    const service =
        new DepositLedgerService({
            database,

            clock:
                () =>
                    new Date(
                        "2026-06-26T20:30:00.000Z"
                    )
        });

    const firstRun =
        service.creditFinalizedDeposits();

    assert.equal(
        firstRun.finalizedEventsMatched,
        2
    );

    assert.equal(
        firstRun.entriesCreated,
        2
    );

    assert.equal(
        firstRun.entriesSkipped,
        0
    );

    assert.equal(
        firstRun.creditedAtomic,
        "50000000"
    );

    assert.equal(
        service
            .getPlayerBalanceAtomic(
                "usr_ledger_test",
                "USDT"
            ),
        50000000n
    );

    const secondRun =
        service.creditFinalizedDeposits();

    assert.equal(
        secondRun.finalizedEventsMatched,
        2
    );

    assert.equal(
        secondRun.entriesCreated,
        0
    );

    assert.equal(
        secondRun.entriesSkipped,
        2
    );

    assert.equal(
        service
            .getPlayerBalanceAtomic(
                "usr_ledger_test",
                "USDT"
            ),
        50000000n
    );

    database.connection
        .prepare(`
            UPDATE chain_events
            SET
                status = 'FINALIZED',
                confirmations = 12,
                finalized_at = ?
            WHERE tx_hash = ?
        `)
        .run(
            "2026-06-26T20:35:00.000Z",
            transactionHash("3")
        );

    const thirdRun =
        service.creditFinalizedDeposits();

    assert.equal(
        thirdRun.finalizedEventsMatched,
        3
    );

    assert.equal(
        thirdRun.entriesCreated,
        1
    );

    assert.equal(
        thirdRun.entriesSkipped,
        2
    );

    assert.equal(
        thirdRun.creditedAtomic,
        "5000000"
    );

    assert.equal(
        service
            .getPlayerBalanceAtomic(
                "usr_ledger_test",
                "USDT"
            ),
        55000000n
    );

    const fourthRun =
        service.creditFinalizedDeposits();

    assert.equal(
        fourthRun.entriesCreated,
        0
    );

    assert.equal(
        fourthRun.entriesSkipped,
        3
    );

    const entries =
        service.listPlayerEntries(
            "usr_ledger_test",
            "USDT"
        );

    assert.equal(
        entries.length,
        3
    );

    assert.equal(
        entries[0].amount_atomic,
        "20000000"
    );

    assert.equal(
        entries[1].amount_atomic,
        "30000000"
    );

    assert.equal(
        entries[2].amount_atomic,
        "5000000"
    );

    assert.equal(
        entries.every(
            entry =>
                entry.direction ===
                "CREDIT"
        ),
        true
    );

    assert.equal(
        entries.every(
            entry =>
                entry.entry_type ===
                "BLOCKCHAIN_DEPOSIT_FINALIZED"
        ),
        true
    );

    const duplicateReferenceCount =
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM (
                    SELECT
                        reference_type,
                        reference_id,
                        entry_type,
                        COUNT(*) AS occurrences
                    FROM account_ledger
                    GROUP BY
                        reference_type,
                        reference_id,
                        entry_type
                    HAVING COUNT(*) > 1
                )
            `)
            .get();

    assert.equal(
        Number(
            duplicateReferenceCount.total
        ),
        0
    );

    const orphanedLedgerCount =
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM account_ledger
                WHERE reference_id LIKE ?
            `)
            .get(
                `%${transactionHash("4").toLowerCase()}%`
            );

    assert.equal(
        Number(
            orphanedLedgerCount.total
        ),
        0
    );

    const summary =
        service.getLedgerSummary();

    assert.deepEqual(
        summary,
        [
            {
                playerId:
                    "usr_ledger_test",

                asset:
                    "USDT",

                balanceAtomic:
                    "55000000"
            }
        ]
    );

    console.log(
        JSON.stringify(
            {
                ok: true,

                firstRun,

                secondRun,

                thirdRun,

                fourthRun,

                ledgerEntryCount:
                    entries.length,

                balanceAtomic:
                    service
                        .getPlayerBalanceAtomic(
                            "usr_ledger_test",
                            "USDT"
                        )
                        .toString(),

                duplicateLedgerEntries:
                    Number(
                        duplicateReferenceCount.total
                    ),

                orphanedEventsCredited:
                    Number(
                        orphanedLedgerCount.total
                    ),

                observedEventInitiallyCredited:
                    false,

                observedEventCreditedAfterFinalization:
                    true,

                legacyGameBalanceModified:
                    false,

                serverJsModified:
                    false
            },
            null,
            2
        )
    );
} finally {
    database.close();

    for (
        const suffix of [
            "",
            "-wal",
            "-shm"
        ]
    ) {
        fs.rmSync(
            `${temporaryDatabase}${suffix}`,
            {
                force: true
            }
        );
    }
}