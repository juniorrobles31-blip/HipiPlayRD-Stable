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
    Contract,
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
    signerRegistryAddress,
    tokenAddress
] = process.argv.slice(2);

const temporaryDatabase =
    path.join(
        os.tmpdir(),
        `hipiplay-eip712-${crypto.randomUUID()}.sqlite`
    );

const database =
    new BlockchainV2Database(
        temporaryDatabase
    );

const provider =
    new JsonRpcProvider(
        rpcUrl
    );

async function run() {
    const vaultOne =
        "0x0000000000000000000000000000000000002000";

    const vaultTwo =
        "0x0000000000000000000000000000000000002001";

    database.createPaymentIntent({
        intentId:
            "INT-EIP712-001",
        playerId:
            "usr_eip712_test",
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
            "INT-EIP712-002",
        playerId:
            "usr_eip712_test",
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

    let uuidCounter = 0;

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
            clock:
                () =>
                    new Date(
                        "2026-06-26T20:30:00.000Z"
                    ),
            randomUUID:
                () => {
                    uuidCounter++;

                    return (
                        "eeeeeeee-ffff-4111-8222-" +
                        uuidCounter
                            .toString()
                            .padStart(12, "0")
                    );
                }
        });

    const withdrawal =
        reservationService
            .reserveWithdrawal({
                playerId:
                    "usr_eip712_test",
                destinationAddress:
                    "0x0000000000000000000000000000000000004000",
                amount:
                    "40"
            });

    const eip712Service =
        new WithdrawalEip712Service({
            database,
            provider,
            orchestratorAddress,
            chainId:
                31337,
            signatureTtlSeconds:
                900,
            clock:
                () =>
                    new Date(
                        "2026-06-26T20:30:00.000Z"
                    )
        });

    const orchestratorStatus =
        await eip712Service.initialize();

    const prepared =
        await eip712Service
            .prepareWithdrawal(
                withdrawal.withdrawalId
            );

    const signerOne =
        await provider.getSigner(1);

    const signerTwo =
        await provider.getSigner(2);

    const signed =
        await eip712Service.signAndStore(
            prepared,
            [
                signerOne,
                signerTwo
            ]
        );

    assert.equal(
        signed.length,
        2
    );

    assert.equal(
        signed[0].signerAddress
            .toLowerCase() <
        signed[1].signerAddress
            .toLowerCase(),
        true
    );

    const recovered =
        eip712Service.recoverSigners(
            prepared,
            signed.map(
                item =>
                    item.signature
            )
        );

    assert.deepEqual(
        recovered.map(
            address =>
                address.toLowerCase()
        ),
        signed.map(
            item =>
                item.signerAddress
                    .toLowerCase()
        )
    );

    const registry =
        new Contract(
            signerRegistryAddress,
            [
                "function threshold() view returns (uint256)",
                "function signerCount() view returns (uint256)"
            ],
            provider
        );

    const threshold =
        await registry.threshold();

    const signerCount =
        await registry.signerCount();

    assert.equal(
        threshold,
        2n
    );

    assert.equal(
        signerCount,
        3n
    );

    assert.equal(
        BigInt(signed.length) >=
        threshold,
        true
    );

    const storedWithdrawal =
        database.connection
            .prepare(`
                SELECT
                    status,
                    nonce,
                    deadline
                FROM withdrawals_v2
                WHERE withdrawal_id = ?
            `)
            .get(
                withdrawal.withdrawalId
            );

    assert.equal(
        storedWithdrawal.status,
        "SIGNED"
    );

    assert.equal(
        storedWithdrawal.nonce,
        prepared.value.nonce
            .toString()
    );

    assert.equal(
        storedWithdrawal.deadline,
        prepared.value.deadline
            .toString()
    );

    const storedSignatures =
        database.connection
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
                withdrawal.withdrawalId
            );

    assert.equal(
        storedSignatures.length,
        2
    );

    const modifiedValue = {
        ...prepared.value,

        destination:
            "0x0000000000000000000000000000000000004999"
    };

    const recoveredAfterDestinationChange =
        signed.map(
            item =>
                verifyTypedData(
                    prepared.domain,
                    prepared.types,
                    modifiedValue,
                    item.signature
                )
                    .toLowerCase()
        );

    const originalSignerAddresses =
        signed.map(
            item =>
                item.signerAddress
                    .toLowerCase()
        );

    assert.equal(
        recoveredAfterDestinationChange.some(
            address =>
                originalSignerAddresses
                    .includes(address)
        ),
        false
    );

    console.log(
        jsonSafe(
            {
                ok:
                    true,

                orchestratorStatus,

                withdrawalId:
                    withdrawal.withdrawalId,

                withdrawalIdHash:
                    prepared.withdrawalIdHash,

                sourcesHash:
                    prepared.sourcesHash,

                nonce:
                    prepared.value.nonce
                        .toString(),

                deadline:
                    prepared.value.deadline
                        .toString(),

                sourceCount:
                    prepared.sources.length,

                signatureCount:
                    signed.length,

                registryThreshold:
                    threshold.toString(),

                registrySignerCount:
                    signerCount.toString(),

                signatureOrderStrictlyAscending:
                    true,

                signaturesStored:
                    storedSignatures.length,

                withdrawalStatus:
                    storedWithdrawal.status,

                changedDestinationInvalidatesSignatures:
                    true,

                transactionsExecuted:
                    false,

                transactionsBroadcast:
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
                `${temporaryDatabase}${suffix}`,
                {
                    force:
                        true
                }
            );
        }
    });