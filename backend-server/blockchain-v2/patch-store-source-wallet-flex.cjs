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

function extractPaymentIntentMetadata(input) {
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

function updatePaymentIntentMetadata(intentId, input) {
    ensurePaymentIntentMetadataColumns();

    const metadata =
        extractPaymentIntentMetadata(input || {});

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
        metadata.sourceWallet,
        metadata.customerWallet,
        metadata.fromAddress,
        metadata.requestedNetwork,
        metadata.networkLabel,
        metadata.pwa,
        metadata.visibleId,
        new Date().toISOString(),
        intentId
    );

    return metadata;
}

`;

    text = text.replace(
        "function createIntent",
        helper + "function createIntent"
    );
}

if (!text.includes("ensurePaymentIntentMetadataColumns();")) {
    const createIndex = text.indexOf("function createIntent");
    const braceIndex = text.indexOf("{", createIndex);

    if (createIndex < 0 || braceIndex < 0) {
        throw new Error("No pude ubicar apertura de createIntent.");
    }

    text =
        text.slice(0, braceIndex + 1) +
        "\n    ensurePaymentIntentMetadataColumns();" +
        text.slice(braceIndex + 1);
}

if (!text.includes("HIPIPLAY_METADATA_AFTER_PAYMENT_INTENT_INSERT")) {
    text = text.replace(
        /insertFiltered\s*\(\s*["']payment_intents["']\s*,\s*\{[\s\S]*?\n\s*\}\s*\);/,
        function(match) {
            return match + `

    // HIPIPLAY_METADATA_AFTER_PAYMENT_INTENT_INSERT
    const hipiPaymentIntentInput =
        typeof input !== "undefined"
            ? input
            : (
                arguments &&
                arguments.length
                    ? arguments[0]
                    : {}
            );

    const hipiPaymentMetadata =
        updatePaymentIntentMetadata(
            intent.intentId,
            hipiPaymentIntentInput || {}
        );

    Object.assign(
        intent,
        hipiPaymentMetadata
    );`;
        }
    );
}

if (!text.includes("sourceWallet: row.source_wallet")) {
    text = text.replaceAll(
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
    hasEnsureColumns: after.includes("function ensurePaymentIntentMetadataColumns"),
    hasExtractMetadata: after.includes("function extractPaymentIntentMetadata"),
    hasUpdateMetadata: after.includes("function updatePaymentIntentMetadata"),
    callsUpdateMetadata: after.includes("HIPIPLAY_METADATA_AFTER_PAYMENT_INTENT_INSERT"),
    returnsSourceWalletFromRows: after.includes("sourceWallet: row.source_wallet"),
    publicReturnsSourceWallet: after.includes("sourceWallet: intent.sourceWallet"),
    panelShowsWalletOrigen: after.includes("<th>Wallet origen</th>")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}