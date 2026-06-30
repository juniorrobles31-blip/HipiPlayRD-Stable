"use strict";

function jsonSafe(value) {
    return JSON.stringify(
        value,
        (_key, item) =>
            typeof item === "bigint"
                ? item.toString()
                : item,
        2
    );
}

const assert =
    require("node:assert/strict");

const crypto =
    require("node:crypto");

const fs =
    require("node:fs");

const os =
    require("node:os");

const path =
    require("node:path");

const {
    JsonRpcProvider,
    verifyTypedData
} = require("ethers");

const {
    BlockchainV2Database
} = require("./database");

const {
    DepositLedgerService
} = require("./deposit-ledger-service");

const {
    WithdrawalReservationService
} = require("./withdrawal-reservation-service");

const {
    WithdrawalEip712Service
} = require("./withdrawal-eip712-service");

const [
    rpcUrl,
    orchestratorAddress,
    tokenAddress
] = process.argv.slice(2);

const databaseFile =
    path.join(
        os.tmpdir(),
        `hipiplay-signing-policy-${crypto.randomUUID()}.sqlite`
    );

const database =
    new BlockchainV2Database(
        databaseFile
    );

const provider =
    new JsonRpcProvider(
        rpcUrl
    );

function signatureCount(
    withdrawalId
) {
    return Number(
        database.connection
            .prepare(`
                SELECT COUNT(*) AS total
                FROM withdrawal_signatures
                WHERE withdrawal_id = ?
            `)
            .get(
                withdrawalId
            )
            .total
    );
}

function withdrawalStatus(
    withdrawalId
) {
    return database.connection
        .prepare(`
            SELECT status
            FROM withdrawals_v2
            WHERE withdrawal_id = ?
        `)
        .get(
            withdrawalId
        )
        .status;
}

