"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 2;

class BlockchainV2Database {
    constructor(databaseFile) {
        if (!databaseFile) {
            throw new Error(
                "databaseFile es obligatorio."
            );
        }

        fs.mkdirSync(
            path.dirname(databaseFile),
            { recursive: true }
        );

        this.databaseFile = databaseFile;
        this.connection = new DatabaseSync(databaseFile);

        this.connection.exec(`
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;
        `);

        this.initializeSchema();
    }

    initializeSchema() {
        this.transaction(() => {
            this.connection.exec(`
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS payment_intents (
                    intent_id TEXT PRIMARY KEY,
                    player_id TEXT NOT NULL,
                    network TEXT NOT NULL,
                    chain_id INTEGER NOT NULL,
                    token_symbol TEXT NOT NULL,
                    token_address TEXT NOT NULL,
                    vault_id TEXT NOT NULL UNIQUE,
                    vault_address TEXT NOT NULL UNIQUE,
                    expected_amount_atomic TEXT NOT NULL,
                    credited_amount_atomic TEXT NOT NULL DEFAULT '0',
                    status TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    confirmed_at TEXT,
                    rejected_at TEXT
                );

                CREATE INDEX IF NOT EXISTS
                    idx_payment_intents_player_status
                ON payment_intents (
                    player_id,
                    status
                );

                CREATE TABLE IF NOT EXISTS chain_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chain_id INTEGER NOT NULL,
                    tx_hash TEXT NOT NULL,
                    log_index INTEGER NOT NULL,
                    block_number INTEGER NOT NULL,
                    block_hash TEXT NOT NULL,
                    contract_address TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    from_address TEXT,
                    to_address TEXT,
                    amount_atomic TEXT,
                    confirmations INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    finalized_at TEXT,
                    UNIQUE (
                        chain_id,
                        tx_hash,
                        log_index
                    )
                );

                CREATE INDEX IF NOT EXISTS
                    idx_chain_events_status_block
                ON chain_events (
                    status,
                    block_number
                );

                CREATE TABLE IF NOT EXISTS account_ledger (
                    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    direction TEXT NOT NULL
                        CHECK (
                            direction IN ('CREDIT', 'DEBIT')
                        ),
                    amount_atomic TEXT NOT NULL,
                    reference_type TEXT NOT NULL,
                    reference_id TEXT NOT NULL,
                    entry_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE (
                        reference_type,
                        reference_id,
                        entry_type
                    )
                );

                CREATE TABLE IF NOT EXISTS withdrawals_v2 (
                    withdrawal_id TEXT PRIMARY KEY,
                    player_id TEXT NOT NULL,
                    network TEXT NOT NULL,
                    chain_id INTEGER NOT NULL,
                    token_symbol TEXT NOT NULL,
                    token_address TEXT NOT NULL,
                    destination_address TEXT NOT NULL,
                    amount_atomic TEXT NOT NULL,
                    nonce TEXT,
                    deadline TEXT,
                    status TEXT NOT NULL,
                    tx_hash TEXT UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    submitted_at TEXT,
                    confirmed_at TEXT,
                    rejected_at TEXT,
                    failure_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS withdrawal_sources (
                    withdrawal_id TEXT NOT NULL,
                    source_index INTEGER NOT NULL,
                    vault_address TEXT NOT NULL,
                    amount_atomic TEXT NOT NULL,

                    PRIMARY KEY (
                        withdrawal_id,
                        source_index
                    ),

                    FOREIGN KEY (
                        withdrawal_id
                    )
                    REFERENCES withdrawals_v2 (
                        withdrawal_id
                    )
                    ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS withdrawal_signatures (
                    withdrawal_id TEXT NOT NULL,
                    signer_address TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    created_at TEXT NOT NULL,

                    PRIMARY KEY (
                        withdrawal_id,
                        signer_address
                    ),

                    FOREIGN KEY (
                        withdrawal_id
                    )
                    REFERENCES withdrawals_v2 (
                        withdrawal_id
                    )
                    ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS
                    idx_withdrawal_signatures_withdrawal
                ON withdrawal_signatures (
                    withdrawal_id
                );

                CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    reconciliation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status TEXT NOT NULL,
                    expected_total_atomic TEXT NOT NULL,
                    observed_total_atomic TEXT NOT NULL,
                    difference_atomic TEXT NOT NULL,
                    details_json TEXT,
                    started_at TEXT NOT NULL,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS watcher_state (
                    chain_id INTEGER PRIMARY KEY,
                    last_scanned_block INTEGER NOT NULL,
                    last_finalized_block INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                );
            `);

            const now = new Date().toISOString();

            this.connection
                .prepare(`
                    INSERT INTO schema_meta (
                        key,
                        value,
                        updated_at
                    )
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                `)
                .run(
                    "schema_version",
                    String(SCHEMA_VERSION),
                    now
                );
        });
    }

