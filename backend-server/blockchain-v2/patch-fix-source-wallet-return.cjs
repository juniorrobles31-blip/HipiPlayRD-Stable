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

if (!text.includes("function updatePaymentIntentMetadata")) {
    throw new Error("No encontre updatePaymentIntentMetadata. Primero debe existir el parche de columnas.");
}

if (!text.includes("function publicIntentPayload")) {
    throw new Error("No encontre publicIntentPayload.");
}

// Helper para leer metadata directa desde SQLite y anexarla al intent.
if (!text.includes("function getPaymentIntentMetadata")) {
    const helper = `
function getPaymentIntentMetadata(intentId) {
    ensurePaymentIntentMetadataColumns();

    const row =
        db.prepare(\`
            SELECT
                source_wallet,
                customer_wallet,
                from_address,
                requested_network,
                network_label,
                pwa,
                visible_id
            FROM payment_intents
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

    const metadata =
        getPaymentIntentMetadata(intentId);

    return {
        ...intent,
        ...metadata
    };
}

function createIntentWithMetadata(input) {
    const intent =
        createIntent(input);

    if (!intent) {
        return intent;
    }

    const intentId =
        intent.intentId ||
        intent.id ||
        intent.intent_id;

    if (intentId) {
        const metadata =
            updatePaymentIntentMetadata(
                intentId,
                input || {}
            );

        return enrichPaymentIntentMetadata({
            ...intent,
            ...metadata
        });
    }

    return intent;
}

`;

    text = text.replace(
        "function publicIntentPayload",
        helper + "function publicIntentPayload"
    );
}

// Asegurar que publicIntentPayload siempre enriquezca el intent antes de responder.
if (!text.includes("intent = enrichPaymentIntentMetadata(intent);")) {
    text = text.replace(
        /function publicIntentPayload\s*\(\s*intent\s*\)\s*\{/,
        "function publicIntentPayload(intent) {\n    intent = enrichPaymentIntentMetadata(intent);"
    );
}

// Cambiar llamadas const intent = createIntent(...) por wrapper.
text = text.replace(
    /(const\s+intent\s*=\s*)createIntent\s*\(/g,
    "$1createIntentWithMetadata("
);

// Dashboard debe enriquecer listado.
text = text.replace(
    "intents: listIntents(),",
    "intents: listIntents().map(enrichPaymentIntentMetadata),"
);

// Tambien cubrir formato sin coma o con espacios.
text = text.replace(
    /intents:\s*listIntents\(\)/g,
    "intents: listIntents().map(enrichPaymentIntentMetadata)"
);

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

const result = {
    ok: true,
    hasGetMetadata: after.includes("function getPaymentIntentMetadata"),
    hasEnrichMetadata: after.includes("function enrichPaymentIntentMetadata"),
    hasWrapper: after.includes("function createIntentWithMetadata"),
    usesWrapper: after.includes("createIntentWithMetadata("),
    publicEnriches: after.includes("intent = enrichPaymentIntentMetadata(intent);"),
    dashboardEnriches: after.includes("listIntents().map(enrichPaymentIntentMetadata)")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}