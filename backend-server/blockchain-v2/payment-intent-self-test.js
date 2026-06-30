"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    getAddress
} = require("ethers");

const {
    BlockchainV2Database
} = require("./database");

const {
    PaymentIntentService
} = require("./payment-intent-service");

const temporaryFile = path.join(
    os.tmpdir(),
    `hipiplay-payment-intents-${crypto.randomUUID()}.sqlite`
);

const database =
    new BlockchainV2Database(
        temporaryFile
    );

let currentTime =
    new Date(
        "2026-06-26T20:00:00.000Z"
    );

let predictorCalls = 0;
let uuidCounter = 0;

function fakePredictVaultAddress(
    vaultId
) {
    predictorCalls++;

    return getAddress(
        `0x${vaultId.slice(-40)}`
    );
}

const service =
    new PaymentIntentService({
        database,

        network:
            "bsc-testnet",

        chainId:
            97,

        tokenSymbol:
            "USDT",

        tokenAddress:
            "0x0000000000000000000000000000000000001000",

        tokenDecimals:
            6,

        expirationMinutes:
            30,

        predictVaultAddress:
            fakePredictVaultAddress,

        clock:
            () => new Date(
                currentTime
            ),

        randomUUID:
            () => {
                uuidCounter++;

                return (
                    "00000000-0000-4000-8000-" +
                    uuidCounter
                        .toString()
                        .padStart(12, "0")
                );
            }
    });

async function run() {
    const first =
        await service.createPaymentIntent({
            playerId:
                "usr_demo_001",

            amount:
                "125.500001"
        });

    assert.equal(
        first.reused,
        false
    );

    assert.equal(
        first.intent.expectedAmountAtomic,
        "125500001"
    );

    assert.equal(
        first.intent.status,
        "PENDING"
    );

    assert.match(
        first.intent.vaultId,
        /^0x[0-9a-fA-F]{64}$/
    );

    assert.match(
        first.intent.depositAddress,
        /^0x[0-9a-fA-F]{40}$/
    );

    const second =
        await service.createPaymentIntent({
            playerId:
                "usr_demo_001",

            amount:
                "125.500001"
        });

    assert.equal(
        second.reused,
        true
    );

    assert.equal(
        second.intent.intentId,
        first.intent.intentId
    );

    assert.equal(
        second.intent.depositAddress,
        first.intent.depositAddress
    );

    assert.equal(
        predictorCalls,
        1
    );

    const differentAmount =
        await service.createPaymentIntent({
            playerId:
                "usr_demo_001",

            amount:
                "126"
        });

    assert.equal(
        differentAmount.reused,
        false
    );

    assert.notEqual(
        differentAmount.intent.intentId,
        first.intent.intentId
    );

    assert.equal(
        predictorCalls,
        2
    );

    currentTime =
        new Date(
            currentTime.getTime() +
            31 * 60 * 1000
        );

    const afterExpiration =
        await service.createPaymentIntent({
            playerId:
                "usr_demo_001",

            amount:
                "125.500001"
        });

    assert.equal(
        afterExpiration.reused,
        false
    );

    assert.notEqual(
        afterExpiration.intent.intentId,
        first.intent.intentId
    );

    assert.equal(
        predictorCalls,
        3
    );

    const stored =
        service.getPaymentIntent(
            first.intent.intentId
        );

    assert.equal(
        stored.intentId,
        first.intent.intentId
    );

    assert.equal(
        stored.playerId,
        "usr_demo_001"
    );

    let invalidDecimalsRejected = false;

    try {
        await service.createPaymentIntent({
            playerId:
                "usr_demo_001",

            amount:
                "1.0000001"
        });
    } catch {
        invalidDecimalsRejected = true;
    }

    assert.equal(
        invalidDecimalsRejected,
        true
    );

    console.log(
        JSON.stringify(
            {
                ok: true,
                firstIntent:
                    first.intent,
                pendingIntentReused:
                    second.reused,
                differentAmountCreatedNewIntent:
                    true,
                expiredIntentCreatedNewIntent:
                    true,
                invalidDecimalsRejected:
                    true,
                predictorCalls,
                blockchainConnected:
                    false,
                publicRoutesEnabled:
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
    .finally(() => {
        database.close();

        for (
            const suffix of [
                "",
                "-wal",
                "-shm"
            ]
        ) {
            fs.rmSync(
                `${temporaryFile}${suffix}`,
                {
                    force: true
                }
            );
        }
    });