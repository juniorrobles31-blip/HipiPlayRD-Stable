"use strict";

const crypto = require("node:crypto");

const {
    AbiCoder,
    getAddress,
    isAddress,
    keccak256,
    parseUnits
} = require("ethers");

const DEFAULT_TOKEN_DECIMALS = 6;
const DEFAULT_EXPIRATION_MINUTES = 30;

class PaymentIntentService {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        if (
            typeof options.predictVaultAddress !==
            "function"
        ) {
            throw new Error(
                "predictVaultAddress es obligatorio."
            );
        }

        this.database = options.database;
        this.predictVaultAddress =
            options.predictVaultAddress;

        this.network =
            String(
                options.network ||
                "bsc-testnet"
            )
                .trim()
                .toLowerCase();

        this.chainId = Number(
            options.chainId || 97
        );

        this.tokenSymbol =
            String(
                options.tokenSymbol ||
                "USDT"
            )
                .trim()
                .toUpperCase();

        this.tokenAddress =
            this.normalizeAddress(
                options.tokenAddress
            );

        this.tokenDecimals = Number(
            options.tokenDecimals ??
            DEFAULT_TOKEN_DECIMALS
        );

        this.expirationMinutes = Number(
            options.expirationMinutes ??
            DEFAULT_EXPIRATION_MINUTES
        );

        this.clock =
            typeof options.clock === "function"
                ? options.clock
                : () => new Date();

        this.randomUUID =
            typeof options.randomUUID === "function"
                ? options.randomUUID
                : () => crypto.randomUUID();

        this.locks = new Map();

