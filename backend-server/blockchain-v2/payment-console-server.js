"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const {
    getAddress,
    keccak256,
    toUtf8Bytes,
    parseUnits,
    formatUnits
} = require("ethers");

const {
    BlockchainV2Database
} = require("./database");

const {
    DepositLedgerService
} = require("./deposit-ledger-service");

const ROOT =
    path.resolve(__dirname, "..");

const CONFIG_FILE =
    path.join(__dirname, "payment-console.config.json");

const config =
    JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf8")
    );

const PORT =
    Number(config.port || 4105);

const TOKEN =
    String(config.consoleToken || "");

const DB_FILE =
    config.databaseFile ||
    path.join(
        ROOT,
        "data",
        "blockchain-v2",
        "blockchain-v2.sqlite"
    );

const TOKEN_SYMBOL = "USDT";
const TOKEN_DECIMALS = 6;
const DEMO_CHAIN_ID = 97;
const DEMO_NETWORK = "bsc-mainnet";
const DEMO_TOKEN_ADDRESS =
    "0x55d398326f99059fF775485246999027B3197955";

const database =
    new BlockchainV2Database(DB_FILE);

const ledgerService =
    new DepositLedgerService({
        database
    });

function connection() {
    return database.connection || database.db || database.sqlite || database;
}

function nowIso() {
    return new Date().toISOString();
}

function safeJson(value) {
    if (!value) {
        return {};
    }

    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

function sendJson(response, statusCode, payload) {
    // HIPIPLAY_JSON_NO_STORE
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    const body =
        JSON.stringify(
            payload,
            (_key, value) =>
                typeof value === "bigint"
                    ? value.toString()
                    : value,
            2
        );

    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-console-token"
    });

    response.end(body);
}

function sendHtml(response, html) {
    // HIPIPLAY_HTML_NO_STORE
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
    });

    response.end(html);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let data = "";

        request.on("data", chunk => {
            data += chunk;

            if (data.length > 1_000_000) {
                reject(new Error("Body demasiado grande."));
                request.destroy();
            }
        });

        request.on("end", () => {
            if (!data) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(data));
            } catch {
                reject(new Error("JSON invilido."));
            }
        });

        request.on("error", reject);
    });
}

function requireConsoleToken(request) {
    const token =
        String(request.headers["x-console-token"] || "");

    if (!TOKEN || token !== TOKEN) {
        throw new Error("TOKEN_INVALIDO");
    }
}

function makeId(prefix) {
    return [
        prefix,
        Date.now().toString(36).toUpperCase(),
        crypto.randomBytes(6).toString("hex").toUpperCase()
    ].join("-");
}

function normalizeAmountToAtomic(amount) {
    const text =
        String(amount || "")
            .trim();

    if (!text) {
        throw new Error("Monto obligatorio.");
    }

    const value =
        parseUnits(text, TOKEN_DECIMALS);

    if (value <= 0n) {
        throw new Error("El monto debe ser mayor a cero.");
    }

    return value;
}

function legacyFallbackVaultAddress(vaultId) {
    const hash =
        keccak256(
            toUtf8Bytes(
                `hipiplay-v2-demo-vault:${vaultId}`
            )
        );

    return getAddress(
        "0x" + hash.slice(-40)
    );
}

function buildVaultId({
    intentId,
    playerId,
    amountAtomic
}) {
    return keccak256(
        toUtf8Bytes(
            [
                "hipiplay-v2",
                intentId,
                playerId,
                amountAtomic.toString()
            ].join(":")
        )
    );
}

function getTableColumns(tableName) {
    try {
        return connection()
            .prepare(`PRAGMA table_info(${tableName})`)
            .all()
            .map(column => column.name);
    } catch {
        return [];
    }
}

function insertFiltered(tableName, data) {
    const columns =
        getTableColumns(tableName)
            .filter(column =>
                Object.prototype.hasOwnProperty.call(data, column)
            );

    if (!columns.length) {
        throw new Error(`No hay columnas compatibles para insertar en ${tableName}.`);
    }

    const sql =
        `INSERT INTO ${tableName} (` +
        columns.join(", ") +
        `) VALUES (` +
        columns.map(column => `@${column}`).join(", ") +
        `)`;

    const filtered = {};

    for (const column of columns) {
        filtered[column] = data[column];
    }

    return connection()
        .prepare(sql)
        .run(filtered);
}

function updateIntentMetadata(intentId, metadata) {
    const columns =
        getTableColumns("payment_intents");

    if (!columns.includes("metadata_json")) {
        return;
    }

    connection()
        .prepare(`
            UPDATE payment_intents
            SET metadata_json = ?
            WHERE intent_id = ?
        `)
        .run(
            JSON.stringify(metadata),
            intentId
        );
}

function updateIntentStatus(intentId, status) {
    const columns =
        getTableColumns("payment_intents");

    if (columns.includes("updated_at")) {
        connection()
            .prepare(`
                UPDATE payment_intents
                SET status = ?, updated_at = ?
                WHERE intent_id = ?
            `)
            .run(
                status,
                nowIso(),
                intentId
            );

        return;
    }

    connection()
        .prepare(`
            UPDATE payment_intents
            SET status = ?
            WHERE intent_id = ?
        `)
        .run(
            status,
            intentId
        );
}



// HIPIPLAY CUSTODY REAL WALLETS - START
const HIPI_CUSTODY_CP =
  require("node:child_process");

const HIPI_CUSTODY_PATH =
  require("node:path");

const HIPI_CUSTODY_MANAGER_FILE =
  HIPI_CUSTODY_PATH.join(__dirname, "custody-wallet-manager.js");

