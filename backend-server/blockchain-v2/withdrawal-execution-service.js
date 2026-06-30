"use strict";

const {
    Contract,
    getAddress,
    isAddress
} = require("ethers");

const orchestratorAbi =
    require("./abi/WithdrawalOrchestrator.json");

class WithdrawalExecutionService {
    constructor(options = {}) {
        if (!options.database) {
            throw new Error(
                "database es obligatorio."
            );
        }

        if (!options.provider) {
            throw new Error(
                "provider es obligatorio."
            );
        }

        this.database =
            options.database;

        this.provider =
            options.provider;

        this.orchestratorAddress =
            normalizeAddress(
                options.orchestratorAddress,
                "orchestratorAddress"
            );

        this.chainId =
            BigInt(
                options.chainId
            );

        this.clock =
            typeof options.clock === "function"
                ? options.clock
                : () => new Date();

        this.contract =
            new Contract(
                this.orchestratorAddress,
                orchestratorAbi,
                this.provider
            );

        this.initialized = false;
    }

    async initialize() {
        const network =
            await this.provider.getNetwork();

        if (
            network.chainId !==
            this.chainId
        ) {
            throw new Error(
                `Chain ID incorrecto. Esperado: ${this.chainId}, recibido: ${network.chainId}.`
            );
        }

        const code =
            await this.provider.getCode(
                this.orchestratorAddress
            );

        if (code === "0x") {
            throw new Error(
                "WithdrawalOrchestrator no tiene bytecode."
            );
        }

        const fragment =
            this.contract.interface
                .getFunction(
                    "executeWithdrawal"
                );

        if (!fragment) {
            throw new Error(
                "El ABI no contiene executeWithdrawal."
            );
        }

        this.executeFragment =
            fragment;

        this.initialized =
            true;

        return {
            chainId:
                network.chainId.toString(),

            orchestratorAddress:
                this.orchestratorAddress,

            functionSignature:
                fragment.format(
                    "sighash"
                ),

            inputCount:
                fragment.inputs.length,

            nextNonce:
                (
                    await this.contract
                        .nextNonce()
                ).toString()
        };
    }

    loadSignedWithdrawal(
        withdrawalId
    ) {
        if (!this.initialized) {
            throw new Error(
                "El servicio de ejecución no está inicializado."
            );
        }

        const normalizedId =
            String(
                withdrawalId ||
                ""
            ).trim();

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
            withdrawal.status !==
            "SIGNED"
        ) {
            throw new Error(
                `El retiro debe estar SIGNED. Estado actual: ${withdrawal.status}.`
            );
        }

        if (
            withdrawal.nonce === null ||
            withdrawal.deadline === null
        ) {
            throw new Error(
                "El retiro no tiene nonce o deadline."
            );
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
                    normalizedId
                );

        if (sources.length === 0) {
            throw new Error(
                "El retiro no tiene bóvedas de origen."
            );
        }

        const signatures =
            this.database.connection
                .prepare(`
                    SELECT
                        signer_address,
                        signature
                    FROM withdrawal_signatures
                    WHERE withdrawal_id = ?
                    ORDER BY
                        LOWER(signer_address) ASC
                `)
                .all(
                    normalizedId
                );

        if (signatures.length === 0) {
            throw new Error(
                "El retiro no tiene firmas."
            );
        }

        const sourceAddresses =
            sources.map(
                source =>
                    getAddress(
                        source.vault_address
                    )
            );

        const sourceAmounts =
            sources.map(
                source =>
                    BigInt(
                        source.amount_atomic
                    )
            );

        const amount =
            BigInt(
                withdrawal.amount_atomic
            );

        const selectedTotal =
            sourceAmounts.reduce(
                (
                    total,
                    item
                ) =>
                    total + item,
                0n
            );

        if (
            selectedTotal !==
            amount
        ) {
            throw new Error(
                "Las fuentes no suman el monto total."
            );
        }