        this.validateConfiguration();
    }

    validateConfiguration() {
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
                this.tokenDecimals
            ) ||
            this.tokenDecimals < 0 ||
            this.tokenDecimals > 18
        ) {
            throw new Error(
                "tokenDecimals invÃ¡lido."
            );
        }

        if (
            !Number.isFinite(
                this.expirationMinutes
            ) ||
            this.expirationMinutes <= 0
        ) {
            throw new Error(
                "expirationMinutes invÃ¡lido."
            );
        }
    }

    normalizeAddress(value) {
        const address =
            String(value || "").trim();

        if (!isAddress(address)) {
            throw new Error(
                `DirecciÃ³n invÃ¡lida: ${address || "(vacÃ­a)"}`
            );
        }

        return getAddress(address);
    }

    normalizePlayerId(value) {
        const playerId =
            String(value || "").trim();

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

    normalizeAmount(value) {
        const amountText =
            String(value ?? "").trim();

        if (!amountText) {
            throw new Error(
                "amount es obligatorio."
            );
        }

        let amountAtomic;

        try {
            amountAtomic = parseUnits(
                amountText,
                this.tokenDecimals
            );
        } catch {
            throw new Error(
                `Monto invÃ¡lido. ${this.tokenSymbol} admite hasta ${this.tokenDecimals} decimales.`
            );
        }

        if (amountAtomic <= 0n) {
            throw new Error(
                "El monto debe ser mayor a cero."
            );
        }

        return {
            amountText,
            amountAtomic
        };
    }

    generateIntentId(now) {
        const timestamp =
            now.getTime()
                .toString(36)
                .toUpperCase();

        const random =
            this.randomUUID()
                .replaceAll("-", "")
                .toUpperCase();

        return `B2-DEP-${timestamp}-${random}`;
    }

    calculateVaultId({
        intentId,
        playerId
    }) {
        const encoded =
            AbiCoder.defaultAbiCoder().encode(
                [
                    "string",
                    "uint256",
                    "address",
                    "string",
                    "string"
                ],
                [
                    "HIPIPLAY_PAYMENT_INTENT_V2",
                    this.chainId,
                    this.tokenAddress,
                    playerId,
                    intentId
                ]
            );

        return keccak256(encoded);
    }

    findReusableIntent({
        playerId,
        amountAtomic,
        nowIso
    }) {
        return this.database.connection
            .prepare(`
                SELECT *
                FROM payment_intents
                WHERE player_id = ?
                  AND chain_id = ?
                  AND LOWER(token_address) =
                      LOWER(?)
                  AND expected_amount_atomic = ?
                  AND status = 'PENDING'
                  AND expires_at > ?
                ORDER BY created_at DESC
                LIMIT 1
            `)
            .get(
                playerId,
                this.chainId,
                this.tokenAddress,
                amountAtomic.toString(),
                nowIso
            );
    }

    async createPaymentIntent(input = {}) {
        const playerId =
            this.normalizePlayerId(
                input.playerId
            );

        const {
            amountText,
            amountAtomic
        } = this.normalizeAmount(
            input.amount
        );

        const lockKey = [
            this.chainId,
            this.tokenAddress.toLowerCase(),
            playerId,
            amountAtomic.toString()
        ].join(":");

        return this.withLock(
            lockKey,
            async () => {
                const now = this.clock();
                const nowIso =
                    now.toISOString();

                const reusable =
                    this.findReusableIntent({
                        playerId,
                        amountAtomic,
                        nowIso
                    });

                if (reusable) {
                    return {
                        reused: true,
                        intent:
                            this.toPublicIntent(
                                reusable
                            )
                    };
                }

                const intentId =
                    this.generateIntentId(now);

                const vaultId =
                    this.calculateVaultId({
                        intentId,
                        playerId
                    });

                const predicted =
                    await this.predictVaultAddress(
                        vaultId
                    );

                const vaultAddress =
                    this.normalizeAddress(
                        predicted
                    );

                const expiresAt =
                    new Date(
                        now.getTime() +
                        this.expirationMinutes *
                        60 *
                        1000
                    ).toISOString();

                const stored =
                    this.database
                        .createPaymentIntent({
                            intentId,
                            playerId,
                            network:
                                this.network,
                            chainId:
                                this.chainId,
                            tokenSymbol:
                                this.tokenSymbol,
                            tokenAddress:
                                this.tokenAddress,
                            vaultId,
                            vaultAddress,
                            expectedAmountAtomic:
                                amountAtomic,
                            status: "PENDING",
                            expiresAt,
                            createdAt: nowIso
                        });

                return {
                    reused: false,
                    intent:
                        this.toPublicIntent(
                            stored,
                            amountText
                        )
                };
            }
        );
    }

    getPaymentIntent(intentId) {
        const normalized =
            String(intentId || "").trim();

        if (!normalized) {
            throw new Error(
                "intentId es obligatorio."
            );
        }

        const row =
            this.database
                .getPaymentIntent(
                    normalized
                );

        return row
            ? this.toPublicIntent(row)
            : null;
    }

    toPublicIntent(
        row,
        originalAmount = null
    ) {
        return {
            intentId:
                row.intent_id,
            playerId:
                row.player_id,
            network:
                row.network,
            chainId:
                Number(row.chain_id),
            token:
                row.token_symbol,
            tokenAddress:
                getAddress(
                    row.token_address
                ),
            tokenDecimals:
                this.tokenDecimals,
            amount:
                originalAmount,
            expectedAmountAtomic:
                row.expected_amount_atomic,
            creditedAmountAtomic:
                row.credited_amount_atomic,
            vaultId:
                row.vault_id,
            depositAddress:
                getAddress(
                    row.vault_address
                ),
            status:
                row.status,
            expiresAt:
                row.expires_at,
            createdAt:
                row.created_at,
            confirmedAt:
                row.confirmed_at,
            rejectedAt:
                row.rejected_at
        };
    }

    async withLock(key, work) {
        const previous =
            this.locks.get(key) ||
            Promise.resolve();

        const execution =
            previous.then(
                work,
                work
            );

        const gate =
            execution.then(
                () => undefined,
                () => undefined
            );

        this.locks.set(
            key,
            gate
        );

        gate.finally(() => {
            if (
                this.locks.get(key) ===
                gate
            ) {
                this.locks.delete(key);
            }
        });

        return execution;
    }
}

module.exports = {
    PaymentIntentService,
    DEFAULT_TOKEN_DECIMALS,
    DEFAULT_EXPIRATION_MINUTES
};