function hipiRunCustodyManager(args) {
  const output =
    HIPI_CUSTODY_CP.execFileSync(
      process.execPath,
      [
        HIPI_CUSTODY_MANAGER_FILE,
        ...args
      ],
      {
        cwd: __dirname,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ],
        timeout: 30000
      }
    );

  return JSON.parse(output);
}

function hipiReserveCustodyWalletForIntent(intentId, playerId, networkCode) {
  try {
    return hipiRunCustodyManager([
      "reserve",
      String(intentId || ""),
      String(playerId || ""),
      String(networkCode || "BSC_BEP20")
    ]);
  }
  catch (error) {
    const message =
      String(error.stderr || error.message || "");

    if (
      message.includes("No hay wallets custody disponibles") ||
      message.includes("Genera mas wallets")
    ) {
      hipiRunCustodyManager([
        "generate", "1"
      ]);

      return hipiRunCustodyManager([
        "reserve",
        String(intentId || ""),
        String(playerId || ""),
        String(networkCode || "BSC_BEP20")
      ]);
    }

    throw error;
  }
}

/* HIPI_NETWORK_PATCH_BSC_TRON_SAFE */
function hipiNormalizePaymentNetwork(input) {
    const value = String(input || "").trim().toUpperCase();

    if (
        value === "TRON" ||
        value === "TRC20" ||
        value === "TRX" ||
        value === "TRON_TRC20"
    ) {
        return {
            networkCode: "TRON_TRC20",
            network: "TRON",
            networkLabel: "TRON / TRC20",
            token: "USDT",
            tokenSymbol: "USDT",
            tokenStandard: "TRC20",
            tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            tokenDecimals: 6,
            gasToken: "TRX"
        };
    }

    return {
        networkCode: "BSC_BEP20",
        network: "BSC",
        networkLabel: "BSC / BEP20",
        token: "USDT",
        tokenSymbol: "USDT",
        tokenStandard: "BEP20",
        tokenContract: "0x55d398326f99059fF775485246999027B3197955",
        tokenDecimals: 18,
        gasToken: "BNB"
    };
}

function hipiDetectPaymentNetworkFromWallet(address) {
    const value = String(address || "").trim();

    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) {
        return hipiNormalizePaymentNetwork("TRON_TRC20");
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return hipiNormalizePaymentNetwork("BSC_BEP20");
    }

    return hipiNormalizePaymentNetwork("BSC_BEP20");
}

function hipiResolvePaymentNetwork(input) {
    const explicitNetwork =
        input &&
        (
            input.networkCode ||
            input.paymentNetwork ||
            input.detectedNetwork ||
            input.network
        );

    if (explicitNetwork) {
        return hipiNormalizePaymentNetwork(explicitNetwork);
    }

    return hipiDetectPaymentNetworkFromWallet(
        input &&
        (
            input.sourceWallet ||
            input.customerWallet ||
            input.fromAddress ||
            ""
        )
    );
}
/* /HIPI_NETWORK_PATCH_BSC_TRON_SAFE */

// HIPIPLAY CUSTODY REAL WALLETS - END

function createIntent(input) {
    const playerId =
        String(input.playerId || "")
            .trim();

    if (!playerId) {
        throw new Error("playerId es obligatorio.");
    }

    const pwa =
        String(input.pwa || "PWA")
            .trim()
            .slice(0, 80);

    const paymentNetwork =
        hipiResolvePaymentNetwork(input);

    input.networkCode = paymentNetwork.networkCode;
    input.network = paymentNetwork.network;
    input.networkLabel = paymentNetwork.networkLabel;
    input.token = paymentNetwork.token;
    input.tokenSymbol = paymentNetwork.tokenSymbol;
    input.tokenStandard = paymentNetwork.tokenStandard;
    input.tokenContract = paymentNetwork.tokenContract;
    input.tokenDecimals = paymentNetwork.tokenDecimals;
    input.gasToken = paymentNetwork.gasToken;

    const amountAtomic =
        normalizeAmountToAtomic(input.amount);

    const intentId =
        makeId("PAY");

    const vaultId =
        buildVaultId({
            intentId,
            playerId,
            amountAtomic
        });

    
    let vaultAddress =
        legacyFallbackVaultAddress(vaultId);

    let custodyWallet = null;

    const hipiIntentIdForCustody =
        typeof intentId !== "undefined"
            ? intentId
            : (
                typeof payload !== "undefined" &&
                payload &&
                (
                    payload.intentId ||
                    payload.intent_id
                )
            );

    const hipiPlayerIdForCustody =
        typeof playerId !== "undefined"
            ? playerId
            : (
                typeof payload !== "undefined" &&
                payload &&
                (
                    payload.playerId ||
                    payload.player_id ||
                    payload.userId ||
                    payload.user_id
                )
            );

    const custodyReservation =
        hipiReserveCustodyWalletForIntent(
            hipiIntentIdForCustody,
            hipiPlayerIdForCustody,
            paymentNetwork.networkCode
        );

    if (custodyReservation) {
        custodyWallet =
            custodyReservation.wallet ||
            custodyReservation;

        if (custodyWallet && custodyWallet.address) {
            vaultAddress =
                custodyWallet.address;
        }
    }

    if (!custodyWallet || !custodyWallet.address) {
        throw new Error("No se pudo reservar wallet custody real para el intent.");
    }


    const createdAt =
        nowIso();

    const expiresAt =
        new Date(
            Date.now() + 30 * 60 * 1000
        ).toISOString();

    const payload = {
        intentId,
        playerId,
        network: paymentNetwork.network,
        networkCode: paymentNetwork.networkCode,
        networkLabel: paymentNetwork.networkLabel,
        chainId: paymentNetwork.networkCode === "TRON_TRC20" ? "tron-mainnet" : DEMO_CHAIN_ID,
        tokenSymbol: paymentNetwork.tokenSymbol || TOKEN_SYMBOL,
        tokenAddress: paymentNetwork.tokenContract || DEMO_TOKEN_ADDRESS,
        tokenStandard: paymentNetwork.tokenStandard,
        tokenContract: paymentNetwork.tokenContract,
        tokenDecimals: paymentNetwork.tokenDecimals,
        gasToken: paymentNetwork.gasToken,
        vaultId,
        vaultAddress,
        expectedAmountAtomic: amountAtomic.toString(),
        status: "PAYMENT_PENDING",
        expiresAt,
        createdAt
    };

    if (typeof database.createPaymentIntent === "function") {
        database.createPaymentIntent(payload);
    }
    else {
        insertFiltered("payment_intents", {
            intent_id: intentId,
            player_id: playerId,
            network: DEMO_NETWORK,
            chain_id: DEMO_CHAIN_ID,
            token_symbol: TOKEN_SYMBOL,
            token_address: DEMO_TOKEN_ADDRESS,
            vault_id: vaultId,
            vault_address: vaultAddress,
            expected_amount_atomic: amountAtomic.toString(),
            status: "PAYMENT_PENDING",
            expires_at: expiresAt,
            metadata_json: JSON.stringify({
                source: "payment-console",
                pwa,
                mode: "BSC_MAINNET_CUSTODY_PRODUCTION"
            }),
            created_at: createdAt,
            updated_at: createdAt
        });
    }

    updateIntentMetadata(intentId, {
        source: "payment-console",
        pwa,
        mode: "BSC_MAINNET_CUSTODY_PRODUCTION"
    });

    return getIntent(intentId);
}

