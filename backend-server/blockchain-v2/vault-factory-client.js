"use strict";

const {
    Contract,
    JsonRpcProvider,
    getAddress,
    isAddress,
    isHexString
} = require("ethers");

const vaultFactoryAbi =
    require("./abi/VaultFactory.json");

class VaultFactoryClient {
    constructor(options = {}) {
        this.rpcUrl =
            String(options.rpcUrl || "").trim();

        this.factoryAddress =
            normalizeAddress(
                options.factoryAddress,
                "factoryAddress"
            );

        this.expectedTokenAddress =
            normalizeAddress(
                options.tokenAddress,
                "tokenAddress"
            );

        this.expectedChainId =
            BigInt(options.chainId);

        if (!this.rpcUrl) {
            throw new Error(
                "rpcUrl es obligatorio."
            );
        }

        if (this.expectedChainId <= 0n) {
            throw new Error(
                "chainId inválido."
            );
        }

        this.provider =
            new JsonRpcProvider(this.rpcUrl);

        this.contract =
            new Contract(
                this.factoryAddress,
                vaultFactoryAbi,
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

        const factoryCode =
            await this.provider.getCode(
                this.factoryAddress
            );

        if (factoryCode === "0x") {
            throw new Error(
                "VaultFactory no tiene bytecode."
            );
        }

        const contractToken =
            getAddress(
                await this.contract.token()
            );

        if (
            contractToken.toLowerCase() !==
            this.expectedTokenAddress.toLowerCase()
        ) {
            throw new Error(
                "El token configurado no coincide con VaultFactory."
            );
        }

        const implementation =
            getAddress(
                await this.contract.implementation()
            );

        const implementationCode =
            await this.provider.getCode(
                implementation
            );

        if (implementationCode === "0x") {
            throw new Error(
                "La implementación de DepositVault no tiene bytecode."
            );
        }

        this.chainId = network.chainId;
        this.tokenAddress = contractToken;
        this.implementationAddress =
            implementation;
        this.initialized = true;

        return {
            chainId:
                this.chainId.toString(),
            factoryAddress:
                this.factoryAddress,
            tokenAddress:
                this.tokenAddress,
            implementationAddress:
                this.implementationAddress
        };
    }

    async predictVaultAddress(vaultId) {
        if (!this.initialized) {
            throw new Error(
                "VaultFactoryClient no está inicializado."
            );
        }

        if (
            !isHexString(vaultId, 32) ||
            /^0x0{64}$/i.test(vaultId)
        ) {
            throw new Error(
                "vaultId debe ser bytes32 y distinto de cero."
            );
        }

        return getAddress(
            await this.contract.predictVault(
                vaultId
            )
        );
    }

    async getCode(address) {
        return this.provider.getCode(
            normalizeAddress(
                address,
                "address"
            )
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

function normalizeAddress(value, fieldName) {
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
    VaultFactoryClient
};