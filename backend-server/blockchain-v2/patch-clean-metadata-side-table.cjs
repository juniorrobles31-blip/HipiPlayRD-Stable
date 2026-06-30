"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta ruta del panel.");
}

let text = fs.readFileSync(file, "utf8");

if (!text.includes("function createIntent")) {
    throw new Error("No encontre function createIntent.");
}

if (!text.includes("function publicIntentPayload")) {
    throw new Error("No encontre function publicIntentPayload.");
}

if (!text.includes('url.pathname === "/api/public/intents"')) {
    throw new Error("No encontre ruta publica /api/public/intents.");
}

// Tabla separada: no altera payment_intents y evita romper el flujo original.
if (!text.includes("function ensurePaymentIntentMetadataTable")) {
    const helper = `
function ensurePaymentIntentMetadataTable() {
    db.prepare(\`
        CREATE TABLE IF NOT EXISTS payment_intent_metadata (
            intent_id TEXT PRIMARY KEY,
            visible_id TEXT,
            pwa TEXT,
            source_wallet TEXT,
            customer_wallet TEXT,
            from_address TEXT,
            requested_network TEXT,
            network_label TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    \`).run();
}

function normalizePaymentIntentMetadata(input) {
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

    const pwa =
        String(
            input.pwa ||
            input.source ||
            "HipiPlay"
        ).trim();

    const visibleId =
        String(
            input.visibleId ||
            input.username ||
            ""
        ).trim();

    return {
        visibleId: visibleId || null,
        pwa: pwa || null,
        sourceWallet: sourceWallet || null,
        customerWallet: customerWallet || null,
        fromAddress: fromAddress || null,
        requestedNetwork: requestedNetwork || null,
        networkLabel: networkLabel || null
    };
}

function savePaymentIntentMetadata(intentId, input) {
    ensurePaymentIntentMetadataTable();

    const metadata =
        normalizePaymentIntentMetadata(input || {});

    const now =
        new Date().toISOString();

    db.prepare(\`
        INSERT INTO payment_intent_metadata (
            intent_id,
            visible_id,
            pwa,
            source_wallet,
            customer_wallet,
            from_address,
            requested_network,
            network_label,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(intent_id) DO UPDATE SET
            visible_id = excluded.visible_id,
            pwa = excluded.pwa,
            source_wallet = excluded.source_wallet,
            customer_wallet = excluded.customer_wallet,
            from_address = excluded.from_address,
            requested_network = excluded.requested_network,
            network_label = excluded.network_label,
            updated_at = excluded.updated_at
    \`).run(
        intentId,
        metadata.visibleId,
        metadata.pwa,
        metadata.sourceWallet,
        metadata.customerWallet,
        metadata.fromAddress,
        metadata.requestedNetwork,
        metadata.networkLabel,
        now,
        now
    );

    return getPaymentIntentMetadata(intentId);
}

function getPaymentIntentMetadata(intentId) {
    ensurePaymentIntentMetadataTable();

    const row =
        db.prepare(\`
            SELECT
                visible_id,
                pwa,
                source_wallet,
                customer_wallet,
                from_address,
                requested_network,
                network_label
            FROM payment_intent_metadata
            WHERE intent_id = ?
            LIMIT 1
        \`).get(intentId);

    if (!row) {
        return {};
    }

    return {
        visibleId: row.visible_id || null,
        pwa: row.pwa || null,
        sourceWallet: row.source_wallet || null,
        customerWallet: row.customer_wallet || null,
        fromAddress: row.from_address || null,
        requestedNetwork: row.requested_network || null,
        networkLabel: row.network_label || null
    };
}

function enrichPaymentIntentMetadata(intent) {
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
        ...getPaymentIntentMetadata(intentId)
    };
}

`;

    text = text.replace(
        "function publicIntentPayload",
        helper + "function publicIntentPayload"
    );
}

