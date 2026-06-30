"use strict";

const crypto = require("node:crypto");

const {
    getAddress,
    isAddress,
    parseUnits
} = require("ethers");

const RESERVATION_ENTRY_TYPE =
    "WITHDRAWAL_RESERVED";

const RELEASE_ENTRY_TYPE =
    "WITHDRAWAL_RESERVATION_RELEASED";

const WITHDRAWAL_REFERENCE_TYPE =
    "WITHDRAWAL";

const ACTIVE_WITHDRAWAL_STATUSES =
    Object.freeze([
        "RESERVED",
        "AWAITING_SIGNATURES",
        "SIGNED",
        "SUBMITTED",
        "CONFIRMED"
    ]);

class WithdrawalReservationService {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        this.database =
            options.database;

        this.network =
            String(
                options.network ||
                "bsc-testnet"
            )
                .trim()
                .toLowerCase();

        this.chainId =
            Number(
                options.chainId ||
                97
            );

        this.tokenSymbol =
            String(
                options.tokenSymbol ||
                "USDT"
            )
                .trim()
                .toUpperCase();

        this.tokenAddress =
            normalizeAddress(
                options.tokenAddress,
                "tokenAddress"
            );

        this.tokenDecimals =
            Number(
                options.tokenDecimals ??
                6
            );

        this.clock =
            typeof options.clock === "function"
                ? options.clock
                : () => new Date();

        this.randomUUID =
            typeof options.randomUUID === "function"
                ? options.randomUUID
                : () => crypto.randomUUID();

        if (
            !Number.isSafeInteger(
                this.chainId
            ) ||
            this.chainId <= 0
        ) {
            throw new Error(
                "chainId inválido."
            );
        }

