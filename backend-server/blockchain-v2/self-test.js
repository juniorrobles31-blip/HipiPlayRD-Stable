"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    BlockchainV2Database,
    SCHEMA_VERSION
} = require("./database");

const temporaryFile = path.join(
    os.tmpdir(),
    `hipiplay-blockchain-v2-${crypto.randomUUID()}.sqlite`
);

const database =
    new BlockchainV2Database(
        temporaryFile
    );

try {
    assert.equal(
        database.getSchemaVersion(),
        SCHEMA_VERSION
    );

    const now = new Date();
    const expiresAt =
        new Date(
            now.getTime() + 30 * 60 * 1000
        ).toISOString();

    const intent =
        database.createPaymentIntent({
            intentId: "INT-SELFTEST-001",
            playerId: "PLAYER-SELFTEST",
            network: "BSC-TESTNET",
            chainId: 97,
            tokenSymbol: "USDT",
            tokenAddress:
                "0x0000000000000000000000000000000000001000",
            vaultId:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            vaultAddress:
                "0x0000000000000000000000000000000000002000",
            expectedAmountAtomic:
                125000000n,
            expiresAt
        });

    assert.equal(
        intent.expected_amount_atomic,
        "125000000"
    );

    const event = {
        chainId: 97,
        txHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        logIndex: 0,
        blockNumber: 100,
        blockHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        contractAddress:
            "0x0000000000000000000000000000000000001000",
        eventName: "Transfer",
        fromAddress:
            "0x0000000000000000000000000000000000003000",
        toAddress:
            "0x0000000000000000000000000000000000002000",
        amountAtomic: 125000000n,
        confirmations: 1
    };

    assert.equal(
        database.recordChainEvent(event),
        true
    );

    assert.equal(
        database.recordChainEvent(event),
        false
    );

    let rollbackValidated = false;

    try {
        database.transaction(() => {
            database.createPaymentIntent({
                intentId: "INT-ROLLBACK",
                playerId: "PLAYER-ROLLBACK",
                network: "BSC-TESTNET",
                chainId: 97,
                tokenSymbol: "USDT",
                tokenAddress:
                    "0x0000000000000000000000000000000000001000",
                vaultId:
                    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                vaultAddress:
                    "0x0000000000000000000000000000000000004000",
                expectedAmountAtomic:
                    1000000n,
                expiresAt
            });

            throw new Error(
                "ROLLBACK_INTENCIONAL"
            );
        });
    } catch (error) {
        rollbackValidated =
            error.message ===
            "ROLLBACK_INTENCIONAL";
    }

    assert.equal(
        rollbackValidated,
        true
    );

    assert.equal(
        database.getPaymentIntent(
            "INT-ROLLBACK"
        ),
        undefined
    );

    console.log(
        JSON.stringify(
            {
                ok: true,
                schemaVersion:
                    database.getSchemaVersion(),
                tables:
                    database.listTables(),
                paymentIntent:
                    intent.intent_id,
                duplicateEventPrevented:
                    true,
                rollbackValidated:
                    true
            },
            null,
            2
        )
    );
} finally {
    database.close();

    for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(
            `${temporaryFile}${suffix}`,
            { force: true }
        );
    }
}