// Enriquecer respuesta publica.
if (!text.includes("intent = enrichPaymentIntentMetadata(intent);")) {
    text = text.replace(
        /function publicIntentPayload\s*\(\s*intent\s*\)\s*\{/,
        "function publicIntentPayload(intent) {\n    intent = enrichPaymentIntentMetadata(intent);"
    );
}

// Agregar campos a publicIntentPayload.
if (!text.includes("sourceWallet: intent.sourceWallet")) {
    text = text.replace(
        "        playerId: intent.playerId,",
        [
            "        playerId: intent.playerId,",
            "        visibleId: intent.visibleId || null,",
            "        sourceWallet: intent.sourceWallet || null,",
            "        customerWallet: intent.customerWallet || null,",
            "        fromAddress: intent.fromAddress || null,",
            "        requestedNetwork: intent.requestedNetwork || null,",
            "        networkLabel: intent.networkLabel || null,"
        ].join("\n")
    );
}

// Guardar metadata solo en la ruta publica, despues de createIntent.
if (!text.includes("HIPIPLAY_SIDE_METADATA_AFTER_PUBLIC_CREATE")) {
    const pattern =
        /(const\s+intent\s*=\s*createIntent\s*\(\s*\{[\s\S]*?source:\s*"PWA"[\s\S]*?\}\s*\);)/;

    if (!pattern.test(text)) {
        throw new Error("No pude ubicar createIntent de la ruta publica.");
    }

    text = text.replace(
        pattern,
        `$1

        // HIPIPLAY_SIDE_METADATA_AFTER_PUBLIC_CREATE
        const hipiMetadata =
            savePaymentIntentMetadata(
                intent.intentId,
                body
            );

        Object.assign(
            intent,
            hipiMetadata
        );`
    );
}

// Dashboard enriquecido.
text = text.replace(
    "intents: listIntents(),",
    "intents: listIntents().map(enrichPaymentIntentMetadata),"
);

text = text.replace(
    /intents:\s*listIntents\(\)/g,
    "intents: listIntents().map(enrichPaymentIntentMetadata)"
);

// Panel visual.
if (!text.includes("<th>Wallet origen</th>")) {
    text = text.split("<th>Wallet / Vault</th>").join(
        "<th>Wallet / Vault</th>\\n                    <th>Wallet origen</th>\\n                    <th>Carretera detectada</th>"
    );

    text = text.split("<td><code>${item.depositAddress}</code></td>").join(
        "<td><code>${item.depositAddress}</code></td>\\n<td><code>${item.sourceWallet || item.customerWallet || item.fromAddress || '-'}</code></td>\\n<td>${item.networkLabel || item.requestedNetwork || item.network || '-'}</td>"
    );

    text = text.split("<td><code>\\${item.depositAddress}</code></td>").join(
        "<td><code>\\${item.depositAddress}</code></td>\\n<td><code>\\${item.sourceWallet || item.customerWallet || item.fromAddress || '-'}</code></td>\\n<td>\\${item.networkLabel || item.requestedNetwork || item.network || '-'}</td>"
    );
}

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

const result = {
    ok: true,
    hasMetadataTable: after.includes("function ensurePaymentIntentMetadataTable"),
    hasSaveMetadata: after.includes("function savePaymentIntentMetadata"),
    hasGetMetadata: after.includes("function getPaymentIntentMetadata"),
    hasPublicHook: after.includes("HIPIPLAY_SIDE_METADATA_AFTER_PUBLIC_CREATE"),
    publicEnriches: after.includes("intent = enrichPaymentIntentMetadata(intent);"),
    publicReturnsSourceWallet: after.includes("sourceWallet: intent.sourceWallet"),
    dashboardEnriches: after.includes("listIntents().map(enrichPaymentIntentMetadata)"),
    panelShowsWalletOrigen: after.includes("<th>Wallet origen</th>"),
    noCreateWrapper: !after.includes("createIntentWithMetadata")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}