"use strict";

const {
    Interface,
    JsonRpcProvider,
    getAddress,
    id,
    isAddress,
    zeroPadValue
} = require("ethers");

const TRANSFER_TOPIC =
    id("Transfer(address,address,uint256)");

const TRANSFER_INTERFACE =
    new Interface([
        "event Transfer(address indexed from,address indexed to,uint256 value)"
    ]);

class Erc20DepositWatcher {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        this.database = options.database;

        this.rpcUrl =
            String(options.rpcUrl || "").trim();

        this.chainId =
            Number(options.chainId);

        this.tokenAddress =
            normalizeAddress(
                options.tokenAddress,
                "tokenAddress"
            );

        this.requiredConfirmations =
            Number(
                options.requiredConfirmations ||
                12
            );

        this.startBlock =
            Number(options.startBlock || 0);

        this.maxBlockRange =
            Number(
                options.maxBlockRange ||
                1000
            );

        this.addressChunkSize =
            Number(
                options.addressChunkSize ||
                100
            );

        if (!this.rpcUrl) {
            throw new Error(
                "rpcUrl es obligatorio."
            );
        }

        if (
            !Number.isSafeInteger(this.chainId) ||
            this.chainId <= 0
        ) {
            throw new Error(
                "chainId invÃ¡lido."
            );
        }

        if (
            !Number.isSafeInteger(
                this.requiredConfirmations
            ) ||
            this.requiredConfirmations <= 0
        ) {
            throw new Error(
                "requiredConfirmations invÃ¡lido."
            );
        }

        this.provider =
            new JsonRpcProvider(
                this.rpcUrl
            );

