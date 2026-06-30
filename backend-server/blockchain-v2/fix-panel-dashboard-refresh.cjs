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

if (!text.includes('const data = await api("/api/dashboard");')) {
    console.log("Aviso: no encontre llamada exacta /api/dashboard; puede estar ya parcheada.");
} else {
    text = text.replace(
        'const data = await api("/api/dashboard");',
        'const data = await api("/api/dashboard?ts=" + Date.now());'
    );
}

if (text.includes("const rows = data.intents.map(item => {")) {
    text = text.replace(
        "const rows = data.intents.map(item => {",
        "const rows = (data.intents || []).slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || ''))).map(item => {"
    );
}

if (!text.includes("HIPIPLAY_DASHBOARD_AUTO_REFRESH")) {
    const marker = "loadDashboard();";

    const index = text.lastIndexOf(marker);

    if (index === -1) {
        throw new Error("No encontre loadDashboard(); para agregar refresco automatico.");
    }

    const replacement =
        "loadDashboard();\\n" +
        "window.HIPIPLAY_DASHBOARD_AUTO_REFRESH = setInterval(loadDashboard, 3000);";

    text =
        text.slice(0, index) +
        replacement +
        text.slice(index + marker.length);
}

if (!text.includes("HIPIPLAY_NO_STORE_HEADERS")) {
    text = text.replace(
        /function sendJson\s*\(([^)]*)\)\s*\{\s*\n/,
        function(match) {
            return match +
                '    // HIPIPLAY_NO_STORE_HEADERS\\n' +
                '    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");\\n' +
                '    response.setHeader("Pragma", "no-cache");\\n' +
                '    response.setHeader("Expires", "0");\\n';
        }
    );

    text = text.replace(
        /function sendHtml\s*\(([^)]*)\)\s*\{\s*\n/,
        function(match) {
            return match +
                '    // HIPIPLAY_NO_STORE_HEADERS\\n' +
                '    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");\\n' +
                '    response.setHeader("Pragma", "no-cache");\\n' +
                '    response.setHeader("Expires", "0");\\n';
        }
    );
}

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

console.log(JSON.stringify({
    ok: true,
    dashboardNoCache: after.includes('/api/dashboard?ts='),
    autoRefresh: after.includes("HIPIPLAY_DASHBOARD_AUTO_REFRESH"),
    noStoreHeaders: after.includes("HIPIPLAY_NO_STORE_HEADERS"),
    sortedIntents: after.includes("slice().sort")
}, null, 2));