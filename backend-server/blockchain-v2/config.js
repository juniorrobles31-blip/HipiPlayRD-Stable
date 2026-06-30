"use strict";

const path = require("node:path");

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return ["1", "true", "yes", "on"].includes(
        String(value).trim().toLowerCase()
    );
}

function parsePositiveInteger(value, defaultValue) {
    const parsed = Number.parseInt(
        String(value ?? ""),
        10
    );

    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return defaultValue;
    }

    return parsed;
}

const serverRoot = path.resolve(__dirname, "..");

const dataDir =
    process.env.HIPIPLAY_BLOCKCHAIN_V2_DATA_DIR ||
    path.join(serverRoot, "data", "blockchain-v2");

const config = Object.freeze({
    enabled: parseBoolean(
        process.env.BLOCKCHAIN_V2_ENABLED,
        false
    ),

    network:
        process.env.BLOCKCHAIN_V2_NETWORK ||
        "bsc-testnet",

    chainId: parsePositiveInteger(
        process.env.BLOCKCHAIN_V2_CHAIN_ID,
        97
    ),

    rpcUrl:
        process.env.BLOCKCHAIN_V2_RPC_URL ||
        "",

    tokenSymbol:
        process.env.BLOCKCHAIN_V2_TOKEN_SYMBOL ||
        "USDT",

    tokenAddress:
        process.env.BLOCKCHAIN_V2_TOKEN_ADDRESS ||
        "",

    vaultFactoryAddress:
        process.env.BLOCKCHAIN_V2_VAULT_FACTORY_ADDRESS ||
        "",

    withdrawalOrchestratorAddress:
        process.env.BLOCKCHAIN_V2_WITHDRAWAL_ORCHESTRATOR_ADDRESS ||
        "",

    requiredConfirmations: parsePositiveInteger(
        process.env.BLOCKCHAIN_V2_REQUIRED_CONFIRMATIONS,
        12
    ),

    dataDir,

    databaseFile:
        process.env.BLOCKCHAIN_V2_DB_FILE ||
        path.join(dataDir, "blockchain-v2.sqlite")
});

function assertEnabledRuntimeConfiguration() {
    if (!config.enabled) {
        return;
    }

    const missing = [];

    if (!config.rpcUrl) {
        missing.push("BLOCKCHAIN_V2_RPC_URL");
    }

    if (!config.tokenAddress) {
        missing.push("BLOCKCHAIN_V2_TOKEN_ADDRESS");
    }

    if (!config.vaultFactoryAddress) {
        missing.push(
            "BLOCKCHAIN_V2_VAULT_FACTORY_ADDRESS"
        );
    }

    if (!config.withdrawalOrchestratorAddress) {
        missing.push(
            "BLOCKCHAIN_V2_WITHDRAWAL_ORCHESTRATOR_ADDRESS"
        );
    }

    if (missing.length > 0) {
        throw new Error(
            `Configuración Blockchain V2 incompleta: ${missing.join(", ")}`
        );
    }
}

module.exports = {
    config,
    assertEnabledRuntimeConfiguration
};