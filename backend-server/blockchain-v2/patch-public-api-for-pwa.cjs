"use strict";

const fs = require("node:fs");

const panelFile = process.argv[2];

if (!panelFile) {
    throw new Error("Falta ruta del panel.");
}

let text = fs.readFileSync(panelFile, "utf8");

if (!text.includes("function publicIntentPayload(intent)")) {
    const helper = `
function publicIntentPayload(intent) {
    return {
        intentId: intent.intentId,
        playerId: intent.playerId,
        pwa: intent.pwa || intent.source || "HipiPlay",
        network: intent.network,
        chainId: intent.chainId,
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

`;

    if (!text.includes("async function handleApi")) {
        throw new Error("No encontre async function handleApi en el panel.");
    }

    text = text.replace(
        "async function handleApi",
        helper + "async function handleApi"
    );
}

if (!text.includes('url.pathname === "/api/public/intents"')) {
    const publicApiBlock = `
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

        sendJson(response, 201, {
            ok: true,
            intent: publicIntentPayload(intent)
        });

        return;
    }

    const publicIntentMatch =
        url.pathname.match(
            /^\\/api\\/public\\/intents\\/([^/]+)$/
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

`;

    if (!text.includes("requireConsoleToken(request);")) {
        throw new Error("No encontre requireConsoleToken(request); para insertar API publica antes.");
    }

    text = text.replace(
        "    requireConsoleToken(request);",
        publicApiBlock + "    requireConsoleToken(request);"
    );
}

fs.writeFileSync(panelFile, text, "utf8");

console.log(JSON.stringify({
    ok: true,
    publicIntentPayload: text.includes("function publicIntentPayload(intent)"),
    publicApi: text.includes('url.pathname === "/api/public/intents"')
}, null, 2));