function getReceivedByIntent(row) {
    const rows =
        connection()
            .prepare(`
                SELECT amount_atomic
                FROM chain_events
                WHERE chain_id = ?
                  AND LOWER(contract_address) = LOWER(?)
                  AND LOWER(to_address) = LOWER(?)
                  AND event_name = 'Transfer'
                  AND status IN ('PAYMENT_DETECTED','FINALIZED')
            `)
            .all(
                Number(row.chain_id),
                row.token_address,
                row.vault_address
            );

    let total = 0n;

    for (const item of rows) {
        total += BigInt(item.amount_atomic || "0");
    }

    return total;
}

function getLedgerByPlayer(playerId) {
    const rows =
        connection()
            .prepare(`
                SELECT direction, amount_atomic
                FROM account_ledger
                WHERE player_id = ?
                  AND UPPER(asset) = ?
            `)
            .all(
                playerId,
                TOKEN_SYMBOL
            );

    let balance = 0n;

    for (const row of rows) {
        const amount =
            BigInt(row.amount_atomic || "0");

        if (row.direction === "CREDIT") {
            balance += amount;
        }

        if (row.direction === "DEBIT") {
            balance -= amount;
        }
    }

    return balance;
}

function formatIntent(row) {
    const receivedAtomic =
        getReceivedByIntent(row);

    const expectedAtomic =
        BigInt(row.expected_amount_atomic || "0");

    const ledgerBalanceAtomic =
        getLedgerByPlayer(row.player_id);

    return {
        intentId: row.intent_id,
        playerId: row.player_id,
        network: row.network,
        chainId: Number(row.chain_id),
        tokenSymbol: row.token_symbol,
        tokenAddress: row.token_address,
        vaultId: row.vault_id,
        depositAddress: row.vault_address,
        expectedAmountAtomic: expectedAtomic.toString(),
        expectedAmount: formatUnits(expectedAtomic, TOKEN_DECIMALS),
        receivedAmountAtomic: receivedAtomic.toString(),
        receivedAmount: formatUnits(receivedAtomic, TOKEN_DECIMALS),
        ledgerBalanceAtomic: ledgerBalanceAtomic.toString(),
        ledgerBalance: formatUnits(ledgerBalanceAtomic, TOKEN_DECIMALS),
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at,
        metadata: safeJson(row.metadata_json),
        isPaid: receivedAtomic >= expectedAtomic && expectedAtomic > 0n
    };
}

function getIntent(intentId) {
    const row =
        connection()
            .prepare(`
                SELECT *
                FROM payment_intents
                WHERE intent_id = ?
            `)
            .get(intentId);

    if (!row) {
        return null;
    }

    return formatIntent(row);
}

function listIntents() {
    const rows =
        connection()
            .prepare(`
                SELECT *
                FROM payment_intents
                ORDER BY created_at DESC
                LIMIT 200
            `)
            .all();

    return rows.map(formatIntent);
}

function listChainEvents() {
    return connection()
        .prepare(`
            SELECT *
            FROM chain_events
            ORDER BY event_id DESC
            LIMIT 100
        `)
        .all();
}

function listLedger() {
    return connection()
        .prepare(`
            SELECT *
            FROM account_ledger
            ORDER BY ledger_id DESC
            LIMIT 100
        `)
        .all();
}

