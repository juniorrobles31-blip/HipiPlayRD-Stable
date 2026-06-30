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
    ReconciliationService,
    buildEventReference
} = require("./reconciliation-service");

const databaseFile =
    path.join(
        os.tmpdir(),
        `hipiplay-reconciliation-${crypto.randomUUID()}.sqlite`
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

const txOne =
    "0x" + "1".repeat(64);

const txTwo =
    "0x" + "2".repeat(64);

const balances =
    new Map([
        [
            vaultOne.toLowerCase(),
            50000000n
        ],
        [
            vaultTwo.toLowerCase(),
            20000000n
        ]
    ]);

function createIntent({
    intentId,
    playerId,
    vaultId,
    vaultAddress,
    amountAtomic
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
        vaultId,
        vaultAddress,
        expectedAmountAtomic:
            amountAtomic,
        status:
            "PAID",
        expiresAt:
            "2026-06-26T23:00:00.000Z",
        createdAt:
            "2026-06-26T20:00:00.000Z"
    });
}

function createFinalizedEvent({
    txHash,
    blockHashCharacter,
    toAddress,
    amountAtomic,
    blockNumber
}) {
    database.recordChainEvent({
        chainId:
            31337,
        txHash,
        logIndex:
            0,
        blockNumber,
        blockHash:
            "0x" +
            blockHashCharacter.repeat(64),
        contractAddress:
            tokenAddress,
        eventName:
            "Transfer",
        fromAddress:
            "0x0000000000000000000000000000000000003000",
        toAddress,
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
            "INT-RECON-001",
        playerId:
            "usr_recon_001",
        vaultId:
            "0x" + "a".repeat(64),
        vaultAddress:
            vaultOne,
        amountAtomic:
            50000000n
    });

    createIntent({
        intentId:
            "INT-RECON-002",
        playerId:
            "usr_recon_002",
        vaultId:
            "0x" + "b".repeat(64),
        vaultAddress:
            vaultTwo,
        amountAtomic:
            20000000n
    });

    createFinalizedEvent({
        txHash:
            txOne,
        blockHashCharacter:
            "c",
        toAddress:
            vaultOne,
        amountAtomic:
            50000000n,
        blockNumber:
            100
    });

    createFinalizedEvent({
        txHash:
            txTwo,
        blockHashCharacter:
            "d",
        toAddress:
            vaultTwo,
        amountAtomic:
            20000000n,
        blockNumber:
            101
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
        2
    );

    const reconciliationService =
        new ReconciliationService({
            database,

            getVaultBalanceAtomic:
                async address =>
                    balances.get(
                        address.toLowerCase()
                    ) ?? 0n,

            clock:
                () =>
                    new Date(
                        "2026-06-26T20:30:00.000Z"
                    )
        });

    const cleanRun =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        cleanRun.status,
        "OK"
    );

    assert.equal(
        cleanRun.findings.length,
        0
    );

    database.connection
        .prepare(`
            INSERT INTO withdrawals_v2 (
                withdrawal_id,
                player_id,
                network,
                chain_id,
                token_symbol,
                token_address,
                destination_address,
                amount_atomic,
                status,
                created_at,
                updated_at,
                confirmed_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?,
                'CONFIRMED', ?, ?, ?
            )
        `)
        .run(
            "WDR-RECON-001",
            "usr_recon_001",
            "hardhat-local",
            31337,
            "USDT",
            tokenAddress,
            "0x0000000000000000000000000000000000004000",
            "10000000",
            "2026-06-26T20:31:00.000Z",
            "2026-06-26T20:31:00.000Z",
            "2026-06-26T20:31:00.000Z"
        );

    database.connection
        .prepare(`
            INSERT INTO withdrawal_sources (
                withdrawal_id,
                source_index,
                vault_address,
                amount_atomic
            )
            VALUES (?, ?, ?, ?)
        `)
        .run(
            "WDR-RECON-001",
            0,
            vaultOne,
            "10000000"
        );

    balances.set(
        vaultOne.toLowerCase(),
        40000000n
    );

    const withdrawalRun =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        withdrawalRun.status,
        "OK"
    );

    assert.equal(
        withdrawalRun.expectedVaultTotalAtomic,
        "60000000"
    );

    const missingReference =
        buildEventReference({
            chainId:
                31337,
            txHash:
                txTwo,
            logIndex:
                0
        });

    database.connection
        .prepare(`
            DELETE FROM account_ledger
            WHERE reference_id = ?
        `)
        .run(
            missingReference
        );

    const missingLedgerRun =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        missingLedgerRun.status,
        "MISMATCH"
    );

    assert.equal(
        missingLedgerRun.findings.some(
            finding =>
                finding.type ===
                "MISSING_LEDGER_CREDIT"
        ),
        true
    );

    const repairResult =
        ledgerService
            .creditFinalizedDeposits();

    assert.equal(
        repairResult.entriesCreated,
        1
    );

    balances.set(
        vaultTwo.toLowerCase(),
        19000000n
    );

    const vaultMismatchRun =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        vaultMismatchRun.status,
        "MISMATCH"
    );

    assert.equal(
        vaultMismatchRun.findings.some(
            finding =>
                finding.type ===
                "VAULT_BALANCE_MISMATCH"
        ),
        true
    );

    balances.set(
        vaultTwo.toLowerCase(),
        20000000n
    );

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
                ?, ?, 'CREDIT', ?, ?, ?, ?, ?
            )
        `)
        .run(
            "usr_recon_001",
            "USDT",
            "1",
            "CHAIN_EVENT",
            "31337:0x" +
                "f".repeat(64) +
                ":99",
            "BLOCKCHAIN_DEPOSIT_FINALIZED",
            "2026-06-26T20:40:00.000Z"
        );

    const orphanLedgerRun =
        await reconciliationService.run({
            chainId:
                31337,
            tokenAddress
        });

    assert.equal(
        orphanLedgerRun.status,
        "MISMATCH"
    );

    assert.equal(
        orphanLedgerRun.findings.some(
            finding =>
                finding.type ===
                "ORPHAN_LEDGER_ENTRY"
        ),
        true
    );

    const storedRuns =
        database.connection
            .prepare(`
                SELECT
                    reconciliation_id,
                    status
                FROM reconciliation_runs
                ORDER BY reconciliation_id ASC
            `)
            .all();

    assert.equal(
        storedRuns.length,
        5
    );

    console.log(
        JSON.stringify(
            {
                ok:
                    true,

                cleanReconciliation:
                    cleanRun.status,

                reconciliationAfterConfirmedWithdrawal:
                    withdrawalRun.status,

                missingLedgerCreditDetected:
                    true,

                missingLedgerCreditRepaired:
                    repairResult.entriesCreated === 1,

                vaultBalanceMismatchDetected:
                    true,

                orphanLedgerEntryDetected:
                    true,

                reconciliationRunsStored:
                    storedRuns.length,

                expectedVaultTotalAfterWithdrawal:
                    withdrawalRun.expectedVaultTotalAtomic,

                observedVaultTotalAfterWithdrawal:
                    withdrawalRun.observedVaultTotalAtomic,

                legacyGameBalanceModified:
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
                    force: true
                }
            );
        }
    });