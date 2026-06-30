"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta ruta del panel.");
}

let text = fs.readFileSync(file, "utf8");

if (!text.includes("function listIntents()")) {
    throw new Error("No encontre function listIntents().");
}

if (!text.includes('url.pathname === "/api/dashboard"')) {
    throw new Error("No encontre ruta /api/dashboard.");
}

// 1. Dashboard sin cache desde el navegador.
text = text.replace(
    /api\((["'])\/api\/dashboard\1\)/g,
    'api("/api/dashboard?ts=" + Date.now())'
);

// 2. Ordenar intents recientes primero en la tabla.
text = text.replace(
    /const rows\s*=\s*data\.intents\.map\(item\s*=>\s*\{/g,
    "const rows = (data.intents || []).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || ''))).map(item => {"
);

text = text.replace(
    /const rows\s*=\s*\(data\.intents\s*\|\|\s*\[\]\)\.map\(item\s*=>\s*\{/g,
    "const rows = (data.intents || []).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || ''))).map(item => {"
);

// 3. No-store headers para JSON.
if (!text.includes("HIPIPLAY_JSON_NO_STORE")) {
    text = text.replace(
        /function sendJson\s*\(([^)]*)\)\s*\{\s*\n/,
        function(match) {
            return match +
                '    // HIPIPLAY_JSON_NO_STORE\n' +
                '    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");\n' +
                '    response.setHeader("Pragma", "no-cache");\n' +
                '    response.setHeader("Expires", "0");\n';
        }
    );
}

// 4. No-store headers para HTML.
if (!text.includes("HIPIPLAY_HTML_NO_STORE")) {
    text = text.replace(
        /function sendHtml\s*\(([^)]*)\)\s*\{\s*\n/,
        function(match) {
            return match +
                '    // HIPIPLAY_HTML_NO_STORE\n' +
                '    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");\n' +
                '    response.setHeader("Pragma", "no-cache");\n' +
                '    response.setHeader("Expires", "0");\n';
        }
    );
}

// 5. Limpiar textos raros que todavia quedaron.
text = text
    .replace(/generaciion/g, "generacion")
    .replace(/producciion/g, "produccion")
    .replace(/Aqui puedes probar generacion de wallet, estado del pago y ledger V2 sin tocar produccion\./g, "Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion.")
    .replace(/Panel intermedio para probar compras, generacion de wallet\/vault y estatus de pagos\./g, "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos.");

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

console.log(JSON.stringify({
    ok: true,
    dashboardNoCache: after.includes('/api/dashboard?ts='),
    jsonNoStore: after.includes("HIPIPLAY_JSON_NO_STORE"),
    htmlNoStore: after.includes("HIPIPLAY_HTML_NO_STORE"),
    sortedRows: after.includes("slice().sort")
}, null, 2));