        if (
            !Number.isSafeInteger(
                this.tokenDecimals
            ) ||
            this.tokenDecimals < 0 ||
            this.tokenDecimals > 18
        ) {
            throw new Error(
                "tokenDecimals inválido."
            );
        }
    }

    reserveWithdrawal(input = {}) {
        const playerId =
            normalizePlayerId(
                input.playerId
            );

        const destinationAddress =
            normalizeAddress(
                input.destinationAddress,
                "destinationAddress"
            );

        const amountAtomic =
            this.parseAmount(
                input.amount
            );

        return this.database.transaction(
            () => {
                const availableBalance =
                    this.getPlayerBalanceAtomic(
                        playerId
                    );

                if (
                    amountAtomic >
                    availableBalance
                ) {
                    throw new Error(
                        `Balance V2 insuficiente. Disponible: ${availableBalance}, requerido: ${amountAtomic}.`
                    );
                }

                const vaults =
                    this.listVaultAvailability(
                        playerId
                    );

                const totalVaultAvailability =
                    vaults.reduce(
                        (
                            total,
                            vault
                        ) =>
                            total +
                            vault.availableAtomic,
                        0n
                    );

                if (
                    amountAtomic >
                    totalVaultAvailability
                ) {
                    throw new Error(
                        `Fondos disponibles en bóvedas insuficientes. Disponible: ${totalVaultAvailability}, requerido: ${amountAtomic}.`
                    );
                }

                const sources =
                    this.selectSources(
                        vaults,
                        amountAtomic
                    );

                const selectedTotal =
                    sources.reduce(
                        (
                            total,
                            source
                        ) =>
                            total +
                            source.amountAtomic,
                        0n
                    );

                if (
                    selectedTotal !==
                    amountAtomic
                ) {
                    throw new Error(
                        "La selección de bóvedas no cubre exactamente el retiro."
                    );
                }

                const withdrawalId =
                    this.generateWithdrawalId();

                const now =
                    this.clock()
                        .toISOString();

                this.database.connection
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
                            nonce,
                            deadline,
                            status,
                            tx_hash,
                            created_at,
                            updated_at,
                            submitted_at,
                            confirmed_at,
                            rejected_at,
                            failure_reason
                        )
                        VALUES (
                            ?, ?, ?, ?, ?, ?, ?, ?,
                            NULL, NULL, 'RESERVED', NULL,
                            ?, ?, NULL, NULL, NULL, NULL
                        )
                    `)
                    .run(
                        withdrawalId,
                        playerId,
                        this.network,
                        this.chainId,
                        this.tokenSymbol,
                        this.tokenAddress,
                        destinationAddress,
                        amountAtomic.toString(),
                        now,
                        now
                    );

                const insertSource =
                    this.database.connection
                        .prepare(`
                            INSERT INTO withdrawal_sources (
                                withdrawal_id,
                                source_index,
                                vault_address,
                                amount_atomic
                            )
                            VALUES (?, ?, ?, ?)
                        `);

                sources.forEach(
                    (
                        source,
                        index
                    ) => {
                        insertSource.run(
                            withdrawalId,
                            index,
                            source.vaultAddress,
                            source.amountAtomic
                                .toString()
                        );
                    }
                );

                const ledgerResult =
                    this.database.connection
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
                            playerId,
                            this.tokenSymbol,
                            amountAtomic.toString(),
                            WITHDRAWAL_REFERENCE_TYPE,
                            withdrawalId,
                            RESERVATION_ENTRY_TYPE,
                            now
                        );

                if (
                    Number(
                        ledgerResult.changes
                    ) !== 1
                ) {
                    throw new Error(
                        "No fue posible reservar el saldo en el ledger."
                    );
                }

                return this.getWithdrawal(
                    withdrawalId
                );
            }
        );
    }

    cancelReservation(
        withdrawalId
    ) {
        const normalizedId =
            String(
                withdrawalId ||
                ""
            ).trim();

        if (!normalizedId) {
            throw new Error(
                "withdrawalId es obligatorio."
            );
        }

        return this.database.transaction(
            () => {
                const withdrawal =
                    this.database.connection
                        .prepare(`
                            SELECT *
                            FROM withdrawals_v2
                            WHERE withdrawal_id = ?
                        `)
                        .get(
                            normalizedId
                        );

                if (!withdrawal) {
                    throw new Error(
                        "Retiro V2 no encontrado."
                    );
                }

                if (
                    withdrawal.status ===
                    "CANCELLED"
                ) {
                    return {
                        released:
                            false,

                        withdrawal:
                            this.getWithdrawal(
                                normalizedId
                            )
                    };
                }

                if (
                    withdrawal.status !==
                    "RESERVED"
                ) {
                    throw new Error(
                        `No se puede cancelar un retiro en estado ${withdrawal.status}.`
                    );
                }

                const now =
                    this.clock()
                        .toISOString();

                const releaseResult =
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
                        `)
                        .run(
                            withdrawal.player_id,
                            withdrawal.token_symbol,
                            withdrawal.amount_atomic,
                            WITHDRAWAL_REFERENCE_TYPE,
                            normalizedId,
                            RELEASE_ENTRY_TYPE,
                            now
                        );

                this.database.connection
                    .prepare(`
                        UPDATE withdrawals_v2
                        SET
                            status = 'CANCELLED',
                            updated_at = ?,
                            rejected_at = ?,
                            failure_reason =
                                'CANCELLED_BEFORE_SIGNING'
                        WHERE withdrawal_id = ?
                    `)
                    .run(
                        now,
                        now,
                        normalizedId
                    );

                return {
                    released:
                        Number(
                            releaseResult.changes
                        ) === 1,

                    withdrawal:
                        this.getWithdrawal(
                            normalizedId
                        )
                };
            }
        );
    }

    getWithdrawal(
        withdrawalId
    ) {
        const row =
            this.database.connection
                .prepare(`
                    SELECT *
                    FROM withdrawals_v2
                    WHERE withdrawal_id = ?
                `)
                .get(
                    withdrawalId
                );

        if (!row) {
            return null;
        }

        const sources =
            this.database.connection
                .prepare(`
                    SELECT
                        source_index,
                        vault_address,
                        amount_atomic
                    FROM withdrawal_sources
                    WHERE withdrawal_id = ?
                    ORDER BY source_index ASC
                `)
                .all(
                    withdrawalId
                )
                .map(
                    source => ({
                        sourceIndex:
                            Number(
                                source.source_index
                            ),

                        vaultAddress:
                            getAddress(
                                source.vault_address
                            ),

                        amountAtomic:
                            source.amount_atomic
                    })
                );

        return {
            withdrawalId:
                row.withdrawal_id,

            playerId:
                row.player_id,

            network:
                row.network,

            chainId:
                Number(
                    row.chain_id
                ),

            token:
                row.token_symbol,

            tokenAddress:
                getAddress(
                    row.token_address
                ),

            destinationAddress:
                getAddress(
                    row.destination_address
                ),

            amountAtomic:
                row.amount_atomic,

            status:
                row.status,

            nonce:
                row.nonce,

            deadline:
                row.deadline,

            txHash:
                row.tx_hash,

            createdAt:
                row.created_at,

            updatedAt:
                row.updated_at,

            rejectedAt:
                row.rejected_at,

            failureReason:
                row.failure_reason,

            sources
        };
    }

    getPlayerBalanceAtomic(
        playerId
    ) {
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
                    playerId,
                    this.tokenSymbol
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

    listVaultAvailability(
        playerId
    ) {
        const intents =
            this.database.connection
                .prepare(`
                    SELECT
                        intent_id,
                        vault_address,
                        created_at
                    FROM payment_intents
                    WHERE player_id = ?
                      AND chain_id = ?
                      AND LOWER(token_address) =
                          LOWER(?)
                    ORDER BY
                        created_at ASC,
                        vault_address ASC
                `)
                .all(
                    playerId,
                    this.chainId,
                    this.tokenAddress
                );

        const deposits =
            this.database.connection
                .prepare(`
                    SELECT
                        to_address,
                        amount_atomic
                    FROM chain_events
                    WHERE chain_id = ?
                      AND LOWER(contract_address) =
                          LOWER(?)
                      AND event_name = 'Transfer'
                      AND status = 'FINALIZED'
                `)
                .all(
                    this.chainId,
                    this.tokenAddress
                );

        const activeSources =
            this.database.connection
                .prepare(`
                    SELECT
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

                      AND w.status IN (
                          'RESERVED',
                          'AWAITING_SIGNATURES',
                          'SIGNED',
                          'SUBMITTED',
                          'CONFIRMED'
                      )
                `)
                .all(
                    this.chainId,
                    this.tokenAddress
                );

        const depositTotals =
            new Map();

        for (const deposit of deposits) {
            const key =
                String(
                    deposit.to_address
                ).toLowerCase();

            depositTotals.set(
                key,
                (
                    depositTotals.get(
                        key
                    ) || 0n
                ) +
                BigInt(
                    deposit.amount_atomic
                )
            );
        }

        const reservedTotals =
            new Map();

        for (
            const source of
            activeSources
        ) {
            const key =
                String(
                    source.vault_address
                ).toLowerCase();

            reservedTotals.set(
                key,
                (
                    reservedTotals.get(
                        key
                    ) || 0n
                ) +
                BigInt(
                    source.amount_atomic
                )
            );
        }

        return intents.map(
            intent => {
                const vaultAddress =
                    getAddress(
                        intent.vault_address
                    );

                const key =
                    vaultAddress
                        .toLowerCase();

                const depositedAtomic =
                    depositTotals.get(
                        key
                    ) || 0n;

                const reservedAtomic =
                    reservedTotals.get(
                        key
                    ) || 0n;

                const availableAtomic =
                    depositedAtomic -
                    reservedAtomic;

                return {
                    intentId:
                        intent.intent_id,

                    vaultAddress,

                    createdAt:
                        intent.created_at,

                    depositedAtomic,

                    reservedAtomic,

                    availableAtomic:
                        availableAtomic > 0n
                            ? availableAtomic
                            : 0n
                };
            }
        );
    }

    selectSources(
        vaults,
        amountAtomic
    ) {
        let remaining =
            amountAtomic;

        const sources = [];

        for (const vault of vaults) {
            if (remaining === 0n) {
                break;
            }

            if (
                vault.availableAtomic <=
                0n
            ) {
                continue;
            }

            const selectedAmount =
                vault.availableAtomic <
                remaining
                    ? vault.availableAtomic
                    : remaining;

            sources.push({
                vaultAddress:
                    vault.vaultAddress,

                amountAtomic:
                    selectedAmount
            });

            remaining -=
                selectedAmount;
        }

        if (remaining !== 0n) {
            throw new Error(
                "No fue posible seleccionar suficientes bóvedas."
            );
        }

        return sources;
    }

    parseAmount(
        value
    ) {
        const text =
            String(
                value ??
                ""
            ).trim();

        if (!text) {
            throw new Error(
                "amount es obligatorio."
            );
        }

        let amountAtomic;

        try {
            amountAtomic =
                parseUnits(
                    text,
                    this.tokenDecimals
                );
        } catch {
            throw new Error(
                `Monto inválido. ${this.tokenSymbol} admite hasta ${this.tokenDecimals} decimales.`
            );
        }

        if (amountAtomic <= 0n) {
            throw new Error(
                "El monto debe ser mayor a cero."
            );
        }

        return amountAtomic;
    }

    generateWithdrawalId() {
        const random =
            this.randomUUID()
                .replaceAll("-", "")
                .toUpperCase();

        const timestamp =
            this.clock()
                .getTime()
                .toString(36)
                .toUpperCase();

        return (
            `B2-WDR-${timestamp}-${random}`
        );
    }
}

function normalizePlayerId(
    value
) {
    const playerId =
        String(
            value ||
            ""
        ).trim();

    if (!playerId) {
        throw new Error(
            "playerId es obligatorio."
        );
    }

    if (playerId.length > 128) {
        throw new Error(
            "playerId excede 128 caracteres."
        );
    }

    return playerId;
}

function normalizeAddress(
    value,
    fieldName
) {
    const address =
        String(
            value ||
            ""
        ).trim();

    if (!isAddress(address)) {
        throw new Error(
            `${fieldName} inválido.`
        );
    }

    return getAddress(address);
}

module.exports = {
    WithdrawalReservationService,
    ACTIVE_WITHDRAWAL_STATUSES,
    RESERVATION_ENTRY_TYPE,
    RELEASE_ENTRY_TYPE,
    WITHDRAWAL_REFERENCE_TYPE
};