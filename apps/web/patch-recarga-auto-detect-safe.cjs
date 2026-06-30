"use strict";

const fs = require("node:fs");

const appFile = process.argv[2];

if (!appFile) {
    throw new Error("Falta ruta de App.tsx.");
}

let text = fs.readFileSync(appFile, "utf8");

function findFunctionBlock(source, functionName) {
    const start = source.indexOf("function " + functionName);
    if (start < 0) {
        throw new Error("No encontre function " + functionName);
    }

    const braceStart = source.indexOf("{", start);
    if (braceStart < 0) {
        throw new Error("No encontre apertura de " + functionName);
    }

    let depth = 0;

    for (let i = braceStart; i < source.length; i++) {
        const ch = source[i];

        if (ch === "{") {
            depth++;
        }

        if (ch === "}") {
            depth--;

            if (depth === 0) {
                return {
                    start,
                    end: i + 1,
                    block: source.slice(start, i + 1)
                };
            }
        }
    }

    throw new Error("No pude cerrar function " + functionName);
}

const fn = findFunctionBlock(text, "WalletActionModal");
let block = fn.block;

if (!block.includes("if (action === 'deposit')")) {
    throw new Error("No encontre bloque deposit dentro de WalletActionModal.");
}

if (!block.includes("/blockchain-pay/api/public/intents")) {
    throw new Error("La recarga no esta conectada a Blockchain Pay dentro del modal.");
}

// Estados nuevos solamente dentro del modal.
if (!block.includes("const [depositSourceWallet, setDepositSourceWallet] = useState('');")) {
    block = block.replace(
        "  const [status, setStatus] = useState('');",
        [
            "  const [status, setStatus] = useState('');",
            "  const [depositSourceWallet, setDepositSourceWallet] = useState('');",
            "  const [depositDetectedNetwork, setDepositDetectedNetwork] = useState('');",
            "  const [depositDetectedLabel, setDepositDetectedLabel] = useState('');",
            "  const [depositDetectStatus, setDepositDetectStatus] = useState<'idle' | 'valid' | 'warning' | 'invalid'>('idle');",
            "  const [depositDetectMessage, setDepositDetectMessage] = useState('');",
            "  const [depositIntent, setDepositIntent] = useState<any | null>(null);"
        ].join("\n")
    );
}

// Detector solamente dentro del modal.
if (!block.includes("function detectDepositNetworkFromWallet")) {
    block = block.replace(
        "  async function postJson(url: string, payload: any) {",
        `  function detectDepositNetworkFromWallet(rawWallet: string) {
    const value = String(rawWallet || '').trim();

    if (!value) {
      return {
        network: '',
        label: '',
        status: 'idle' as const,
        message: 'Escribe tu wallet para detectar la carretera.'
      };
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      return {
        network: 'BSC',
        label: 'BSC / BEP20',
        status: 'valid' as const,
        message: 'Carretera detectada correctamente.'
      };
    }

    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) {
      return {
        network: 'TRON',
        label: 'TRON / TRC20',
        status: 'warning' as const,
        message: 'TRON detectada. Falta activar generador y verificador TRON en backend.'
      };
    }

    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      return {
        network: 'SOLANA',
        label: 'Solana',
        status: 'warning' as const,
        message: 'Solana detectada. Falta activar generador y verificador Solana en backend.'
      };
    }

    return {
      network: '',
      label: '',
      status: 'invalid' as const,
      message: 'No pudimos identificar la carretera de esa wallet.'
    };
  }

  function updateDepositWalletDetection(nextWallet: string) {
    const detected = detectDepositNetworkFromWallet(nextWallet);

    setDepositSourceWallet(nextWallet);
    setDepositDetectedNetwork(detected.network);
    setDepositDetectedLabel(detected.label);
    setDepositDetectStatus(detected.status);
    setDepositDetectMessage(detected.message);
    setDepositIntent(null);
    setStatus('');
  }

  async function postJson(url: string, payload: any) {`
    );
}

// Texto del modal.
block = block.replace(
    "deposit: 'Genera una wallet unica de pago USDT sin salir de la PWA.'",
    "deposit: 'Escribe tu wallet, detectamos la carretera y generamos la wallet de pago.'"
);

block = block.replace(
    "deposit: 'Genera una orden de recarga USDT.'",
    "deposit: 'Escribe tu wallet, detectamos la carretera y generamos la wallet de pago.'"
);

// Reemplazar submit deposit.
const startMarker = "      if (action === 'deposit') {";
const nextMarker = "      if (action === 'sell-p2p') {";