    transaction(work) {
        if (typeof work !== "function") {
            throw new TypeError(
                "La transacciÃ³n requiere una funciÃ³n."
            );
        }

        this.connection.exec("BEGIN IMMEDIATE");

        try {
            const result = work();

            this.connection.exec("COMMIT");

            return result;
        } catch (error) {
            try {
                this.connection.exec("ROLLBACK");
            } catch {
                // No ocultar el error original.
            }

            throw error;
        }
    }

    createPaymentIntent(input) {
        const now =
            input.createdAt ||
            new Date().toISOString();

        this.connection
            .prepare(`
                INSERT INTO payment_intents (
                    intent_id,
                    player_id,
                    network,
                    chain_id,
                    token_symbol,
                    token_address,
                    vault_id,
                    vault_address,
                    expected_amount_atomic,
                    credited_amount_atomic,
                    status,
                    expires_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, '0', ?, ?, ?, ?
                )
            `)
            .run(
                input.intentId,
                input.playerId,
                input.network,
                input.chainId,
                input.tokenSymbol,
                input.tokenAddress,
                input.vaultId,
                input.vaultAddress,
                String(input.expectedAmountAtomic),
                input.status || "PENDING",
                input.expiresAt,
                now,
                now
            );

        return this.getPaymentIntent(
            input.intentId
        );
    }

    getPaymentIntent(intentId) {
        return this.connection
            .prepare(`
                SELECT *
                FROM payment_intents
                WHERE intent_id = ?
            `)
            .get(intentId);
    }

    recordChainEvent(input) {
        const result = this.connection
            .prepare(`
                INSERT OR IGNORE INTO chain_events (
                    chain_id,
                    tx_hash,
                    log_index,
                    block_number,
                    block_hash,
                    contract_address,
                    event_name,
                    from_address,
                    to_address,
                    amount_atomic,
                    confirmations,
                    status,
                    observed_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
            `)
            .run(
                input.chainId,
                input.txHash,
                input.logIndex,
                input.blockNumber,
                input.blockHash,
                input.contractAddress,
                input.eventName,
                input.fromAddress || null,
                input.toAddress || null,
                input.amountAtomic === undefined
                    ? null
                    : String(input.amountAtomic),
                input.confirmations || 0,
                input.status || "OBSERVED",
                input.observedAt ||
                    new Date().toISOString()
            );

        return Number(result.changes) === 1;
    }

    getSchemaVersion() {
        const row = this.connection
            .prepare(`
                SELECT value
                FROM schema_meta
                WHERE key = 'schema_version'
            `)
            .get();

        return row
            ? Number(row.value)
            : 0;
    }

    listTables() {
        return this.connection
            .prepare(`
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            `)
            .all()
            .map((row) => row.name);
    }

    close() {
        this.connection.close();
    }
}

module.exports = {
    BlockchainV2Database,
    SCHEMA_VERSION
};