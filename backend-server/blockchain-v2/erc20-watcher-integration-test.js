"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    Contract,
    JsonRpcProvider
} = require("ethers");

const {
    BlockchainV2Database
} = require("./database");

const {
    PaymentIntentService
} = require("./payment-intent-service");

const {
    VaultFactoryClient
} = require("./vault-factory-client");

const {
    Erc20DepositWatcher
} = require("./erc20-deposit-watcher");

const [
    rpcUrl,
    factoryAddress,
    tokenAddress
] = process.argv.slice(2);

const temporaryDatabase = path.join(
    os.tmpdir(),
    `hipiplay-watcher-${crypto.randomUUID()}.sqlite`
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

const provider =
    new JsonRpcProvider(rpcUrl);

let watcher;

async function run() {
    await factoryClient.initialize();

    const paymentIntentService =
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
                vaultId =>
                    factoryClient
                        .predictVaultAddress(
                            vaultId
                        )
        });

    const intentResult =
        await paymentIntentService
            .createPaymentIntent({
                playerId:
                    "usr_watcher_local",

                amount:
                    "50"
            });

    const intent =
        intentResult.intent;

    const signer =
        await provider.getSigner(0);

    const token =
        new Contract(
            tokenAddress,
            [
                "function mint(address destination,uint256 amount)",
                "function balanceOf(address account) view returns (uint256)"
            ],
            signer
        );

    const mintTransaction =
        await token.mint(
            intent.depositAddress,
            50n * 10n ** 6n
        );

    const receipt =
        await mintTransaction.wait();

    assert.ok(receipt);

    watcher =
        new Erc20DepositWatcher({
            database,
            rpcUrl,
            chainId: 31337,
            tokenAddress,
            requiredConfirmations: 3,
            startBlock:
                Number(
                    receipt.blockNumber
                ),
            maxBlockRange: 100
        });

    const watcherStatus =
        await watcher.initialize();

    const firstScan =
        await watcher.scanOnce();

    const detectedIntent =
        database.getPaymentIntent(
            intent.intentId
        );

    assert.equal(
        firstScan.eventsSeen,
        1
    );

    assert.equal(
        detectedIntent.status,
        "PAYMENT_DETECTED"
    );

    assert.equal(
        detectedIntent.credited_amount_atomic,
        "0"
    );

    await provider.send(
        "hardhat_mine",
        ["0x2"]
    );

    const secondScan =
        await watcher.scanOnce();

    const paidIntent =
        database.getPaymentIntent(
            intent.intentId
        );

    assert.equal(
        secondScan.finalizedEvents,
        1
    );

    assert.equal(
        paidIntent.status,
        "PAID"
    );

    assert.equal(
        paidIntent.credited_amount_atomic,
        "50000000"
    );

    const thirdScan =
        await watcher.scanOnce();

    const eventCount =
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM chain_events
            `)
            .get();

    assert.equal(
        Number(eventCount.total),
        1
    );

    const ledgerCount =
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM account_ledger
            `)
            .get();

    assert.equal(
        Number(ledgerCount.total),
        0
    );

    const watcherState =
        database.connection
            .prepare(`
                SELECT *
                FROM watcher_state
                WHERE chain_id = 31337
            `)
            .get();

    assert.ok(watcherState);

    assert.equal(
        await token.balanceOf(
            intent.depositAddress
        ),
        50n * 10n ** 6n
    );

    console.log(
        JSON.stringify(
            {
                ok: true,
                watcherStatus,
                intentId:
                    intent.intentId,
                depositAddress:
                    intent.depositAddress,
                firstScan,
                secondScan,
                thirdScan,
                paymentStatusAfterOneConfirmation:
                    detectedIntent.status,
                paymentStatusAfterThreeConfirmations:
                    paidIntent.status,
                creditedAmountAtomic:
                    paidIntent.credited_amount_atomic,
                duplicateEventsStored:
                    Number(eventCount.total),
                internalLedgerEntriesCreated:
                    Number(ledgerCount.total),
                watcherState,
                publicRoutesEnabled:
                    false,
                internalCoinsCredited:
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
        if (watcher) {
            await watcher.close();
        }

        await factoryClient.close();

        if (
            typeof provider.destroy ===
            "function"
        ) {
            await provider.destroy();
        }

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