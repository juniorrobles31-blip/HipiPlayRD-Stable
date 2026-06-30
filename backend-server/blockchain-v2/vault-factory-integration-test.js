"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    BlockchainV2Database
} = require("./database");

const {
    PaymentIntentService
} = require("./payment-intent-service");

const {
    VaultFactoryClient
} = require("./vault-factory-client");

const [
    rpcUrl,
    factoryAddress,
    tokenAddress
] = process.argv.slice(2);

const temporaryDatabase = path.join(
    os.tmpdir(),
    `hipiplay-real-factory-${crypto.randomUUID()}.sqlite`
);

const database =
    new BlockchainV2Database(
        temporaryDatabase
    );

const factoryClient =
    new VaultFactoryClient({
        rpcUrl,
        factoryAddress,
        tokenAddress,
        chainId: 31337
    });

async function run() {
    const factoryStatus =
        await factoryClient.initialize();

    let uuidCounter = 0;

    const service =
        new PaymentIntentService({
            database,

            network:
                "hardhat-local",

            chainId:
                31337,

            tokenSymbol:
                "USDT",

            tokenAddress,

            tokenDecimals:
                6,

            expirationMinutes:
                30,

            predictVaultAddress:
                (vaultId) =>
                    factoryClient
                        .predictVaultAddress(
                            vaultId
                        ),

            randomUUID:
                () => {
                    uuidCounter++;

                    return (
                        "11111111-2222-4333-8444-" +
                        uuidCounter
                            .toString()
                            .padStart(12, "0")
                    );
                }
        });

    const created =
        await service.createPaymentIntent({
            playerId:
                "usr_local_factory_test",

            amount:
                "25.123456"
        });

    assert.equal(
        created.reused,
        false
    );

    assert.equal(
        created.intent.expectedAmountAtomic,
        "25123456"
    );

    const directPrediction =
        await factoryClient
            .predictVaultAddress(
                created.intent.vaultId
            );

    assert.equal(
        created.intent.depositAddress
            .toLowerCase(),
        directPrediction.toLowerCase()
    );

    const bytecodeBefore =
        await factoryClient.getCode(
            created.intent.depositAddress
        );

    assert.equal(
        bytecodeBefore,
        "0x"
    );

    const reused =
        await service.createPaymentIntent({
            playerId:
                "usr_local_factory_test",

            amount:
                "25.123456"
        });

    assert.equal(
        reused.reused,
        true
    );

    assert.equal(
        reused.intent.intentId,
        created.intent.intentId
    );

    const stored =
        database.getPaymentIntent(
            created.intent.intentId
        );

    assert.equal(
        stored.vault_id,
        created.intent.vaultId
    );

    assert.equal(
        stored.vault_address.toLowerCase(),
        directPrediction.toLowerCase()
    );

    console.log(
        JSON.stringify(
            {
                ok: true,
                factoryStatus,
                intentId:
                    created.intent.intentId,
                vaultId:
                    created.intent.vaultId,
                databaseAddress:
                    created.intent.depositAddress,
                contractPrediction:
                    directPrediction,
                addressesMatch:
                    true,
                vaultNotDeployedYet:
                    bytecodeBefore === "0x",
                pendingIntentReused:
                    reused.reused,
                blockchainNetwork:
                    "hardhat-local",
                publicRoutesEnabled:
                    false,
                serverJsModified:
                    false
            },
            null,
            2
        )
    );
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await factoryClient.close();
        database.close();

        for (
            const suffix of [
                "",
                "-wal",
                "-shm"
            ]
        ) {
            fs.rmSync(
                `${temporaryDatabase}${suffix}`,
                {
                    force: true
                }
            );
        }
    });