        this.initialized = false;
    }

    async initialize() {
        const network =
            await this.provider.getNetwork();

        if (
            Number(network.chainId) !==
            this.chainId
        ) {
            throw new Error(
                `Chain ID incorrecto. Esperado: ${this.chainId}, recibido: ${network.chainId}.`
            );
        }

        const tokenCode =
            await this.provider.getCode(
                this.tokenAddress
            );

        if (tokenCode === "0x") {
            throw new Error(
                "El token configurado no tiene bytecode."
            );
        }

        this.initialized = true;

        return {
            chainId:
                this.chainId,
            tokenAddress:
                this.tokenAddress,
            requiredConfirmations:
                this.requiredConfirmations
        };
    }

    getWatcherState() {
        return this.database.connection
            .prepare(`
                SELECT *
                FROM watcher_state
                WHERE chain_id = ?
            `)
            .get(this.chainId);
    }

    saveWatcherState({
        lastScannedBlock,
        lastFinalizedBlock
    }) {
        this.database.connection
            .prepare(`
                INSERT INTO watcher_state (
                    chain_id,
                    last_scanned_block,
                    last_finalized_block,
                    updated_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(chain_id)
                DO UPDATE SET
                    last_scanned_block =
                        excluded.last_scanned_block,
                    last_finalized_block =
                        excluded.last_finalized_block,
                    updated_at =
                        excluded.updated_at
            `)
            .run(
                this.chainId,
                lastScannedBlock,
                lastFinalizedBlock,
                new Date().toISOString()
            );
    }

    getWatchedVaultAddresses() {
        return this.database.connection
            .prepare(`
                SELECT DISTINCT vault_address
                FROM payment_intents
                WHERE chain_id = ?
                  AND LOWER(token_address) =
                      LOWER(?)
            `)
            .all(
                this.chainId,
                this.tokenAddress
            )
            .map((row) =>
                getAddress(
                    row.vault_address
                )
            );
    }

    getIntentByVaultAddress(
        vaultAddress
    ) {
        return this.database.connection
            .prepare(`
                SELECT *
                FROM payment_intents
                WHERE chain_id = ?
                  AND LOWER(token_address) =
                      LOWER(?)
                  AND LOWER(vault_address) =
                      LOWER(?)
                LIMIT 1
            `)
            .get(
                this.chainId,
                this.tokenAddress,
                vaultAddress
            );
    }

    async scanOnce() {
        if (!this.initialized) {
            throw new Error(
                "El watcher no estÃ¡ inicializado."
            );
        }

        // Consultar directamente el RPC para evitar reutilizar
        // temporalmente un número de bloque almacenado en caché.
        const latestBlockHex =
            await this.provider.send(
                "eth_blockNumber",
                []
            );

        const latestBlock =
            Number(
                BigInt(latestBlockHex)
            );

        const watchedAddresses =
            this.getWatchedVaultAddresses();

        const state =
            this.getWatcherState();

        let fromBlock =
            state
                ? Number(
                    state.last_scanned_block
                ) + 1
                : this.startBlock;

        if (fromBlock < 0) {
            fromBlock = 0;
        }

        let eventsSeen = 0;
        let newlyRecorded = 0;

        if (
            watchedAddresses.length > 0 &&
            fromBlock <= latestBlock
        ) {
            for (
                let rangeStart = fromBlock;
                rangeStart <= latestBlock;
                rangeStart += this.maxBlockRange
            ) {
                const rangeEnd =
                    Math.min(
                        rangeStart +
                        this.maxBlockRange -
                        1,
                        latestBlock
                    );

                for (
                    let offset = 0;
                    offset < watchedAddresses.length;
                    offset += this.addressChunkSize
                ) {
                    const addressChunk =
                        watchedAddresses.slice(
                            offset,
                            offset +
                            this.addressChunkSize
                        );

                    const toTopics =
                        addressChunk.map(
                            address =>
                                zeroPadValue(
                                    address,
                                    32
                                )
                        );

                    const logs =
                        await this.provider
                            .getLogs({
                                address:
                                    this.tokenAddress,

                                fromBlock:
                                    rangeStart,

                                toBlock:
                                    rangeEnd,

                                topics: [
                                    TRANSFER_TOPIC,
                                    null,
                                    toTopics
                                ]
                            });

                    for (const log of logs) {
                        eventsSeen++;

                        const inserted =
                            this.recordTransferLog(
                                log,
                                latestBlock
                            );

                        if (inserted) {
                            newlyRecorded++;
                        }
                    }
                }
            }
        }

        const orphanedEvents =
            await this.validateObservedEvents();

        const finalizedEvents =
            this.updateConfirmations(
                latestBlock
            );

        this.refreshAllPaymentIntents();

        const lastFinalizedBlock =
            Math.max(
                0,
                latestBlock -
                this.requiredConfirmations +
                1
            );

        this.saveWatcherState({
            lastScannedBlock:
                latestBlock,

            lastFinalizedBlock
        });

        return {
            latestBlock,
            fromBlock,
            watchedAddressCount:
                watchedAddresses.length,
            eventsSeen,
            newlyRecorded,
            finalizedEvents,
            orphanedEvents
        };
    }

    recordTransferLog(
        log,
        latestBlock
    ) {
        const parsed =
            TRANSFER_INTERFACE
                .parseLog(log);

        if (!parsed) {
            return false;
        }

        const fromAddress =
            getAddress(
                parsed.args.from
            );

        const toAddress =
            getAddress(
                parsed.args.to
            );

        const intent =
            this.getIntentByVaultAddress(
                toAddress
            );

        if (!intent) {
            return false;
        }

        const confirmations =
            Math.max(
                0,
                latestBlock -
                Number(log.blockNumber) +
                1
            );

        const status =
            confirmations >=
            this.requiredConfirmations
                ? "FINALIZED"
                : "OBSERVED";

        const now =
            new Date().toISOString();

        const result =
            this.database.connection
                .prepare(`
                    INSERT INTO chain_events (
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
                        observed_at,
                        finalized_at
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?
                    )
                    ON CONFLICT(
                        chain_id,
                        tx_hash,
                        log_index
                    )
                    DO UPDATE SET
                        confirmations =
                            excluded.confirmations,
                        status =
                            excluded.status,
                        finalized_at =
                            excluded.finalized_at
                `)
                .run(
                    this.chainId,
                    log.transactionHash,
                    Number(log.index),
                    Number(log.blockNumber),
                    log.blockHash,
                    this.tokenAddress,
                    "Transfer",
                    fromAddress,
                    toAddress,
                    parsed.args.value.toString(),
                    confirmations,
                    status,
                    now,
                    status === "FINALIZED"
                        ? now
                        : null
                );

        return Number(result.changes) === 1;
    }

    async validateObservedEvents() {
        const rows =
            this.database.connection
                .prepare(`
                    SELECT
                        event_id,
                        block_number,
                        block_hash,
                        to_address
                    FROM chain_events
                    WHERE chain_id = ?
                      AND status = 'OBSERVED'
                `)
                .all(this.chainId);

        let orphaned = 0;

        for (const row of rows) {
            const block =
                await this.provider.getBlock(
                    Number(row.block_number)
                );

            if (
                !block ||
                String(block.hash).toLowerCase() !==
                String(row.block_hash).toLowerCase()
            ) {
                this.database.connection
                    .prepare(`
                        UPDATE chain_events
                        SET
                            status = 'ORPHANED',
                            confirmations = 0,
                            finalized_at = NULL
                        WHERE event_id = ?
                    `)
                    .run(row.event_id);

                orphaned++;
            }
        }

        return orphaned;
    }

    updateConfirmations(latestBlock) {
        const rows =
            this.database.connection
                .prepare(`
                    SELECT
                        event_id,
                        block_number
                    FROM chain_events
                    WHERE chain_id = ?
                      AND status = 'OBSERVED'
                `)
                .all(this.chainId);

        let finalized = 0;

        for (const row of rows) {
            const confirmations =
                Math.max(
                    0,
                    latestBlock -
                    Number(row.block_number) +
                    1
                );

            const shouldFinalize =
                confirmations >=
                this.requiredConfirmations;

            this.database.connection
                .prepare(`
                    UPDATE chain_events
                    SET
                        confirmations = ?,
                        status = ?,
                        finalized_at = ?
                    WHERE event_id = ?
                `)
                .run(
                    confirmations,
                    shouldFinalize
                        ? "FINALIZED"
                        : "OBSERVED",
                    shouldFinalize
                        ? new Date().toISOString()
                        : null,
                    row.event_id
                );

            if (shouldFinalize) {
                finalized++;
            }
        }

        return finalized;
    }

    refreshAllPaymentIntents() {
        const intents =
            this.database.connection
                .prepare(`
                    SELECT *
                    FROM payment_intents
                    WHERE chain_id = ?
                      AND LOWER(token_address) =
                          LOWER(?)
                `)
                .all(
                    this.chainId,
                    this.tokenAddress
                );

        for (const intent of intents) {
            this.refreshPaymentIntent(
                intent
            );
        }
    }

    refreshPaymentIntent(intent) {
        const events =
            this.database.connection
                .prepare(`
                    SELECT
                        amount_atomic,
                        status
                    FROM chain_events
                    WHERE chain_id = ?
                      AND LOWER(contract_address) =
                          LOWER(?)
                      AND LOWER(to_address) =
                          LOWER(?)
                      AND status != 'ORPHANED'
                `)
                .all(
                    this.chainId,
                    this.tokenAddress,
                    intent.vault_address
                );

        let observedTotal = 0n;
        let finalizedTotal = 0n;

        for (const event of events) {
            const amount =
                BigInt(
                    event.amount_atomic ||
                    "0"
                );

            observedTotal += amount;

            if (
                event.status ===
                "FINALIZED"
            ) {
                finalizedTotal += amount;
            }
        }

        const expected =
            BigInt(
                intent.expected_amount_atomic
            );

        let status = "PENDING";

        if (finalizedTotal > 0n) {
            if (finalizedTotal < expected) {
                status = "PARTIALLY_PAID";
            } else if (
                finalizedTotal === expected
            ) {
                status = "PAID";
            } else {
                status = "OVERPAID";
            }
        } else if (observedTotal > 0n) {
            status = "PAYMENT_DETECTED";
        }

        this.database.connection
            .prepare(`
                UPDATE payment_intents
                SET
                    credited_amount_atomic = ?,
                    status = ?,
                    updated_at = ?,
                    confirmed_at =
                        CASE
                            WHEN ? IN (
                                'PAID',
                                'OVERPAID'
                            )
                            THEN COALESCE(
                                confirmed_at,
                                ?
                            )
                            ELSE confirmed_at
                        END
                WHERE intent_id = ?
            `)
            .run(
                finalizedTotal.toString(),
                status,
                new Date().toISOString(),
                status,
                new Date().toISOString(),
                intent.intent_id
            );
    }

    async close() {
        if (
            typeof this.provider.destroy ===
            "function"
        ) {
            await this.provider.destroy();
        }
    }
}

function normalizeAddress(
    value,
    fieldName
) {
    const address =
        String(value || "").trim();

    if (!isAddress(address)) {
        throw new Error(
            `${fieldName} invÃ¡lido.`
        );
    }

    return getAddress(address);
}

module.exports = {
    Erc20DepositWatcher,
    TRANSFER_TOPIC
};