        return {
            withdrawalId:
                normalizedId,

            withdrawalIdHash:
                require("ethers")
                    .keccak256(
                        require("ethers")
                            .toUtf8Bytes(
                                normalizedId
                            )
                    ),

            token:
                getAddress(
                    withdrawal.token_address
                ),

            destination:
                getAddress(
                    withdrawal.destination_address
                ),

            amount,

            sources:
                sourceAddresses,

            sourceAmounts,

            nonce:
                BigInt(
                    withdrawal.nonce
                ),

            deadline:
                BigInt(
                    withdrawal.deadline
                ),

            signatures:
                signatures.map(
                    item =>
                        item.signature
                ),

            signerAddresses:
                signatures.map(
                    item =>
                        getAddress(
                            item.signer_address
                        )
                )
        };
    }

    buildContractArguments(
        payload
    ) {
        const values = {
            withdrawalid:
                payload.withdrawalIdHash,

            token:
                payload.token,

            destination:
                payload.destination,

            amount:
                payload.amount,

            sources:
                payload.sources,

            vaults:
                payload.sources,

            sourcevaults:
                payload.sources,

            sourceamounts:
                payload.sourceAmounts,

            amounts:
                payload.sourceAmounts,

            nonce:
                payload.nonce,

            deadline:
                payload.deadline,

            signatures:
                payload.signatures
        };

        return this.executeFragment
            .inputs
            .map(input => {
                const key =
                    String(
                        input.name ||
                        ""
                    )
                        .replaceAll("_", "")
                        .toLowerCase();

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            values,
                            key
                        )
                ) {
                    return values[key];
                }

                throw new Error(
                    `Parámetro desconocido en executeWithdrawal: ${input.name} (${input.type})`
                );
            });
    }

    async executeWithdrawal(
        withdrawalId,
        relayer
    ) {
        const payload =
            this.loadSignedWithdrawal(
                withdrawalId
            );

        const contractNonce =
            BigInt(
                await this.contract
                    .nextNonce()
            );

        if (
            contractNonce !==
            payload.nonce
        ) {
            throw new Error(
                `Nonce fuera de sincronía. Contrato: ${contractNonce}, retiro: ${payload.nonce}.`
            );
        }

        const argumentsList =
            this.buildContractArguments(
                payload
            );

        const connected =
            this.contract.connect(
                relayer
            );

        const method =
            connected.getFunction(
                this.executeFragment
                    .format(
                        "sighash"
                    )
            );

        const transaction =
            await method(
                ...argumentsList
            );

        const submittedAt =
            this.clock()
                .toISOString();

        this.database.connection
            .prepare(`
                UPDATE withdrawals_v2
                SET
                    status = 'SUBMITTED',
                    tx_hash = ?,
                    submitted_at = ?,
                    updated_at = ?
                WHERE withdrawal_id = ?
                  AND status = 'SIGNED'
            `)
            .run(
                transaction.hash,
                submittedAt,
                submittedAt,
                payload.withdrawalId
            );

        let receipt;

        try {
            receipt =
                await transaction.wait();
        } catch (error) {
            const failedAt =
                this.clock()
                    .toISOString();

            this.database.connection
                .prepare(`
                    UPDATE withdrawals_v2
                    SET
                        status = 'FAILED',
                        updated_at = ?,
                        failure_reason = ?
                    WHERE withdrawal_id = ?
                `)
                .run(
                    failedAt,
                    String(
                        error.shortMessage ||
                        error.message ||
                        "TRANSACTION_FAILED"
                    ),
                    payload.withdrawalId
                );

            throw error;
        }

        if (
            !receipt ||
            Number(receipt.status) !== 1
        ) {
            throw new Error(
                "La transacción de retiro no fue confirmada."
            );
        }

        const confirmedAt =
            this.clock()
                .toISOString();

        this.database.connection
            .prepare(`
                UPDATE withdrawals_v2
                SET
                    status = 'CONFIRMED',
                    confirmed_at = ?,
                    updated_at = ?,
                    failure_reason = NULL
                WHERE withdrawal_id = ?
                  AND status = 'SUBMITTED'
            `)
            .run(
                confirmedAt,
                confirmedAt,
                payload.withdrawalId
            );

        return {
            payload,

            contractArguments:
                argumentsList,

            transactionHash:
                transaction.hash,

            blockNumber:
                Number(
                    receipt.blockNumber
                ),

            gasUsed:
                receipt.gasUsed
                    .toString(),

            status:
                "CONFIRMED"
        };
    }
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
    WithdrawalExecutionService
};