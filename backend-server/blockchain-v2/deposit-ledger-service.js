"use strict";

const ENTRY_TYPE =
    "BLOCKCHAIN_DEPOSIT_FINALIZED";

const REFERENCE_TYPE =
    "CHAIN_EVENT";

class DepositLedgerService {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        this.database =
            options.database;

        this.clock =
            typeof options.clock === "function"
                ? options.clock
                : () => new Date();
    }

    creditFinalizedDeposits() {
        return this.database.transaction(
            () => {
                const events =
                    this.database.connection
                        .prepare(`
                            SELECT
                                ce.event_id,
                                ce.chain_id,
                                ce.tx_hash,
                                ce.log_index,
                                ce.block_number,
                                ce.amount_atomic,
                                ce.to_address,
                                pi.intent_id,
                                pi.player_id,
                                pi.token_symbol
                            FROM chain_events ce

                            INNER JOIN payment_intents pi
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

                            WHERE ce.status =
                                'FINALIZED'

                              AND ce.event_name =
                                'Transfer'

                            ORDER BY
                                ce.block_number ASC,
                                ce.log_index ASC,
                                ce.event_id ASC
                        `)
                        .all();

                const insertLedger =
                    this.database.connection
                        .prepare(`
                            INSERT OR IGNORE INTO account_ledger (
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
                        `);

                const now =
                    this.clock()
                        .toISOString();

                let entriesCreated = 0;
                let entriesSkipped = 0;
                let invalidEvents = 0;
                let creditedAtomic = 0n;

                const createdReferences = [];

                for (const event of events) {
                    let amount;

                    try {
                        amount =
                            BigInt(
                                event.amount_atomic
                            );
                    } catch {
                        invalidEvents++;
                        continue;
                    }

                    if (amount <= 0n) {
                        invalidEvents++;
                        continue;
                    }

                    const referenceId =
                        this.buildReferenceId(
                            event
                        );

                    const result =
                        insertLedger.run(
                            event.player_id,
                            String(
                                event.token_symbol
                            ).toUpperCase(),
                            amount.toString(),
                            REFERENCE_TYPE,
                            referenceId,
                            ENTRY_TYPE,
                            now
                        );

                    if (
                        Number(result.changes) ===
                        1
                    ) {
                        entriesCreated++;
                        creditedAtomic += amount;

                        createdReferences.push({
                            intentId:
                                event.intent_id,

                            playerId:
                                event.player_id,

                            referenceId,

                            amountAtomic:
                                amount.toString()
                        });
                    } else {
                        entriesSkipped++;
                    }
                }

                return {
                    finalizedEventsMatched:
                        events.length,

                    entriesCreated,

                    entriesSkipped,

                    invalidEvents,

                    creditedAtomic:
                        creditedAtomic.toString(),

                    createdReferences
                };
            }
        );
    }

    buildReferenceId(event) {
        const chainId =
            String(event.chain_id);

        const txHash =
            String(event.tx_hash)
                .trim()
                .toLowerCase();

        const logIndex =
            String(event.log_index);

        return [
            chainId,
            txHash,
            logIndex
        ].join(":");
    }

    getPlayerBalanceAtomic(
        playerId,
        asset
    ) {
        const normalizedPlayerId =
            String(playerId || "").trim();

        const normalizedAsset =
            String(asset || "")
                .trim()
                .toUpperCase();

        if (!normalizedPlayerId) {
            throw new Error(
                "playerId es obligatorio."
            );
        }

        if (!normalizedAsset) {
            throw new Error(
                "asset es obligatorio."
            );
        }

        const rows =
            this.database.connection
                .prepare(`
                    SELECT
                        direction,
                        amount_atomic
                    FROM account_ledger
                    WHERE player_id = ?
                      AND UPPER(asset) = ?
                    ORDER BY ledger_id ASC
                `)
                .all(
                    normalizedPlayerId,
                    normalizedAsset
                );

        let balance = 0n;

        for (const row of rows) {
            const amount =
                BigInt(
                    row.amount_atomic
                );

            if (
                row.direction ===
                "CREDIT"
            ) {
                balance += amount;
            } else if (
                row.direction ===
                "DEBIT"
            ) {
                balance -= amount;
            } else {
                throw new Error(
                    `Dirección contable inválida: ${row.direction}`
                );
            }
        }

        return balance;
    }

    listPlayerEntries(
        playerId,
        asset
    ) {
        return this.database.connection
            .prepare(`
                SELECT
                    ledger_id,
                    player_id,
                    asset,
                    direction,
                    amount_atomic,
                    reference_type,
                    reference_id,
                    entry_type,
                    created_at
                FROM account_ledger
                WHERE player_id = ?
                  AND UPPER(asset) = ?
                ORDER BY ledger_id ASC
            `)
            .all(
                String(playerId || "").trim(),
                String(asset || "")
                    .trim()
                    .toUpperCase()
            );
    }

    getLedgerSummary() {
        const rows =
            this.database.connection
                .prepare(`
                    SELECT
                        player_id,
                        asset,
                        direction,
                        amount_atomic
                    FROM account_ledger
                    ORDER BY ledger_id ASC
                `)
                .all();

        const balances =
            new Map();

        for (const row of rows) {
            const key =
                `${row.player_id}:${row.asset}`;

            const current =
                balances.get(key) ||
                0n;

            const amount =
                BigInt(
                    row.amount_atomic
                );

            balances.set(
                key,
                row.direction === "CREDIT"
                    ? current + amount
                    : current - amount
            );
        }

        return Array.from(
            balances.entries()
        ).map(
            ([key, balanceAtomic]) => {
                const separator =
                    key.lastIndexOf(":");

                return {
                    playerId:
                        key.slice(
                            0,
                            separator
                        ),

                    asset:
                        key.slice(
                            separator + 1
                        ),

                    balanceAtomic:
                        balanceAtomic
                            .toString()
                };
            }
        );
    }
}

module.exports = {
    DepositLedgerService,
    ENTRY_TYPE,
    REFERENCE_TYPE
};