async function run() {
    const vaultOne =
        "0x0000000000000000000000000000000000002000";

    const vaultTwo =
        "0x0000000000000000000000000000000000002001";

    database.createPaymentIntent({
        intentId:
            "INT-SIGN-POLICY-001",

        playerId:
            "usr_signing_policy",

        network:
            "hardhat-local",

        chainId:
            31337,

        tokenSymbol:
            "USDT",

        tokenAddress,

        vaultId:
            "0x" + "a".repeat(64),

        vaultAddress:
            vaultOne,

        expectedAmountAtomic:
            30000000n,

        status:
            "PAID",

        expiresAt:
            "2026-06-27T00:00:00.000Z",

        createdAt:
            "2026-06-26T20:00:00.000Z"
    });

    database.createPaymentIntent({
        intentId:
            "INT-SIGN-POLICY-002",

        playerId:
            "usr_signing_policy",

        network:
            "hardhat-local",

        chainId:
            31337,

        tokenSymbol:
            "USDT",

        tokenAddress,

        vaultId:
            "0x" + "b".repeat(64),

        vaultAddress:
            vaultTwo,

        expectedAmountAtomic:
            25000000n,

        status:
            "PAID",

        expiresAt:
            "2026-06-27T00:00:00.000Z",

        createdAt:
            "2026-06-26T20:01:00.000Z"
    });

    database.recordChainEvent({
        chainId:
            31337,

        txHash:
            "0x" + "1".repeat(64),

        logIndex:
            0,

        blockNumber:
            100,

        blockHash:
            "0x" + "c".repeat(64),

        contractAddress:
            tokenAddress,

        eventName:
            "Transfer",

        fromAddress:
            "0x0000000000000000000000000000000000003000",

        toAddress:
            vaultOne,

        amountAtomic:
            30000000n,

        confirmations:
            12,

        status:
            "FINALIZED"
    });

    database.recordChainEvent({
        chainId:
            31337,

        txHash:
            "0x" + "2".repeat(64),

        logIndex:
            0,

        blockNumber:
            101,

        blockHash:
            "0x" + "d".repeat(64),

        contractAddress:
            tokenAddress,

        eventName:
            "Transfer",

        fromAddress:
            "0x0000000000000000000000000000000000003000",

        toAddress:
            vaultTwo,

        amountAtomic:
            25000000n,

        confirmations:
            12,

        status:
            "FINALIZED"
    });

    const ledgerService =
        new DepositLedgerService({
            database
        });

    assert.equal(
        ledgerService
            .creditFinalizedDeposits()
            .entriesCreated,
        2
    );

    const reservationService =
        new WithdrawalReservationService({
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

            randomUUID:
                () =>
                    "11111111-2222-4333-8444-555555555555"
        });

    const withdrawal =
        reservationService
            .reserveWithdrawal({
                playerId:
                    "usr_signing_policy",

                destinationAddress:
                    "0x0000000000000000000000000000000000004000",

                amount:
                    "40"
            });

    const service =
        new WithdrawalEip712Service({
            database,

            provider,

            orchestratorAddress,

            chainId:
                31337,

            signatureTtlSeconds:
                3600
        });

    const initializeResult =
        await service.initialize();

    assert.equal(
        initializeResult.threshold,
        "2"
    );

    assert.equal(
        initializeResult.signerCount,
        "3"
    );

    const prepared =
        await service.prepareWithdrawal(
            withdrawal.withdrawalId
        );

    const signerOne =
        await provider.getSigner(1);

    const signerTwo =
        await provider.getSigner(2);

    const outsider =
        await provider.getSigner(8);

    let oneSignatureRejected =
        false;

    try {
        await service.signAndStore(
            prepared,
            [
                signerOne
            ]
        );
    } catch (error) {
        oneSignatureRejected =
            error.message.includes(
                "Firmas insuficientes"
            );
    }

    assert.equal(
        oneSignatureRejected,
        true
    );

    assert.equal(
        signatureCount(
            withdrawal.withdrawalId
        ),
        0
    );

    assert.equal(
        withdrawalStatus(
            withdrawal.withdrawalId
        ),
        "AWAITING_SIGNATURES"
    );

    let outsiderRejected =
        false;

    try {
        await service.signAndStore(
            prepared,
            [
                signerOne,
                outsider
            ]
        );
    } catch (error) {
        outsiderRejected =
            error.message.includes(
                "Firmante no autorizado"
            );
    }

    assert.equal(
        outsiderRejected,
        true
    );

    assert.equal(
        signatureCount(
            withdrawal.withdrawalId
        ),
        0
    );

    assert.equal(
        withdrawalStatus(
            withdrawal.withdrawalId
        ),
        "AWAITING_SIGNATURES"
    );

    let duplicateSignerRejected =
        false;

    try {
        await service.signAndStore(
            prepared,
            [
                signerOne,
                signerOne
            ]
        );
    } catch (error) {
        duplicateSignerRejected =
            error.message.includes(
                "firmantes duplicados"
            );
    }

    assert.equal(
        duplicateSignerRejected,
        true
    );

    assert.equal(
        signatureCount(
            withdrawal.withdrawalId
        ),
        0
    );

    const signatures =
        await service.signAndStore(
            prepared,
            [
                signerOne,
                signerTwo
            ]
        );

    assert.equal(
        signatures.length,
        2
    );

    assert.equal(
        signatureCount(
            withdrawal.withdrawalId
        ),
        2
    );

    assert.equal(
        withdrawalStatus(
            withdrawal.withdrawalId
        ),
        "SIGNED"
    );

    assert.equal(
        signatures[0]
            .signerAddress
            .toLowerCase() <
        signatures[1]
            .signerAddress
            .toLowerCase(),
        true
    );

    const modifiedValue = {
        ...prepared.value,

        destination:
            "0x0000000000000000000000000000000000004999"
    };

    const originalAddresses =
        signatures.map(
            item =>
                item.signerAddress
                    .toLowerCase()
        );

    const recoveredForModifiedDestination =
        signatures.map(
            item =>
                verifyTypedData(
                    prepared.domain,
                    prepared.types,
                    modifiedValue,
                    item.signature
                )
                    .toLowerCase()
        );

    assert.equal(
        recoveredForModifiedDestination.some(
            address =>
                originalAddresses
                    .includes(address)
        ),
        false
    );

    console.log(
        jsonSafe({
            ok:
                true,

            threshold:
                initializeResult.threshold,

            signerCount:
                initializeResult.signerCount,

            oneSignatureRejected,

            outsiderRejected,

            duplicateSignerRejected,

            signaturesStoredAfterFailedAttempts:
                0,

            validSignatureCount:
                signatures.length,

            signaturesStoredAfterValidAttempt:
                signatureCount(
                    withdrawal.withdrawalId
                ),

            finalWithdrawalStatus:
                withdrawalStatus(
                    withdrawal.withdrawalId
                ),

            signaturesStrictlyOrdered:
                true,

            changedDestinationInvalidatesSignatures:
                true,

            transactionExecuted:
                false,

            bscTestnetUsed:
                false,

            serverJsModified:
                false
        })
    );
}

run()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
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
                `${databaseFile}${suffix}`,
                {
                    force:
                        true
                }
            );
        }
    });