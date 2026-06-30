"use strict";

const {
    getAddress,
    isAddress
} = require("ethers");

const DEPOSIT_ENTRY_TYPE =
    "BLOCKCHAIN_DEPOSIT_FINALIZED";

const CHAIN_EVENT_REFERENCE =
    "CHAIN_EVENT";

class ReconciliationService {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        if (
            typeof options.getVaultBalanceAtomic !==
            "function"
        ) {
            throw new Error(
                "getVaultBalanceAtomic es obligatorio."
            );
        }

        this.database =
            options.database;

        this.getVaultBalanceAtomic =
            options.getVaultBalanceAtomic;

        this.clock =
            typeof options.clock === "function"
                ? options.clock
                : () => new Date();
    }

    async run(input = {}) {
        const chainId =
            Number(input.chainId);

        const tokenAddress =
            normalizeAddress(
                input.tokenAddress,
                "tokenAddress"
            );

        if (
            !Number.isSafeInteger(chainId) ||
            chainId <= 0
        ) {
            throw new Error(
                "chainId inválido."
            );
        }

        const startedAt =
            this.clock().toISOString();

        const findings = [];

        const intents =
            this.database.connection
                .prepare(`
                    SELECT
                        intent_id,
                        player_id,
                        token_symbol,
                        vault_address
                    FROM payment_intents
                    WHERE chain_id = ?
                      AND LOWER(token_address) =
                          LOWER(?)
                    ORDER BY created_at ASC
                `)
                .all(
                    chainId,
                    tokenAddress
                );

        const intentByVault =
            new Map();

        const depositsByVault =
            new Map();

        for (const intent of intents) {
            const key =
                String(
                    intent.vault_address
                ).toLowerCase();

            intentByVault.set(
                key,
                intent
            );

            depositsByVault.set(
                key,
                0n
            );
        }

        const events =
            this.database.connection
                .prepare(`
                    SELECT
                        ce.event_id,
                        ce.tx_hash,
                        ce.log_index,
                        ce.amount_atomic,
                        ce.to_address,
                        pi.intent_id,
                        pi.player_id,
                        pi.token_symbol
                    FROM chain_events ce

                    LEFT JOIN payment_intents pi
                        ON pi.chain_id =
                            ce.chain_id

                       AND LOWER(
                            pi.token_address
                       ) =
                           LOWER(
                            ce.contract_address
                       )

                       AND LOWER(
                            pi.vault_address
                       ) =
                           LOWER(
                            ce.to_address
                       )

                    WHERE ce.chain_id = ?
                      AND LOWER(
                            ce.contract_address
                          ) = LOWER(?)
                      AND ce.event_name =
                          'Transfer'
                      AND ce.status =
                          'FINALIZED'

                    ORDER BY
                        ce.block_number ASC,
                        ce.log_index ASC
                `)
                .all(
                    chainId,
                    tokenAddress
                );

        const expectedLedgerEntries =
            new Map();

        let finalizedDepositTotal = 0n;

        for (const event of events) {
            if (!event.intent_id) {
                findings.push({
                    type:
                        "UNASSIGNED_FINALIZED_EVENT",

                    eventId:
                        Number(event.event_id),

                    txHash:
                        event.tx_hash,

                    logIndex:
                        Number(event.log_index)
                });

                continue;
            }

            let amount;

            try {
                amount =
                    BigInt(
                        event.amount_atomic
                    );
            } catch {
                findings.push({
                    type:
                        "INVALID_EVENT_AMOUNT",

                    eventId:
                        Number(event.event_id),

                    amountAtomic:
                        event.amount_atomic
                });

                continue;
            }

            if (amount <= 0n) {
                findings.push({
                    type:
                        "INVALID_EVENT_AMOUNT",

                    eventId:
                        Number(event.event_id),

                    amountAtomic:
                        amount.toString()
                });

                continue;
            }

            const referenceId =
                buildEventReference({
                    chainId,
                    txHash:
                        event.tx_hash,
                    logIndex:
                        event.log_index
                });

            expectedLedgerEntries.set(
                referenceId,
                {
                    amountAtomic:
                        amount,

                    playerId:
                        event.player_id,

                    asset:
                        String(
                            event.token_symbol
                        ).toUpperCase(),

                    eventId:
                        Number(event.event_id)
                }
            );

            const vaultKey =
                String(
                    event.to_address
                ).toLowerCase();

            depositsByVault.set(
                vaultKey,
                (
                    depositsByVault.get(
                        vaultKey
                    ) || 0n
                ) + amount
            );

            finalizedDepositTotal +=
                amount;
        }

        const ledgerRows =
            this.database.connection
                .prepare(`
                    SELECT
                        ledger_id,
                        player_id,
                        asset,
                        direction,
                        amount_atomic,
                        reference_id
                    FROM account_ledger
                    WHERE reference_type = ?
                      AND entry_type = ?
                      AND reference_id LIKE ?
                    ORDER BY ledger_id ASC
                `)
                .all(
                    CHAIN_EVENT_REFERENCE,
                    DEPOSIT_ENTRY_TYPE,
                    `${chainId}:%`
                );

        const ledgerByReference =
            new Map();

        let ledgerDepositCreditTotal = 0n;

        for (const row of ledgerRows) {
            const referenceId =
                String(
                    row.reference_id
                ).toLowerCase();

            ledgerByReference.set(
                referenceId,
                row
            );

            let amount;

            try {
                amount =
                    BigInt(
                        row.amount_atomic
                    );
            } catch {
                findings.push({
                    type:
                        "INVALID_LEDGER_AMOUNT",

                    ledgerId:
                        Number(row.ledger_id)
                });

                continue;
            }

            if (
                row.direction ===
                "CREDIT"
            ) {
                ledgerDepositCreditTotal +=
                    amount;
            } else {
                ledgerDepositCreditTotal -=
                    amount;
            }
        }

        for (
            const [
                referenceId,
                expected
            ] of expectedLedgerEntries
        ) {
            const ledger =
                ledgerByReference.get(
                    referenceId
                );

            if (!ledger) {
                findings.push({
                    type:
                        "MISSING_LEDGER_CREDIT",

                    referenceId,

                    eventId:
                        expected.eventId,

                    expectedAmountAtomic:
                        expected.amountAtomic
                            .toString()
                });

                continue;
            }

            const actualAmount =
                BigInt(
                    ledger.amount_atomic
                );

            if (
                ledger.direction !==
                "CREDIT"
            ) {
                findings.push({
                    type:
                        "INVALID_LEDGER_DIRECTION",

                    referenceId,

                    direction:
                        ledger.direction
                });
            }

            if (
                actualAmount !==
                expected.amountAtomic
            ) {
                findings.push({
                    type:
                        "LEDGER_AMOUNT_MISMATCH",

                    referenceId,

                    expectedAmountAtomic:
                        expected.amountAtomic
                            .toString(),

                    actualAmountAtomic:
                        actualAmount.toString()
                });
            }

            if (
                String(
                    ledger.player_id
                ) !==
                String(
                    expected.playerId
                )
            ) {
                findings.push({
                    type:
                        "LEDGER_PLAYER_MISMATCH",

                    referenceId,

                    expectedPlayerId:
                        expected.playerId,

                    actualPlayerId:
                        ledger.player_id
                });
            }

            if (
                String(
                    ledger.asset
                ).toUpperCase() !==
                expected.asset
            ) {
                findings.push({
                    type:
                        "LEDGER_ASSET_MISMATCH",

                    referenceId,

                    expectedAsset:
                        expected.asset,

                    actualAsset:
                        ledger.asset
                });
            }
        }

        for (const ledger of ledgerRows) {
            const referenceId =
                String(
                    ledger.reference_id
                ).toLowerCase();

            if (
                !expectedLedgerEntries.has(
                    referenceId
                )
            ) {
                findings.push({
                    type:
                        "ORPHAN_LEDGER_ENTRY",

                    ledgerId:
                        Number(
                            ledger.ledger_id
                        ),

                    referenceId
                });
            }
        }

        const withdrawalRows =
            this.database.connection
                .prepare(`
                    SELECT
                        ws.withdrawal_id,
                        ws.vault_address,
                        ws.amount_atomic
                    FROM withdrawal_sources ws

                    INNER JOIN withdrawals_v2 w
                        ON w.withdrawal_id =
                            ws.withdrawal_id

                    WHERE w.chain_id = ?
                      AND LOWER(
                            w.token_address
                          ) = LOWER(?)
                      AND w.status =
                          'CONFIRMED'

                    ORDER BY
                        ws.withdrawal_id,
                        ws.source_index
                `)
                .all(
                    chainId,
                    tokenAddress
                );

        const withdrawalsByVault =
            new Map();

        let confirmedWithdrawalTotal = 0n;

        for (const withdrawal of withdrawalRows) {
            let amount;

            try {
                amount =
                    BigInt(
                        withdrawal.amount_atomic
                    );
            } catch {
                findings.push({
                    type:
                        "INVALID_WITHDRAWAL_SOURCE_AMOUNT",

                    withdrawalId:
                        withdrawal.withdrawal_id
                });

                continue;
            }

            const vaultKey =
                String(
                    withdrawal.vault_address
                ).toLowerCase();

            withdrawalsByVault.set(
                vaultKey,
                (
                    withdrawalsByVault.get(
                        vaultKey
                    ) || 0n
                ) + amount
            );

            confirmedWithdrawalTotal +=
                amount;
        }

        const vaults = [];

        let expectedVaultTotal = 0n;
        let observedVaultTotal = 0n;

        for (const intent of intents) {
            const vaultAddress =
                getAddress(
                    intent.vault_address
                );

            const vaultKey =
                vaultAddress.toLowerCase();

            const deposits =
                depositsByVault.get(
                    vaultKey
                ) || 0n;

            const withdrawals =
                withdrawalsByVault.get(
                    vaultKey
                ) || 0n;

            const expectedBalance =
                deposits - withdrawals;

            if (expectedBalance < 0n) {
                findings.push({
                    type:
                        "NEGATIVE_EXPECTED_VAULT_BALANCE",

                    vaultAddress,

                    depositsAtomic:
                        deposits.toString(),

                    withdrawalsAtomic:
                        withdrawals.toString()
                });
            }

            let observedBalance = null;
            let difference = null;

            try {
                observedBalance =
                    BigInt(
                        await this
                            .getVaultBalanceAtomic(
                                vaultAddress
                            )
                    );

                difference =
                    observedBalance -
                    expectedBalance;

                observedVaultTotal +=
                    observedBalance;

                if (difference !== 0n) {
                    findings.push({
                        type:
                            "VAULT_BALANCE_MISMATCH",

                        vaultAddress,

                        expectedBalanceAtomic:
                            expectedBalance
                                .toString(),

                        observedBalanceAtomic:
                            observedBalance
                                .toString(),

                        differenceAtomic:
                            difference
                                .toString()
                    });
                }
            } catch (error) {
                findings.push({
                    type:
                        "VAULT_BALANCE_READ_FAILED",

                    vaultAddress,

                    error:
                        error.message
                });
            }

            expectedVaultTotal +=
                expectedBalance;

            vaults.push({
                intentId:
                    intent.intent_id,

                playerId:
                    intent.player_id,

                vaultAddress,

                finalizedDepositsAtomic:
                    deposits.toString(),

                confirmedWithdrawalsAtomic:
                    withdrawals.toString(),

                expectedBalanceAtomic:
                    expectedBalance.toString(),

                observedBalanceAtomic:
                    observedBalance === null
                        ? null
                        : observedBalance
                            .toString(),

                differenceAtomic:
                    difference === null
                        ? null
                        : difference
                            .toString()
            });
        }

        const completedAt =
            this.clock().toISOString();

        const status =
            findings.length === 0
                ? "OK"
                : "MISMATCH";

        const result = {
            status,

            chainId,

            tokenAddress,

            finalizedEventCount:
                events.length,

            ledgerEntryCount:
                ledgerRows.length,

            finalizedDepositTotalAtomic:
                finalizedDepositTotal
                    .toString(),

            ledgerDepositCreditTotalAtomic:
                ledgerDepositCreditTotal
                    .toString(),

            confirmedWithdrawalTotalAtomic:
                confirmedWithdrawalTotal
                    .toString(),

            expectedVaultTotalAtomic:
                expectedVaultTotal
                    .toString(),

            observedVaultTotalAtomic:
                observedVaultTotal
                    .toString(),

            vaultDifferenceAtomic:
                (
                    observedVaultTotal -
                    expectedVaultTotal
                ).toString(),

            findings,

            vaults,

            startedAt,

            completedAt
        };

        const insert =
            this.database.connection
                .prepare(`
                    INSERT INTO reconciliation_runs (
                        status,
                        expected_total_atomic,
                        observed_total_atomic,
                        difference_atomic,
                        details_json,
                        started_at,
                        completed_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `)
                .run(
                    status,
                    result.expectedVaultTotalAtomic,
                    result.observedVaultTotalAtomic,
                    result.vaultDifferenceAtomic,
                    JSON.stringify(result),
                    startedAt,
                    completedAt
                );

        return {
            reconciliationId:
                Number(
                    insert.lastInsertRowid
                ),

            ...result
        };
    }
}

function buildEventReference({
    chainId,
    txHash,
    logIndex
}) {
    return [
        String(chainId),
        String(txHash)
            .trim()
            .toLowerCase(),
        String(logIndex)
    ].join(":");
}

function normalizeAddress(
    value,
    fieldName
) {
    const address =
        String(value || "").trim();

    if (!isAddress(address)) {
        throw new Error(
            `${fieldName} inválido.`
        );
    }

    return getAddress(address);
}

module.exports = {
    ReconciliationService,
    buildEventReference
};