function markRealDeposit(intentId, input) {
    const intentRow =
        connection()
            .prepare(`
                SELECT *
                FROM payment_intents
                WHERE intent_id = ?
            `)
            .get(intentId);

    if (!intentRow) {
        throw new Error("Intent no encontrado.");
    }

    const amountAtomic =
        input && input.amount
            ? normalizeAmountToAtomic(input.amount)
            : BigInt(intentRow.expected_amount_atomic);

    const txHash =
        "0x" +
        crypto.randomBytes(32)
            .toString("hex");

    const blockHash =
        "0x" +
        crypto.randomBytes(32)
            .toString("hex");

    const latest =
        connection()
            .prepare(`
                SELECT COALESCE(MAX(block_number), 1000000) AS blockNumber
                FROM chain_events
                WHERE chain_id = ?
            `)
            .get(
                Number(intentRow.chain_id)
            );

    const blockNumber =
        Number(latest.blockNumber || 1000000) + 1;

    const createdAt =
        nowIso();

    if (typeof database.recordChainEvent === "function") {
        database.recordChainEvent({
            chainId: Number(intentRow.chain_id),
            txHash,
            logIndex: 0,
            blockNumber,
            blockHash,
            contractAddress: intentRow.token_address,
            eventName: "Transfer",
            fromAddress: "0x000000000000000000000000000000000000DEAD",
            toAddress: intentRow.vault_address,
            amountAtomic: amountAtomic.toString(),
            confirmations: 12,
            status: "FINALIZED"
        });
    }
    else {
        insertFiltered("chain_events", {
            chain_id: Number(intentRow.chain_id),
            tx_hash: txHash,
            log_index: 0,
            block_number: blockNumber,
            block_hash: blockHash,
            contract_address: intentRow.token_address,
            event_name: "Transfer",
            from_address: "0x000000000000000000000000000000000000DEAD",
            to_address: intentRow.vault_address,
            amount_atomic: amountAtomic.toString(),
            confirmations: 12,
            status: "FINALIZED",
            created_at: createdAt,
            updated_at: createdAt
        });
    }

    updateIntentStatus(intentId, "PAID");

    let creditResult = null;

    try {
        if (
            ledgerService &&
            typeof ledgerService.creditFinalizedDeposits === "function"
        ) {
            creditResult =
                ledgerService.creditFinalizedDeposits();
        }
    }
    catch (error) {
        creditResult = {
            ok: false,
            warning: error.message || String(error)
        };
    }

    if (!creditResult || creditResult.ok === false) {
        const exists =
            connection()
                .prepare(`
                    SELECT COUNT(*) AS total
                    FROM account_ledger
                    WHERE reference_id = ?
                `)
                .get(txHash);

        if (!exists || Number(exists.total || 0) === 0) {
            insertFiltered("account_ledger", {
                player_id: intentRow.player_id,
                asset: TOKEN_SYMBOL,
                direction: "CREDIT",
                amount_atomic: amountAtomic.toString(),
                reference_type: "CHAIN_EVENT",
                reference_id: txHash,
                entry_type: "DEPOSIT",
                created_at: createdAt,
                updated_at: createdAt
            });
        }
    }

    return {
        intent: getIntent(intentId),
        txHash,
        blockNumber,
        creditResult
    };
}

function stats() {
    const intents =
        listIntents();

    return {
        mode: config.mode,
        dbFile: DB_FILE,
        port: PORT,
        totalIntents: intents.length,
        pending: intents.filter(item => item.status !== "PAID").length,
        paid: intents.filter(item => item.status === "PAID").length,
        chainEvents: listChainEvents().length,
        ledgerEntries: listLedger().length
    };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function pageShell(content) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HipiPlay Blockchain V2 - Payment Bridge</title>
<style>
:root {
    --card: #111827;
    --card2: #172033;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --line: #243044;
    --accent: #22c55e;
    --warn: #f59e0b;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    background: radial-gradient(circle at top, #111827 0, #070b14 45%, #020617 100%);
    color: var(--text);
}
header {
    padding: 22px;
    border-bottom: 1px solid var(--line);
    background: rgba(2, 6, 23, .7);
    position: sticky;
    top: 0;
    z-index: 10;
}
h1 {
    margin: 0;
    font-size: 22px;
}
small { color: var(--muted); }
main {
    padding: 22px;
    max-width: 1300px;
    margin: auto;
}
.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
}
.card {
    background: linear-gradient(180deg, var(--card), var(--card2));
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
}
.card h2 {
    margin: 0 0 10px;
    font-size: 16px;
}
.kpi {
    font-size: 28px;
    font-weight: 800;
}
label {
    display: block;
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 6px;
}
input {
    width: 100%;
    border: 1px solid var(--line);
    background: #020617;
    color: var(--text);
    border-radius: 10px;
    padding: 11px;
}
button {
    border: 0;
    background: var(--accent);
    color: #04110a;
    padding: 11px 14px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 800;
}
button.secondary {
    background: #334155;
    color: var(--text);
}
button.warn {
    background: var(--warn);
    color: #160d02;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}
th, td {
    border-bottom: 1px solid var(--line);
    padding: 10px;
    text-align: left;
    vertical-align: top;
}
th {
    color: var(--muted);
}
.code {
    font-family: Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
}
.badge {
    display: inline-block;
    padding: 5px 8px;
    border-radius: 999px;
    background: #334155;
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
}
.badge.ok { background: rgba(34,197,94,.2); color: #86efac; }
.badge.warn { background: rgba(245,158,11,.2); color: #fcd34d; }
.notice {
    border: 1px solid rgba(245,158,11,.4);
    background: rgba(245,158,11,.08);
    padding: 12px;
    border-radius: 12px;
    color: #fde68a;
}
.row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr auto;
    gap: 12px;
    align-items: end;
}
pre {
    overflow: auto;
    background: #020617;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
}
@media (max-width: 900px) {
    .grid { grid-template-columns: 1fr 1fr; }
    .row { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header>
<h1>HipiPlay Blockchain V2 - Payment Bridge</h1>
<small>Panel de custodia BSC/BEP20 para recargas reales, wallets custody y estados de pago.</small>
</header>
<main>${content}</main>
<script>
const TOKEN = ${JSON.stringify(TOKEN)};
const PUBLIC_BASE_PATH =
    window.location.pathname.startsWith("/blockchain-console")
        ? "/blockchain-console"
        : "";

function publicUrl(path) {
    return PUBLIC_BASE_PATH + path;
}

async function api(path, options = {}) {
    const response = await fetch(publicUrl(path), {
        ...options,
        headers: {
            "content-type": "application/json",
            "x-console-token": TOKEN,
            ...(options.headers || {})
        }
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error || "Error API");
    }

    return json;
}

async function refresh() {
    const data = await api("/api/dashboard?ts=" + Date.now());

    document.getElementById("kpi-intents").textContent = data.stats.totalIntents;
    document.getElementById("kpi-pending").textContent = data.stats.pending;
    document.getElementById("kpi-paid").textContent = data.stats.paid;
    document.getElementById("kpi-ledger").textContent = data.stats.ledgerEntries;

    const rows = (data.intents || []).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || ''))).map(item => {
        const badge = item.status === "PAID"
            ? '<span class="badge ok">PAID</span>'
            : '<span class="badge warn">' + item.status + '</span>';

        return \`
<tr>
<td class="code">\${item.intentId}<br><small>\${item.createdAt || ""}</small></td>
<td>\${item.playerId}<br><small>\${item.metadata.pwa || ""}</small></td>
<td>\${item.expectedAmount} \${item.tokenSymbol}<br><small>Recibido: \${item.receivedAmount}</small></td>
<td class="code">\${item.depositAddress}</td>
<td>\${badge}<br><small>Ledger: \${item.ledgerBalance}</small></td>
<td>
<button class="secondary" onclick="copyText('\${item.depositAddress}')">Copiar</button>

</td>
</tr>\`;
    }).join("");

    document.getElementById("intents-body").innerHTML =
        rows || '<tr><td colspan="6">Sin intentos todavia.</td></tr>';
}

async function createIntent() {
    const payload = {
        playerId: document.getElementById("playerId").value,
        amount: document.getElementById("amount").value,
        pwa: document.getElementById("pwa").value
    };

    const result = await api("/api/intents", {
        method: "POST",
        body: JSON.stringify(payload)
    });

    document.getElementById("last-result").textContent =
        JSON.stringify(result.intent, null, 2);

    await refresh();
}

async function markPaidRealClient(intentId) {
    await api("/api/intents/" + encodeURIComponent(intentId) + "/mark-paid-real", {
        method: "POST",
        body: JSON.stringify({})
    });

    await refresh();
}

function copyText(text) {
    navigator.clipboard.writeText(text);
}

document.addEventListener("DOMContentLoaded", refresh);
</script>
</body>
</html>`;
}


/* HIPI_PUBLIC_WITHDRAWALS_ENDPOINT */
function hipiPublicWithdrawalSendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-console-token"
    });

    response.end(JSON.stringify(payload, null, 2));
}

