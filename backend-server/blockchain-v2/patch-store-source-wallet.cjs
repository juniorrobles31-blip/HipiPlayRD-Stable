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

if (!text.includes("function mapIntent")) {
    throw new Error("No encontre function mapIntent.");
}

if (!text.includes("function publicIntentPayload")) {
    throw new Error("No encontre function publicIntentPayload.");
}

// 1. Helper para agregar columnas metadata en payment_intents.
if (!text.includes("function ensurePaymentIntentMetadataColumns")) {
    const helper = `
function ensurePaymentIntentMetadataColumns() {
    const columns =
        getTableColumns("payment_intents");

    const additions = [
        ["source_wallet", "TEXT"],
        ["customer_wallet", "TEXT"],
        ["from_address", "TEXT"],
        ["requested_network", "TEXT"],
        ["network_label", "TEXT"],
        ["pwa", "TEXT"],
        ["visible_id", "TEXT"]
    ];

    for (const [name, type] of additions) {
        if (!columns.has(name)) {
            db.prepare(
                \`ALTER TABLE payment_intents ADD COLUMN \${name} \${type}\`
            ).run();
            columns.add(name);
        }
    }
}

function updatePaymentIntentMetadata(intentId, input) {
    ensurePaymentIntentMetadataColumns();

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

    db.prepare(\`
        UPDATE payment_intents
        SET
            source_wallet = ?,
            customer_wallet = ?,
            from_address = ?,
            requested_network = ?,
            network_label = ?,
            pwa = ?,
            visible_id = ?,
            updated_at = ?
        WHERE intent_id = ?
    \`).run(
        sourceWallet || null,
        customerWallet || null,
        fromAddress || null,
        requestedNetwork || null,
        networkLabel || null,
        pwa || null,
        visibleId || null,
        new Date().toISOString(),
        intentId
    );
}

`;

    text = text.replace(
        "function createIntent",
        helper + "function createIntent"
    );
}

// 2. Asegurar columnas antes de insertar.
if (!text.includes("ensurePaymentIntentMetadataColumns();\n\n    const playerId")) {
    text = text.replace(
        "    const playerId =",
        "    ensurePaymentIntentMetadataColumns();\n\n    const playerId ="
    );
}

// 3. Luego de crear el intent, guardar metadata de wallet origen.
if (!text.includes("updatePaymentIntentMetadata(intent.intentId, input);")) {
    text = text.replace(
        "    intents.unshift(intent);",
        "    updatePaymentIntentMetadata(intent.intentId, input);\n\n    const storedIntent = getIntent(intent.intentId) || intent;\n\n    intents.unshift(storedIntent);"
    );

    text = text.replace(
        "    return intent;",
        "    return storedIntent;"
    );
}

// 4. mapIntent debe devolver metadata.
if (!text.includes("sourceWallet: row.source_wallet")) {
    text = text.replace(
        "        playerId: row.player_id,",
        [
            "        playerId: row.player_id,",
            "        visibleId: row.visible_id || null,",
            "        pwa: row.pwa || null,",
            "        sourceWallet: row.source_wallet || null,",
            "        customerWallet: row.customer_wallet || null,",
            "        fromAddress: row.from_address || null,",
            "        requestedNetwork: row.requested_network || null,",
            "        networkLabel: row.network_label || null,"
        ].join("\n")
    );
}

// 5. publicIntentPayload debe devolver metadata.
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

// 6. Panel: mostrar wallet origen y red detectada.
if (!text.includes("Wallet origen")) {
    text = text.replace(
        "<th>Wallet / Vault</th>",
        "<th>Wallet / Vault</th>\\n                    <th>Wallet origen</th>\\n                    <th>Carretera detectada</th>"
    );

    text = text.replace(
        "<td><code>${item.depositAddress}</code></td>",
        "<td><code>${item.depositAddress}</code></td>\\n<td><code>${item.sourceWallet || item.customerWallet || item.fromAddress || '-'}</code></td>\\n<td>${item.networkLabel || item.requestedNetwork || item.network || '-'}</td>"
    );

    text = text.replace(
        "<td><code>\\${item.depositAddress}</code></td>",
        "<td><code>\\${item.depositAddress}</code></td>\\n<td><code>\\${item.sourceWallet || item.customerWallet || item.fromAddress || '-'}</code></td>\\n<td>\\${item.networkLabel || item.requestedNetwork || item.network || '-'}</td>"
    );
}

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

const result = {
    ok: true,
    hasEnsureColumns: after.includes("function ensurePaymentIntentMetadataColumns"),
    hasUpdateMetadata: after.includes("function updatePaymentIntentMetadata"),
    callsUpdateMetadata: after.includes("updatePaymentIntentMetadata(intent.intentId, input);"),
    mapReturnsSourceWallet: after.includes("sourceWallet: row.source_wallet"),
    publicReturnsSourceWallet: after.includes("sourceWallet: intent.sourceWallet"),
    panelShowsWalletOrigen: after.includes("Wallet origen")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}