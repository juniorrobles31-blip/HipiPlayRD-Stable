"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta ruta del panel.");
}

let text = fs.readFileSync(file, "utf8");

if (!text.includes("function publicIntentPayload")) {
    throw new Error("No encontre function publicIntentPayload.");
}

if (!text.includes('url.pathname === "/api/public/intents"')) {
    throw new Error("No encontre ruta publica /api/public/intents.");
}

if (!text.includes("function hipiMetadataFile")) {
    const helper = `
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

`;

    text = text.replace(
        "function publicIntentPayload",
        helper + "function publicIntentPayload"
    );
}

if (!text.includes("intent = hipiEnrichIntentMetadata(intent);")) {
    text = text.replace(
        /function publicIntentPayload\s*\(\s*intent\s*\)\s*\{/,
        "function publicIntentPayload(intent) {\n    intent = hipiEnrichIntentMetadata(intent);"
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

if (!text.includes("HIPIPLAY_JSON_METADATA_AFTER_PUBLIC_CREATE")) {
    const pattern =
        /(const\s+intent\s*=\s*createIntent\s*\(\s*\{[\s\S]*?source:\s*"PWA"[\s\S]*?\}\s*\);)/;

    if (!pattern.test(text)) {
        throw new Error("No pude ubicar createIntent publico.");
    }

    text = text.replace(
        pattern,
        `$1

        // HIPIPLAY_JSON_METADATA_AFTER_PUBLIC_CREATE
        const hipiMetadata =
            hipiSaveIntentMetadata(
                intent.intentId,
                body
            );

        Object.assign(
            intent,
            hipiMetadata
        );`
    );
}

text = text.replace(
    "intents: listIntents(),",
    "intents: listIntents().map(hipiEnrichIntentMetadata),"
);

text = text.replace(
    /intents:\s*listIntents\(\)/g,
    "intents: listIntents().map(hipiEnrichIntentMetadata)"
);

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
    hasJsonMetadataFile: after.includes("function hipiMetadataFile"),
    hasSaveMetadata: after.includes("function hipiSaveIntentMetadata"),
    hasPublicHook: after.includes("HIPIPLAY_JSON_METADATA_AFTER_PUBLIC_CREATE"),
    publicEnriches: after.includes("intent = hipiEnrichIntentMetadata(intent);"),
    publicReturnsWallet: after.includes("sourceWallet: intent.sourceWallet"),
    dashboardEnriches: after.includes("listIntents().map(hipiEnrichIntentMetadata)"),
    panelShowsWalletOrigin: after.includes("<th>Wallet origen</th>"),
    noDbUsage: !after.includes("db.prepare(`\n        CREATE TABLE IF NOT EXISTS payment_intent_metadata")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}