function hipiPublicWithdrawalReadJson(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", chunk => {
            body += chunk.toString("utf8");

            if (body.length > 1024 * 1024) {
                reject(new Error("Payload demasiado grande."));
                request.destroy();
            }
        });

        request.on("end", () => {
            try {
                if (!body.trim()) {
                    resolve({});
                    return;
                }

                resolve(JSON.parse(body));
            }
            catch (error) {
                reject(new Error("JSON invalido."));
            }
        });

        request.on("error", reject);
    });
}

function hipiPublicWithdrawalMaskWallet(address) {
    address = String(address || "").trim();

    if (!address) {
        return null;
    }

    if (address.length <= 14) {
        return address;
    }

    return address.slice(0, 6) + "..." + address.slice(-4);
}

function hipiPublicWithdrawalRunManager(args) {
    const childProcess =
        require("node:child_process");

    const managerFile =
        path.join(
            __dirname,
            "custody-payout-hot-withdrawal-manager.js"
        );

    const output =
        childProcess.execFileSync(
            process.execPath,
            [
                managerFile,
                ...args
            ],
            {
                cwd: __dirname,
                encoding: "utf8",
                windowsHide: true,
                timeout: 30000
            }
        );

    return JSON.parse(String(output || "{}"));
}

function hipiPublicWithdrawalQueueFile() {
    return path.join(
        __dirname,
        "..",
        "data",
        "blockchain-v2",
        "custody-withdrawal-requests.json"
    );
}

function hipiPublicWithdrawalReadQueue() {
    try {
        const file =
            hipiPublicWithdrawalQueueFile();

        if (!fs.existsSync(file)) {
            return [];
        }

        const parsed =
            JSON.parse(
                fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")
            );

        return Array.isArray(parsed)
            ? parsed
            : [];
    }
    catch {
        return [];
    }
}

function hipiPublicWithdrawalPayload(request) {
    if (!request) {
        return null;
    }

    const destinationAddress =
        request.destinationAddress ||
        request.toCustomerAddress ||
        null;

    return {
        requestId: request.requestId || null,
        visibleId: request.visibleId || null,
        status: request.status || null,
        token: request.token || "USDT",
        networkCode: request.networkCode || null,
        networkLabel: request.network || request.networkLabel || null,
        tokenStandard: request.tokenStandard || null,
        tokenDecimals: request.tokenDecimals || null,
        grossAmountUsdt: request.grossAmountUsdt ?? null,
        feeUsdt: request.feeUsdt ?? null,
        netAmountUsdt: request.netAmountUsdt ?? null,
        destinationWallet: hipiPublicWithdrawalMaskWallet(destinationAddress),
        createdAt: request.createdAt || null,
        approvedAt: request.approvedAt || null,
        rejectedAt: request.rejectedAt || null,
        executedAt: request.executedAt || null,
        txHash: request.txHash || null,
        message:
            request.status === "PENDING_REVIEW"
                ? "Solicitud recibida. Pendiente de revision."
                : (
                    request.status === "APPROVED"
                        ? "Solicitud aprobada."
                        : (
                            request.status === "REJECTED"
                                ? "Solicitud rechazada."
                                : (
                                    request.status === "EXECUTED"
                                        ? "Retiro completado."
                                        : "Solicitud registrada."
                                )
                        )
                )
    };
}
/* /HIPI_PUBLIC_WITHDRAWALS_ENDPOINT */

