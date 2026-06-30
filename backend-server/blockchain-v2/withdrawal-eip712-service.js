"use strict";

const {
    AbiCoder,
    Contract,
    getAddress,
    isAddress,
    keccak256,
    toUtf8Bytes,
    verifyTypedData
} = require("ethers");

const orchestratorAbi =
    require("./abi/WithdrawalOrchestrator.json");

const registryAbi = [
    "function threshold() view returns (uint256)",
    "function signerCount() view returns (uint256)",
    "function isSigner(address account) view returns (bool)"
];

const WITHDRAWAL_TYPES = Object.freeze({
    Withdrawal: [
        {
            name: "withdrawalId",
            type: "bytes32"
        },
        {
            name: "token",
            type: "address"
        },
        {
            name: "destination",
            type: "address"
        },
        {
            name: "amount",
            type: "uint256"
        },
        {
            name: "sourcesHash",
            type: "bytes32"
        },
        {
            name: "nonce",
            type: "uint256"
        },
        {
            name: "deadline",
            type: "uint256"
        }
    ]
});

class WithdrawalEip712Service {
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

        this.expectedChainId =
            BigInt(
                options.chainId
            );

        this.signatureTtlSeconds =
            Number(
                options.signatureTtlSeconds ||
                900
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
            this.expectedChainId
        ) {
            throw new Error(
                `Chain ID incorrecto. Esperado: ${this.expectedChainId}, recibido: ${network.chainId}.`
            );
        }

        const orchestratorCode =
            await this.provider.getCode(
                this.orchestratorAddress
            );

        if (orchestratorCode === "0x") {
            throw new Error(
                "WithdrawalOrchestrator no tiene bytecode."
            );
        }

        this.tokenAddress =
            getAddress(
                await this.contract.token()
            );

        this.signerRegistryAddress =
            getAddress(
                await this.contract
                    .signerRegistry()
            );

        const registryCode =
            await this.provider.getCode(
                this.signerRegistryAddress
            );

        if (registryCode === "0x") {
            throw new Error(
                "SignerRegistry no tiene bytecode."
            );
        }

        this.registry =
            new Contract(
                this.signerRegistryAddress,
                registryAbi,
                this.provider
            );

        const domainData =
            await this.contract
                .eip712Domain();

        const domainName =
            domainData.name ??
            domainData[1];

        const domainVersion =
            domainData.version ??
            domainData[2];

        const domainChainId =
            BigInt(
                domainData.chainId ??
                domainData[3]
            );

        const verifyingContract =
            getAddress(
                domainData.verifyingContract ??
                domainData[4]
            );

        if (
            domainChainId !==
            network.chainId
        ) {
            throw new Error(
                "El chainId del dominio EIP-712 no coincide."
            );
        }

        if (
            verifyingContract.toLowerCase() !==
            this.orchestratorAddress.toLowerCase()
        ) {
            throw new Error(
                "El verifyingContract del dominio es incorrecto."
            );
        }

        const threshold =
            BigInt(
                await this.registry.threshold()
            );

        const signerCount =
            BigInt(
                await this.registry.signerCount()
            );

        if (
            threshold <= 0n ||
            threshold > signerCount
        ) {
            throw new Error(
                "La configuración del SignerRegistry es inválida."
            );
        }

        this.domain = Object.freeze({
            name:
                domainName,

            version:
                domainVersion,

            chainId:
                domainChainId,

            verifyingContract
        });

        this.threshold =
            threshold;

        this.signerCount =
            signerCount;

        this.initialized =
            true;