const start = block.indexOf(startMarker);
const end = block.indexOf(nextMarker, start);

if (start === -1 || end === -1 || end <= start) {
    throw new Error("No pude ubicar correctamente el bloque deposit.");
}

const newDepositBlock = `      if (action === 'deposit') {
        const sourceWallet = depositSourceWallet.trim();
        const detected = detectDepositNetworkFromWallet(sourceWallet);

        if (depositIntent) {
          const existingAddress =
            depositIntent.depositAddress ||
            depositIntent.address ||
            depositIntent.walletAddress ||
            depositIntent.toAddress ||
            '';

          const existingIntentId =
            depositIntent.intentId ||
            depositIntent.orderId ||
            depositIntent.id ||
            '';

          setStatus(
            \`Recarga en espera de pago.\\n\\nCarretera: \${depositIntent.networkLabel || depositIntent.network || depositDetectedLabel}\\nWallet origen: \${depositIntent.sourceWallet || sourceWallet}\\nIntent: \${existingIntentId || 'PENDIENTE'}\\nMonto: \${depositIntent.expectedAmount || depositIntent.amount || safeAmount} USDT\\nEstado: \${depositIntent.status || 'PAYMENT_PENDING'}\\n\\nWallet destino:\\n\${existingAddress}\\n\\nNo se generara otra wallet para esta misma recarga.\`
          );

          return;
        }

        if (!sourceWallet) {
          setStatus('Escribe tu wallet origen para detectar la carretera.');
          setLoading(false);
          return;
        }

        if (detected.status !== 'valid' || !detected.network) {
          setDepositDetectedNetwork(detected.network);
          setDepositDetectedLabel(detected.label);
          setDepositDetectStatus(detected.status);
          setDepositDetectMessage(detected.message);

          setStatus(detected.message);
          setLoading(false);
          return;
        }

        data = await postJson('/blockchain-pay/api/public/intents', {
          playerId: user.id,
          userId: user.id,
          visibleId: user.username,
          amount: safeAmount,
          network: detected.network,
          networkLabel: detected.label,
          token: 'USDT',
          tokenSymbol: 'USDT',
          sourceWallet,
          customerWallet: sourceWallet,
          fromAddress: sourceWallet,
          pwa: 'HipiPlay'
        });

        const order = data.intent || data.order || data.deposit || data;

        const payAddress =
          order.address ||
          order.depositAddress ||
          order.walletAddress ||
          order.toAddress ||
          '';

        const intentId =
          order.intentId ||
          order.orderId ||
          order.id ||
          data.intentId ||
          data.orderId ||
          '';

        const normalizedOrder = {
          ...order,
          intentId,
          depositAddress: payAddress,
          sourceWallet,
          network: detected.network,
          networkLabel: detected.label,
          token: 'USDT',
          expectedAmount: order.expectedAmount || order.amount || safeAmount,
          status: order.status || 'PAYMENT_PENDING'
        };

        setDepositIntent(normalizedOrder);

        setStatus(
          \`Wallet de pago generada.\\n\\nCarretera: \${detected.label}\\nWallet origen: \${sourceWallet}\\nIntent: \${intentId || 'PENDIENTE'}\\nMonto: \${normalizedOrder.expectedAmount} USDT\\nEstado: \${normalizedOrder.status}\\n\\nEnviar USDT a esta wallet destino:\\n\${payAddress}\\n\\nCuando el pago sea detectado, la recarga pasara a PAID y se acreditaran las fichas compradas.\`
        );

        return;
      }

`;

block = block.slice(0, start) + newDepositBlock + block.slice(end);

// Reemplazar formulario de recarga.
const oldDepositForm = `        {action === 'deposit' && (
          <label>
            Cantidad USDT a recargar
            <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="100" />
          </label>
        )}`;