function dashboardHtml() {
    return pageShell(`
<div class="notice">
<strong>Modo actual:</strong> producciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n BSC/BEP20 activa.
Las recargas se validan contra BSC Mainnet y se acreditan automÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ticamente cuando el pago real es detectado.
</div>

<br>

<div class="grid">
    <div class="card"><h2>Recargas</h2><div class="kpi" id="kpi-intents">0</div></div>
    <div class="card"><h2>Pendientes</h2><div class="kpi" id="kpi-pending">0</div></div>
    <div class="card"><h2>Pagados</h2><div class="kpi" id="kpi-paid">0</div></div>
    <div class="card"><h2>Ledger</h2><div class="kpi" id="kpi-ledger">0</div></div>
</div>

<br>

<div class="card">
    <h2>Crear recarga real USDT</h2>
    <div class="row">
        <div>
            <label>Player ID / Usuario real</label>
            <input id="playerId" value="">
        </div>
        <div>
            <label>Monto USDT</label>
            <input id="amount" placeholder="Monto USDT" value="">
        </div>
        <div>
            <label>PWA origen</label>
            <input id="pwa" value="HipiPlay PWA">
        </div>
        <div>
            <button onclick="createIntent()">Generar wallet real</button>
        </div>
    </div>
    <br>
    <pre id="last-result">Resultado de wallet real aparecerÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ aquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­...</pre>
</div>

<br>

<div class="card">
    <h2>Wallets reales / recargas generadas</h2>
    <table>
        <thead>
            <tr>
                <th>Intent</th>
                <th>Usuario</th>
                <th>Monto</th>
                <th>Wallet / Vault</th>\n                    <th>Wallet origen</th>\n                    <th>Carretera detectada</th>
                <th>Estado</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody id="intents-body">
            <tr><td colspan="6">Cargando...</td></tr>
        </tbody>
    </table>
</div>

<br>

<div class="card">
    <h2>Endpoint pÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºblico de recarga para PWA</h2>
    <pre>/checkout?playerId=ID_USUARIO_REAL&amount=MONTO_USDT&pwa=HipiPlay</pre>
</div>
`);
}

function checkoutHtml(query) {
    const playerId =
        escapeHtml(query.get("playerId") || "");

    const amount =
        escapeHtml(query.get("amount") || "10");

    const pwa =
        escapeHtml(query.get("pwa") || "PWA");

    return pageShell(`
<div class="card">
    <h2>Checkout Blockchain V2</h2>
    <p>Esta pantalla simula lo que veria una PWA al comprar monedas con USDT.</p>

    <div class="row">
        <div>
            <label>Player ID</label>
            <input id="playerId" value="${playerId}">
        </div>
        <div>
            <label>Monto USDT</label>
            <input id="amount" value="${amount}">
        </div>
        <div>
            <label>PWA</label>
            <input id="pwa" value="${pwa}">
        </div>
        <div>
            <button onclick="createIntent()">Generar wallet real de pago</button>
        </div>
    </div>

    <br>
    <pre id="last-result">Presiona Generar wallet real de pago.</pre>
</div>

<br>

<div class="card">
    <h2>Estado general</h2>
    <div class="grid">
        <div><strong>Recargas:</strong> <span id="kpi-intents">0</span></div>
        <div><strong>Pendientes:</strong> <span id="kpi-pending">0</span></div>
        <div><strong>Pagados:</strong> <span id="kpi-paid">0</span></div>
        <div><strong>Ledger:</strong> <span id="kpi-ledger">0</span></div>
    </div>
</div>

<br>

<div class="card">
    <h2>iltimos intentos</h2>
    <table>
        <thead>
            <tr>
                <th>Intent</th>
                <th>Usuario</th>
                <th>Monto</th>
                <th>Wallet / Vault</th>\n                    <th>Wallet origen</th>\n                    <th>Carretera detectada</th>
                <th>Estado</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody id="intents-body"></tbody>
    </table>
</div>
`);
}



function hipiMetadataFile() {
    const fsLocal = require("node:fs");
    const pathLocal = require("node:path");

    const dir =
        pathLocal.join(
            __dirname,
            "..",
            "data",
            "blockchain-v2"
        );

    fsLocal.mkdirSync(
        dir,
        {
            recursive: true
        }
    );

    return pathLocal.join(
        dir,
        "payment-intent-metadata.json"
    );
}

function hipiReadMetadataStore() {
    const fsLocal = require("node:fs");
    const file =
        hipiMetadataFile();

    if (!fsLocal.existsSync(file)) {
        return {};
    }

    try {
        return JSON.parse(
            fsLocal.readFileSync(file, "utf8")
        ) || {};
    }
    catch {
        return {};
    }
}

function hipiWriteMetadataStore(store) {
    const fsLocal = require("node:fs");
    const file =
        hipiMetadataFile();

    fsLocal.writeFileSync(
        file,
        JSON.stringify(store || {}, null, 2),
        "utf8"
    );
}