        return {
            domain:
                this.domain,

            tokenAddress:
                this.tokenAddress,

            signerRegistryAddress:
                this.signerRegistryAddress,

            threshold:
                threshold.toString(),

            signerCount:
                signerCount.toString(),

            nextNonce:
                (
                    await this.contract
                        .nextNonce()
                ).toString()
        };
    }

    async prepareWithdrawal(
        withdrawalId
    ) {
        if (!this.initialized) {
            throw new Error(
                "El servicio EIP-712 no está inicializado."
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
            "RESERVED"
        ) {
            throw new Error(
                `El retiro debe estar RESERVED. Estado actual: ${withdrawal.status}.`
            );
        }

        if (
            getAddress(
                withdrawal.token_address
            ).toLowerCase() !==
            this.tokenAddress.toLowerCase()
        ) {
            throw new Error(
                "El token del retiro no coincide con el Orchestrator."
            );
        }

        const sourceRows =
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

        if (sourceRows.length === 0) {
            throw new Error(
                "El retiro no posee bóvedas de origen."
            );
        }

        const sources = [];
        const sourceAmounts = [];
        const uniqueVaults = new Set();

        for (const source of sourceRows) {
            const vaultAddress =
                getAddress(
                    source.vault_address
                );

            const vaultKey =
                vaultAddress.toLowerCase();

            if (uniqueVaults.has(vaultKey)) {
                throw new Error(
                    "El retiro contiene una bóveda de origen duplicada."
                );
            }

            uniqueVaults.add(
                vaultKey
            );

            const sourceAmount =
                BigInt(
                    source.amount_atomic
                );

            if (sourceAmount <= 0n) {
                throw new Error(
                    "Todas las cantidades de origen deben ser mayores a cero."
                );
            }

            sources.push(
                vaultAddress
            );

            sourceAmounts.push(
                sourceAmount
            );
        }

        const selectedTotal =
            sourceAmounts.reduce(
                (
                    total,
                    amount
                ) =>
                    total + amount,
                0n
            );

        const withdrawalAmount =
            BigInt(
                withdrawal.amount_atomic
            );

        if (
            withdrawalAmount <= 0n ||
            selectedTotal !==
            withdrawalAmount
        ) {
            throw new Error(
                "Las fuentes no suman el monto exacto del retiro."
            );
        }

        const nonce =
            BigInt(
                await this.contract
                    .nextNonce()
            );

        const deadline =
            BigInt(
                Math.floor(
                    this.clock().getTime() /
                    1000
                ) +
                this.signatureTtlSeconds
            );

        const sourcesHash =
            keccak256(
                AbiCoder
                    .defaultAbiCoder()
                    .encode(
                        [
                            "address[]",
                            "uint256[]"
                        ],
                        [
                            sources,
                            sourceAmounts
                        ]
                    )
            );

        const withdrawalIdHash =
            keccak256(
                toUtf8Bytes(
                    normalizedId
                )
            );

        const value =
            Object.freeze({
                withdrawalId:
                    withdrawalIdHash,

                token:
                    this.tokenAddress,

                destination:
                    getAddress(
                        withdrawal.destination_address
                    ),

                amount:
                    withdrawalAmount,

                sourcesHash,

                nonce,

                deadline
            });

        const now =
            this.clock()
                .toISOString();

        const updateResult =
            this.database.connection
                .prepare(`
                    UPDATE withdrawals_v2
                    SET
                        nonce = ?,
                        deadline = ?,
                        status = 'AWAITING_SIGNATURES',
                        updated_at = ?
                    WHERE withdrawal_id = ?
                      AND status = 'RESERVED'
                `)
                .run(
                    nonce.toString(),
                    deadline.toString(),
                    now,
                    normalizedId
                );

        if (
            Number(
                updateResult.changes
            ) !== 1
        ) {
            throw new Error(
                "No fue posible preparar el retiro para firmas."
            );
        }

        return {
            withdrawalId:
                normalizedId,

            withdrawalIdHash,

            domain:
                this.domain,

            types:
                WITHDRAWAL_TYPES,

            value,

            sources,

            sourceAmounts,

            sourcesHash
        };
    }

    async signAndStore(
        prepared,
        signers
    ) {
        if (!this.initialized) {
            throw new Error(
                "El servicio EIP-712 no está inicializado."
            );
        }

        if (
            !Array.isArray(signers) ||
            signers.length === 0
        ) {
            throw new Error(
                "Se requiere al menos un signer."
            );
        }

        const nowUnix =
            BigInt(
                Math.floor(
                    this.clock().getTime() /
                    1000
                )
            );

        if (
            nowUnix >
            BigInt(
                prepared.value.deadline
            )
        ) {
            throw new Error(
                "La autorización EIP-712 ya expiró."
            );
        }

        const liveThreshold =
            BigInt(
                await this.registry.threshold()
            );

        const liveSignerCount =
            BigInt(
                await this.registry.signerCount()
            );

        if (
            liveThreshold <= 0n ||
            liveThreshold >
            liveSignerCount
        ) {
            throw new Error(
                "La configuración actual del SignerRegistry es inválida."
            );
        }

        const signed = [];
        const uniqueSigners = new Set();

        for (const signer of signers) {
            const signerAddress =
                getAddress(
                    await signer.getAddress()
                );

            const signerKey =
                signerAddress.toLowerCase();

            if (
                uniqueSigners.has(
                    signerKey
                )
            ) {
                throw new Error(
                    "No se permiten firmantes duplicados."
                );
            }

            uniqueSigners.add(
                signerKey
            );

            const authorized =
                await this.registry.isSigner(
                    signerAddress
                );

            if (!authorized) {
                throw new Error(
                    `Firmante no autorizado: ${signerAddress}`
                );
            }

            const signature =
                await signer.signTypedData(
                    prepared.domain,
                    prepared.types,
                    prepared.value
                );

            const recoveredAddress =
                getAddress(
                    verifyTypedData(
                        prepared.domain,
                        prepared.types,
                        prepared.value,
                        signature
                    )
                );

            if (
                recoveredAddress.toLowerCase() !==
                signerKey
            ) {
                throw new Error(
                    "La firma recuperada no coincide con el firmante."
                );
            }

            signed.push({
                signerAddress,
                recoveredAddress,
                signature
            });
        }

        if (
            BigInt(
                signed.length
            ) <
            liveThreshold
        ) {
            throw new Error(
                `Firmas insuficientes. Requeridas: ${liveThreshold}, recibidas: ${signed.length}.`
            );
        }

        signed.sort(
            (left, right) =>
                left.signerAddress
                    .toLowerCase()
                    .localeCompare(
                        right.signerAddress
                            .toLowerCase()
                    )
        );

        for (
            let index = 1;
            index < signed.length;
            index++
        ) {
            if (
                signed[index - 1]
                    .signerAddress
                    .toLowerCase() >=
                signed[index]
                    .signerAddress
                    .toLowerCase()
            ) {
                throw new Error(
                    "Las firmas no están estrictamente ordenadas."
                );
            }
        }

        this.database.transaction(
            () => {
                const withdrawal =
                    this.database.connection
                        .prepare(`
                            SELECT status
                            FROM withdrawals_v2
                            WHERE withdrawal_id = ?
                        `)
                        .get(
                            prepared.withdrawalId
                        );

                if (
                    !withdrawal ||
                    withdrawal.status !==
                    "AWAITING_SIGNATURES"
                ) {
                    throw new Error(
                        "El retiro ya no está esperando firmas."
                    );
                }

                const insertSignature =
                    this.database.connection
                        .prepare(`
                            INSERT OR IGNORE INTO withdrawal_signatures (
                                withdrawal_id,
                                signer_address,
                                signature,
                                created_at
                            )
                            VALUES (?, ?, ?, ?)
                        `);

                const now =
                    this.clock()
                        .toISOString();

                for (const item of signed) {
                    insertSignature.run(
                        prepared.withdrawalId,
                        item.signerAddress,
                        item.signature,
                        now
                    );
                }

                const storedCount =
                    Number(
                        this.database.connection
                            .prepare(`
                                SELECT COUNT(*) AS total
                                FROM withdrawal_signatures
                                WHERE withdrawal_id = ?
                            `)
                            .get(
                                prepared.withdrawalId
                            )
                            .total
                    );

                if (
                    BigInt(storedCount) <
                    liveThreshold
                ) {
                    throw new Error(
                        "No se almacenó el umbral mínimo de firmas."
                    );
                }

                const statusUpdate =
                    this.database.connection
                        .prepare(`
                            UPDATE withdrawals_v2
                            SET
                                status = 'SIGNED',
                                updated_at = ?
                            WHERE withdrawal_id = ?
                              AND status =
                                  'AWAITING_SIGNATURES'
                        `)
                        .run(
                            now,
                            prepared.withdrawalId
                        );

                if (
                    Number(
                        statusUpdate.changes
                    ) !== 1
                ) {
                    throw new Error(
                        "No fue posible marcar el retiro como SIGNED."
                    );
                }
            }
        );

        return signed;
    }

    recoverSigners(
        prepared,
        signatures
    ) {
        return signatures.map(
            signature =>
                getAddress(
                    verifyTypedData(
                        prepared.domain,
                        prepared.types,
                        prepared.value,
                        signature
                    )
                )
        );
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
    WithdrawalEip712Service,
    WITHDRAWAL_TYPES
};