const newDepositForm = `        {action === 'deposit' && (
          <>
            <label>
              Tu wallet
              <input
                value={depositSourceWallet}
                disabled={loading || !!depositIntent}
                onChange={e => updateDepositWalletDetection(e.target.value.trim())}
                placeholder="0x... wallet desde donde enviaras USDT"
              />
            </label>

            {depositDetectStatus !== 'idle' && (
              <div
                className="wallet-action-balance"
                style={{
                  borderColor: depositDetectStatus === 'valid' ? '#22c55e' : depositDetectStatus === 'warning' ? '#f59e0b' : '#ef4444',
                  color: depositDetectStatus === 'valid' ? '#22c55e' : depositDetectStatus === 'warning' ? '#f59e0b' : '#ef4444'
                }}
              >
                <strong>
                  {depositDetectStatus === 'valid' ? 'Carretera detectada: ' : 'Aviso: '}
                  {depositDetectedLabel || 'No identificada'}
                </strong>
                <small>{depositDetectMessage}</small>
              </div>
            )}

            {depositDetectStatus === 'valid' && (
              <label>
                Cantidad USDT a recargar
                <input
                  type="number"
                  min={1}
                  value={amount}
                  disabled={loading || !!depositIntent}
                  onChange={e => {
                    setAmount(e.target.value);
                    setDepositIntent(null);
                    setStatus('');
                  }}
                  placeholder="100"
                />
              </label>
            )}

            {depositIntent && (
              <div className="wallet-action-balance">
                <div><strong>Wallet destino generada</strong></div>
                <small>Carretera: {depositIntent.networkLabel || depositIntent.network || depositDetectedLabel}</small>
                <small>Estado: {depositIntent.status || 'PAYMENT_PENDING'}</small>
                <small>Intent: {depositIntent.intentId || depositIntent.orderId || depositIntent.id}</small>
                <code style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {depositIntent.depositAddress || depositIntent.address || depositIntent.walletAddress || depositIntent.toAddress}
                </code>
              </div>
            )}
          </>
        )}`;

if (!block.includes(oldDepositForm)) {
    throw new Error("No encontre el formulario simple de deposit para reemplazarlo.");
}

block = block.replace(oldDepositForm, newDepositForm);

// Status multilinea solo dentro del modal.
block = block.replace(
    `{status && <div className="wallet-action-modal-status">{status}</div>}`,
    `{status && <pre className="wallet-action-modal-status" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{status}</pre>}`
);

// Variables de control antes del return del modal.
if (!block.includes("const isDepositAction = String(action) === 'deposit';")) {
    block = block.replace(
        "  return (\n    <div className=\"wallet-action-modal-backdrop\">",
        [
            "  const isDepositAction = String(action) === 'deposit';",
            "  const depositCanGenerate = depositDetectStatus === 'valid' && !!amount && !depositIntent;",
            "",
            "  return (",
            "    <div className=\"wallet-action-modal-backdrop\">"
        ].join("\n")
    );
}

// Importante: reemplazar disabled SOLO dentro del modal.
block = block.replace(
    /disabled=\{loading\}/g,
    "disabled={loading || (isDepositAction && !depositCanGenerate)}"
);

// Texto del boton principal dentro del modal.
block = block.replace(
    /\{loading\s*\?\s*'Procesando\.\.\.'\s*:\s*'Continuar'\}/g,
    "{loading ? 'Procesando...' : isDepositAction ? (depositIntent ? 'Esperando pago' : 'Generar wallet de pago') : 'Continuar'}"
);

block = block.replace(
    /\{loading\s*\?\s*"Procesando\.\.\."\s*:\s*"Continuar"\}/g,
    '{loading ? "Procesando..." : isDepositAction ? (depositIntent ? "Esperando pago" : "Generar wallet de pago") : "Continuar"}'
);

// Limpieza visible solo dentro del modal.
block = block
    .replace(/EnvÃ­a/g, "Envia")
    .replace(/nÃºmeros/g, "numeros")
    .replace(/operaciÃ³n/g, "operacion")
    .replace(/direcciÃ³n/g, "direccion")
    .replace(/DirecciÃ³n/g, "Direccion")
    .replace(/despuÃ©s/g, "despues")
    .replace(/vÃ¡lido/g, "valido")
    .replace(/âœ“/g, "OK");

text = text.slice(0, fn.start) + block + text.slice(fn.end);

fs.writeFileSync(appFile, text, "utf8");

const after = fs.readFileSync(appFile, "utf8");

const result = {
    ok: true,
    hasDetector: after.includes("function detectDepositNetworkFromWallet"),
    hasWalletInput: after.includes("Tu wallet"),
    hasGreenDetection: after.includes("Carretera detectada"),
    sendsNetworkAuto: after.includes("network: detected.network"),
    sendsSourceWallet: after.includes("sourceWallet") && after.includes("customerWallet") && after.includes("fromAddress"),
    buttonSafeVariable: after.includes("const isDepositAction = String(action) === 'deposit';"),
    noBadGlobalLoginPatch: !after.includes("quickLogin} disabled={loading || (action === 'deposit'")
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}