function hipiNormalizeIntentMetadata(input) {
    const sourceWallet =
        String(
            input.sourceWallet ||
            input.customerWallet ||
            input.fromAddress ||
            ""
        ).trim();

    const customerWallet =
        String(
            input.customerWallet ||
            input.sourceWallet ||
            input.fromAddress ||
            ""
        ).trim();

    const fromAddress =
        String(
            input.fromAddress ||
            input.sourceWallet ||
            input.customerWallet ||
            ""
        ).trim();

    const requestedNetwork =
        String(
            input.network ||
            input.requestedNetwork ||
            ""
        ).trim();

    const networkLabel =
        String(
            input.networkLabel ||
            input.detectedNetworkLabel ||
            input.networkName ||
            input.network ||
            ""
        ).trim();

    const visibleId =
        String(
            input.visibleId ||
            input.username ||
            ""
        ).trim();

    const pwa =
        String(
            input.pwa ||
            input.source ||
            "HipiPlay"
        ).trim();

    return {
        visibleId: visibleId || null,
        pwa: pwa || null,
        sourceWallet: sourceWallet || null,
        customerWallet: customerWallet || null,
        fromAddress: fromAddress || null,
        requestedNetwork: requestedNetwork || null,
        networkLabel: networkLabel || null,
        updatedAt: new Date().toISOString()
    };
}

function hipiSaveIntentMetadata(intentId, input) {
    if (!intentId) {
        return {};
    }

    const store =
        hipiReadMetadataStore();

    const current =
        store[intentId] || {};

    const metadata =
        {
            ...current,
            ...hipiNormalizeIntentMetadata(input || {}),
            intentId
        };

    store[intentId] =
        metadata;

    hipiWriteMetadataStore(store);

    return metadata;
}

function hipiGetIntentMetadata(intentId) {
    if (!intentId) {
        return {};
    }

    const store =
        hipiReadMetadataStore();

    return store[intentId] || {};
}

function hipiEnrichIntentMetadata(intent) {
    if (!intent) {
        return intent;
    }

    const intentId =
        intent.intentId ||
        intent.id ||
        intent.intent_id;

    if (!intentId) {
        return intent;
    }

    return {
        ...intent,
        ...hipiGetIntentMetadata(intentId)
    };
}

function publicIntentPayload(intent) {
    intent = hipiEnrichIntentMetadata(intent);

    /* HIPI_PUBLIC_PAYLOAD_NETWORK_FALLBACK */
    const resolvedNetwork =
        hipiResolvePaymentNetwork(intent || {});
    /* /HIPI_PUBLIC_PAYLOAD_NETWORK_FALLBACK */

    return {
        intentId: intent.intentId,
        playerId: intent.playerId,
        visibleId: intent.visibleId || null,
        sourceWallet: intent.sourceWallet || null,
        customerWallet: intent.customerWallet || null,
        fromAddress: intent.fromAddress || null,
        requestedNetwork: intent.requestedNetwork || intent.network || resolvedNetwork.network || null,
        networkLabel: intent.networkLabel || resolvedNetwork.networkLabel || null,
        networkCode: intent.networkCode || resolvedNetwork.networkCode || null,
        tokenStandard: intent.tokenStandard || resolvedNetwork.tokenStandard || null,
        tokenContract: intent.tokenContract || intent.tokenAddress || resolvedNetwork.tokenContract || null,
        tokenDecimals: intent.tokenDecimals || resolvedNetwork.tokenDecimals || null,
        gasToken: intent.gasToken || resolvedNetwork.gasToken || null,
        pwa: intent.pwa || intent.source || "HipiPlay",
        network: intent.network || resolvedNetwork.network,
        chainId: intent.chainId || (resolvedNetwork.networkCode === "TRON_TRC20" ? "tron-mainnet" : null),
        tokenSymbol: intent.tokenSymbol,
        tokenAddress: intent.tokenAddress,
        depositAddress: intent.depositAddress,
        expectedAmount: intent.expectedAmount,
        receivedAmount: intent.receivedAmount,
        status: intent.status,
        isPaid: intent.isPaid,
        expiresAt: intent.expiresAt,
        createdAt: intent.createdAt
    };
}

async function handleApi(request, response, url) {
    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type,x-console-token"
        });
        response.end();
        return;
    }

    if (url.pathname === "/api/health") {
        sendJson(response, 200, {
            ok: true,
            stats: stats()
        });
        return;
    }


    if (
        url.pathname === "/api/public/intents" &&
        request.method === "POST"
    ) {
        const body =
            await readBody(request);

        const intent =
            createIntent({
                ...body,
                pwa: body.pwa || "HipiPlay",
                source: "PWA"
            });

        // HIPIPLAY_JSON_METADATA_AFTER_PUBLIC_CREATE
        const hipiMetadata =
            hipiSaveIntentMetadata(
                intent.intentId,
                body
            );

        Object.assign(
            intent,
            hipiMetadata
        );

        sendJson(response, 201, {
            ok: true,
            intent: publicIntentPayload(intent)
        });

        return;
    }

    const publicIntentMatch =
        url.pathname.match(
            /^\/api\/public\/intents\/([^/]+)$/
        );

    if (
        publicIntentMatch &&
        request.method === "GET"
    ) {
        const intent =
            getIntent(
                decodeURIComponent(publicIntentMatch[1])
            );

        if (!intent) {
            sendJson(response, 404, {
                ok: false,
                error: "Intent no encontrado."
            });
            return;
        }

        sendJson(response, 200, {
            ok: true,
            intent: publicIntentPayload(intent)
        });

        return;
    }


    /* HIPI_PUBLIC_WITHDRAWALS_ROUTES */
    if (request.method === "OPTIONS" && url.pathname.indexOf("/api/public/withdrawals") === 0) {
        hipiPublicWithdrawalSendJson(response, 200, {
            ok: true
        });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/public/withdrawals") {
        hipiPublicWithdrawalReadJson(request)
            .then(input => {
                const playerId =
                    String(
                        input.playerId ||
                        input.userId ||
                        (
                            input.user &&
                            input.user.id
                        ) ||
                        ""
                    ).trim();

                const visibleId =
                    String(
                        input.visibleId ||
                        input.username ||
                        input.userName ||
                        ""
                    ).trim();

                const amount =
                    input.amount ||
                    input.amountUsdt ||
                    input.withdrawAmount ||
                    input.netAmount ||
                    "";

                const destinationWallet =
                    String(
                        input.destinationWallet ||
                        input.wallet ||
                        input.withdrawWallet ||
                        input.address ||
                        input.toAddress ||
                        ""
                    ).trim();

                if (!playerId) {
                    throw new Error("playerId requerido.");
                }

                if (!amount) {
                    throw new Error("Monto requerido.");
                }

                if (!destinationWallet) {
                    throw new Error("Wallet destino requerida.");
                }

                const created =
                    hipiPublicWithdrawalRunManager([
                        "create",
                        playerId,
                        String(amount),
                        destinationWallet,
                        visibleId || playerId
                    ]);

                hipiPublicWithdrawalSendJson(response, 200, {
                    ok: true,
                    withdrawal: hipiPublicWithdrawalPayload(created.request),
                    rawStatus: created.request && created.request.status
                });
            })
            .catch(error => {
                hipiPublicWithdrawalSendJson(response, 400, {
                    ok: false,
                    error: error.message || "No se pudo crear la solicitud de retiro."
                });
            });

        return;
    }

    const hipiPublicWithdrawalGetMatch =
        url.pathname.match(/^\/api\/public\/withdrawals\/([^/]+)$/);

    if (request.method === "GET" && hipiPublicWithdrawalGetMatch) {
        const requestId =
            decodeURIComponent(
                hipiPublicWithdrawalGetMatch[1]
            );

        const queue =
            hipiPublicWithdrawalReadQueue();

        const item =
            queue.find(x =>
                String(x.requestId || "") === String(requestId)
            );

        if (!item) {
            hipiPublicWithdrawalSendJson(response, 404, {
                ok: false,
                error: "Solicitud no encontrada."
            });
            return;
        }

        hipiPublicWithdrawalSendJson(response, 200, {
            ok: true,
            withdrawal: hipiPublicWithdrawalPayload(item)
        });
        return;
    }
    /* /HIPI_PUBLIC_WITHDRAWALS_ROUTES */

    requireConsoleToken(request);

    if (
        url.pathname === "/api/dashboard" &&
        request.method === "GET"
    ) {
        sendJson(response, 200, {
            ok: true,
            stats: stats(),
            intents: listIntents().map(hipiEnrichIntentMetadata).map(hipiEnrichIntentMetadata),
            events: listChainEvents(),
            ledger: listLedger()
        });
        return;
    }

    if (
        url.pathname === "/api/intents" &&
        request.method === "POST"
    ) {
        const body =
            await readBody(request);

        const intent =
            createIntent(body);

        sendJson(response, 201, {
            ok: true,
            intent
        });

        return;
    }

    const realPaidMatch =
        url.pathname.match(
            /^\/api\/intents\/([^/]+)\/mark-paid-real$/
        );

    if (
        realPaidMatch &&
        request.method === "POST"
    ) {
        const body =
            await readBody(request);

        const result =
            markRealDeposit(
                decodeURIComponent(realPaidMatch[1]),
                body
            );

        sendJson(response, 200, {
            ok: true,
            result
        });

        return;
    }

    const detailMatch =
        url.pathname.match(
            /^\/api\/intents\/([^/]+)$/
        );

    if (
        detailMatch &&
        request.method === "GET"
    ) {
        const intent =
            getIntent(
                decodeURIComponent(detailMatch[1])
            );

        if (!intent) {
            sendJson(response, 404, {
                ok: false,
                error: "Intent no encontrado."
            });
            return;
        }

        sendJson(response, 200, {
            ok: true,
            intent
        });

        return;
    }

    sendJson(response, 404, {
        ok: false,
        error: "Ruta API no encontrada."
    });
}

const server =
    http.createServer(
        async (request, response) => {
            try {
                const url =
                    new URL(
                        request.url,
                        `http://${request.headers.host || "localhost"}`
                    );

                if (url.pathname === "/") {
                    sendHtml(response, dashboardHtml());
                    return;
                }

                if (url.pathname === "/checkout") {
                    sendHtml(response, checkoutHtml(url.searchParams));
                    return;
                }

                if (url.pathname.startsWith("/api/")) {
                    await handleApi(request, response, url);
                    return;
                }

                response.writeHead(404, {
                    "content-type": "text/plain; charset=utf-8"
                });
                response.end("No encontrado.");
            }
            catch (error) {
                const message =
                    error.message === "TOKEN_INVALIDO"
                        ? "Token invilido."
                        : error.message || String(error);

                console.error("[PAYMENT-CONSOLE-ERROR]", message);

                sendJson(response, 500, {
                    ok: false,
                    error: message
                });
            }
        }
    );

server.listen(PORT, "127.0.0.1", () => {
    console.log(`HipiPlay Blockchain V2 Payment Bridge escuchando en puerto ${PORT}`);
    console.log(`Base de datos: ${DB_FILE}`);
    console.log("Modo: PRODUCCION BSC/BEP20 custody.");
});

function shutdown() {
    try {
        if (typeof database.close === "function") {
            database.close();
        }
    }
    finally {
        process.exit(0);
    }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);