"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ethers } = require("ethers");

const SERVER_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data", "blockchain-v2");

const WALLETS_FILE = path.join(DATA_DIR, "custody-wallets-bsc.json");
const MASTER_KEY_FILE = path.join(__dirname, "custody-master-key.hex");
const CHAIN_CONFIG_FILE = path.join(__dirname, "custody-chain.config.json");
const WITHDRAW_CONFIG_FILE = path.join(__dirname, "custody-withdrawal.config.json");
const PLANS_FILE = path.join(DATA_DIR, "custody-withdrawal-plans.json");
const AUDIT_FILE = path.join(DATA_DIR, "custody-withdrawal-audit.json");

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)"
];

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();

  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendAudit(entry) {
  const audit = readJson(AUDIT_FILE, []);

  audit.unshift({
    id: "wd_audit_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
    ...entry,
    createdAt: nowIso()
  });

  writeJson(AUDIT_FILE, audit.slice(0, 20000));
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function loadWallets() {
  const wallets = readJson(WALLETS_FILE, []);

  if (!Array.isArray(wallets)) {
    throw new Error("custody-wallets-bsc.json debe ser un arreglo.");
  }

  return wallets;
}

function saveWallets(wallets) {
  writeJson(WALLETS_FILE, wallets);
}

function loadChainConfig() {
  const config = readJson(CHAIN_CONFIG_FILE, null);

  if (!config) {
    throw new Error("No existe custody-chain.config.json");
  }

  if (!config.rpcUrl || String(config.rpcUrl).includes("PON_AQUI")) {
    throw new Error("rpcUrl no configurado en custody-chain.config.json");
  }

  return config;
}

function loadWithdrawConfig() {
  return readJson(WITHDRAW_CONFIG_FILE, {
    broadcastEnabled: false,
    payoutWalletId: null,
    payoutWalletAddress: null,
    maxSourcesPerWithdrawal: 12,
    minSourceGasBNB: "0.0008",
    confirmationsToWait: 1,
    directToCustomerIfOneSource: false
  });
}

function saveWithdrawConfig(config) {
  writeJson(WITHDRAW_CONFIG_FILE, config);
}

function loadPlans() {
  return readJson(PLANS_FILE, {});
}

function savePlans(plans) {
  writeJson(PLANS_FILE, plans);
}

function getMasterKey() {
  const hex =
    fs.readFileSync(MASTER_KEY_FILE, "utf8")
      .replace(/^\uFEFF/, "")
      .trim();

  if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error("custody-master-key.hex debe tener 32 bytes hex.");
  }

  return Buffer.from(hex, "hex");
}

function encryptPrivateKey(privateKey) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    alg: "AES-256-GCM",
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex")
  };
}

function decryptPrivateKey(payload) {
  if (!payload || payload.alg !== "AES-256-GCM") {
    throw new Error("Formato de privateKeyEncrypted no soportado.");
  }

  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const data = Buffer.from(payload.data, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function parseTokenAmount(value, decimals) {
  return ethers.parseUnits(String(value || "0").trim(), decimals);
}

function formatTokenAmount(value, decimals) {
  return ethers.formatUnits(BigInt(String(value || "0")), decimals);
}

function parseNativeAmount(value) {
  return ethers.parseEther(String(value || "0").trim());
}

function walletAvailableUSDTAtomic(wallet, decimals) {
  const balance =
    wallet.balanceUSDTAtomic
      ? BigInt(String(wallet.balanceUSDTAtomic))
      : parseTokenAmount(wallet.balanceUSDT || "0", decimals);

  const reserved =
    wallet.reservedUSDTAtomic
      ? BigInt(String(wallet.reservedUSDTAtomic))
      : parseTokenAmount(wallet.reservedUSDT || "0", decimals);

  const available = balance - reserved;

  return available > 0n ? available : 0n;
}

function makeWalletRecord(role) {
  const wallet = ethers.Wallet.createRandom();
  const signingKey = new ethers.SigningKey(wallet.privateKey);

  const now = nowIso();

  return {
    walletId: "cw_bsc_" + role.toLowerCase() + "_" + Date.now() + "_" + crypto.randomBytes(6).toString("hex"),
    index: null,
    network: "BSC",
    networkLabel: "BSC / BEP20",
    chainId: 56,
    nativeSymbol: "BNB",
    token: "USDT",
    tokenSymbol: "USDT",
    tokenDecimals: 18,
    tokenContract: "0x55d398326f99059fF775485246999027B3197955",
    address: wallet.address,
    addressLower: normalizeAddress(wallet.address),
    publicKey: signingKey.publicKey,
    privateKeyEncrypted: encryptPrivateKey(wallet.privateKey),
    role,
    status: "ACTIVE",
    canReceive: true,
    canHoldFunds: true,
    canSignWithdrawals: true,
    balanceUSDT: "0",
    balanceBNB: "0",
    balanceUSDTAtomic: "0",
    balanceBNBAtomic: "0",
    reservedUSDT: "0",
    reservedUSDTAtomic: "0",
    assignedIntentId: null,
    assignedPlayerId: null,
    createdAt: now,
    updatedAt: now
  };
}

function publicWallet(wallet) {
  return {
    walletId: wallet.walletId,
    address: wallet.address,
    publicKey: wallet.publicKey,
    role: wallet.role,
    status: wallet.status,
    balanceUSDT: wallet.balanceUSDT,
    balanceBNB: wallet.balanceBNB,
    reservedUSDT: wallet.reservedUSDT,
    canReceive: wallet.canReceive,
    canHoldFunds: wallet.canHoldFunds,
    canSignWithdrawals: wallet.canSignWithdrawals
  };
}

function verifyKeys() {
  const wallets = loadWallets();

  const result = {
    ok: true,
    totalWallets: wallets.length,
    verified: 0,
    invalid: []
  };

  for (const item of wallets) {
    try {
      if (!item.privateKeyEncrypted) {
        result.invalid.push({
          walletId: item.walletId,
          address: item.address,
          error: "privateKeyEncrypted missing"
        });
        result.ok = false;
        continue;
      }

      const pk = decryptPrivateKey(item.privateKeyEncrypted);
      const wallet = new ethers.Wallet(pk);

      if (normalizeAddress(wallet.address) !== normalizeAddress(item.address)) {
        result.invalid.push({
          walletId: item.walletId,
          address: item.address,
          derivedAddress: wallet.address
        });
        result.ok = false;
      }
      else {
        result.verified++;
      }
    }
    catch (error) {
      result.invalid.push({
        walletId: item.walletId,
        address: item.address,
        error: error.message
      });
      result.ok = false;
    }
  }

  return result;
}

function ensurePayoutWallet() {
  const wallets = loadWallets();
  const config = loadWithdrawConfig();

  let payout = null;

  if (config.payoutWalletId) {
    payout =
      wallets.find(item =>
        String(item.walletId) === String(config.payoutWalletId)
      ) || null;
  }

  if (!payout && config.payoutWalletAddress) {
    payout =
      wallets.find(item =>
        normalizeAddress(item.address) === normalizeAddress(config.payoutWalletAddress)
      ) || null;
  }

  if (payout) {
    return {
      ok: true,
      created: false,
      payoutWallet: publicWallet(payout),
      configFile: WITHDRAW_CONFIG_FILE
    };
  }

  payout = makeWalletRecord("PAYOUT_HOT");
  payout.index = wallets.length;

  wallets.push(payout);

  config.payoutWalletId = payout.walletId;
  config.payoutWalletAddress = payout.address;

  saveWallets(wallets);
  saveWithdrawConfig(config);

  appendAudit({
    type: "PAYOUT_WALLET_CREATED",
    walletId: payout.walletId,
    address: payout.address
  });

  return {
    ok: true,
    created: true,
    payoutWallet: publicWallet(payout),
    configFile: WITHDRAW_CONFIG_FILE
  };
}

async function getProviderAndToken() {
  const chain = loadChainConfig();

  const provider = new ethers.JsonRpcProvider(
    chain.rpcUrl,
    Number(chain.chainId)
  );

  const network = await provider.getNetwork();

  if (Number(network.chainId) !== Number(chain.chainId)) {
    throw new Error(
      "RPC incorrecto. Esperado " +
      chain.chainId +
      ", recibido " +
      String(network.chainId)
    );
  }

  const token = new ethers.Contract(
    chain.usdtContract,
    ERC20_ABI,
    provider
  );

  let decimals = Number(chain.usdtDecimals || 18);

  try {
    decimals = Number(await token.decimals());
  }
  catch {
    decimals = Number(chain.usdtDecimals || 18);
  }

  return {
    chain,
    provider,
    token,
    decimals
  };
}

async function syncBalances() {
  const { provider, token, decimals } = await getProviderAndToken();
  const wallets = loadWallets();

  for (const wallet of wallets) {
    if (!ethers.isAddress(wallet.address)) {
      continue;
    }

    const [nativeBalance, tokenBalance] = await Promise.all([
      provider.getBalance(wallet.address),
      token.balanceOf(wallet.address)
    ]);

    wallet.balanceBNBAtomic = nativeBalance.toString();
    wallet.balanceBNB = ethers.formatEther(nativeBalance);
    wallet.balanceUSDTAtomic = tokenBalance.toString();
    wallet.balanceUSDT = ethers.formatUnits(tokenBalance, decimals);
    wallet.balanceLastSyncedAt = nowIso();
    wallet.updatedAt = nowIso();
  }

  saveWallets(wallets);

  return {
    ok: true,
    syncedWallets: wallets.length,
    wallets: wallets.map(publicWallet)
  };
}

async function planWithdrawal(withdrawalId, amountText, destinationAddress, playerId) {
  if (!withdrawalId) {
    throw new Error("withdrawalId es obligatorio.");
  }

  if (!ethers.isAddress(destinationAddress)) {
    throw new Error("destinationAddress invalida.");
  }

  ensurePayoutWallet();

  const config = loadWithdrawConfig();
  const { decimals } = await getProviderAndToken();

  await syncBalances();

  const wallets = loadWallets();
  const plans = loadPlans();

  if (plans[withdrawalId]) {
    throw new Error("Ya existe un plan con withdrawalId: " + withdrawalId);
  }

  const payout =
    wallets.find(item =>
      String(item.walletId) === String(config.payoutWalletId)
    );

  if (!payout) {
    throw new Error("No existe payout wallet configurada.");
  }

  const requestedAtomic = parseTokenAmount(amountText, decimals);

  if (requestedAtomic <= 0n) {
    throw new Error("Monto invalido.");
  }

  const maxSources =
    Math.max(1, Number(config.maxSourcesPerWithdrawal || 12));

  const minGasBNBAtomic =
    parseNativeAmount(config.minSourceGasBNB || "0.0008");

  const candidates =
    wallets
      .filter(wallet =>
        wallet.role !== "PAYOUT_HOT" &&
        wallet.role !== "GAS_HOT" &&
        wallet.status !== "LOCKED" &&
        wallet.status !== "DISABLED" &&
        wallet.canSignWithdrawals !== false &&
        wallet.privateKeyEncrypted &&
        ethers.isAddress(wallet.address)
      )
      .map(wallet => ({
        wallet,
        availableAtomic: walletAvailableUSDTAtomic(wallet, decimals),
        bnbAtomic: BigInt(String(wallet.balanceBNBAtomic || "0"))
      }))
      .filter(item => item.availableAtomic > 0n)
      .sort((a, b) =>
        a.availableAtomic > b.availableAtomic
          ? -1
          : a.availableAtomic < b.availableAtomic
            ? 1
            : 0
      );

  let remaining = requestedAtomic;
  const selections = [];

  for (const item of candidates) {
    if (remaining <= 0n) break;

    if (selections.length >= maxSources) break;

    const take =
      item.availableAtomic >= remaining
        ? remaining
        : item.availableAtomic;

    selections.push({
      walletId: item.wallet.walletId,
      address: item.wallet.address,
      amountAtomic: take.toString(),
      amount: formatTokenAmount(take, decimals),
      currentUSDT: item.wallet.balanceUSDT || "0",
      currentBNB: item.wallet.balanceBNB || "0",
      gasOK: item.bnbAtomic >= minGasBNBAtomic,
      needsGasTopUp: item.bnbAtomic < minGasBNBAtomic
    });

    remaining -= take;
  }

  if (remaining > 0n) {
    throw new Error(
      "Fondos insuficientes. Faltan " +
      formatTokenAmount(remaining, decimals) +
      " USDT."
    );
  }

  for (const selection of selections) {
    const wallet =
      wallets.find(item =>
        String(item.walletId) === String(selection.walletId)
      );

    if (!wallet) continue;

    const currentReserved =
      wallet.reservedUSDTAtomic
        ? BigInt(String(wallet.reservedUSDTAtomic))
        : parseTokenAmount(wallet.reservedUSDT || "0", decimals);

    const nextReserved =
      currentReserved + BigInt(selection.amountAtomic);

    wallet.reservedUSDTAtomic = nextReserved.toString();
    wallet.reservedUSDT = formatTokenAmount(nextReserved, decimals);
    wallet.updatedAt = nowIso();
  }

  const plan = {
    withdrawalId,
    playerId: String(playerId || ""),
    destinationAddress: ethers.getAddress(destinationAddress),
    amount: ethers.formatUnits(requestedAtomic, decimals),
    amountAtomic: requestedAtomic.toString(),
    token: "USDT",
    network: "BSC",
    chainId: 56,
    status: "PLANNED",
    payoutWalletId: payout.walletId,
    payoutWalletAddress: payout.address,
    requiresConsolidation: true,
    selections,
    steps: [
      ...selections.map((item, index) => ({
        step: index + 1,
        type: "CONSOLIDATE_TO_PAYOUT",
        fromWalletId: item.walletId,
        from: item.address,
        to: payout.address,
        amount: item.amount,
        amountAtomic: item.amountAtomic,
        status: "PENDING",
        txHash: null
      })),
      {
        step: selections.length + 1,
        type: "FINAL_PAYOUT_TO_CUSTOMER",
        fromWalletId: payout.walletId,
        from: payout.address,
        to: ethers.getAddress(destinationAddress),
        amount: ethers.formatUnits(requestedAtomic, decimals),
        amountAtomic: requestedAtomic.toString(),
        status: "PENDING",
        txHash: null
      }
    ],
    broadcastEnabledAtPlanTime: config.broadcastEnabled === true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  plans[withdrawalId] = plan;

  saveWallets(wallets);
  savePlans(plans);

  appendAudit({
    type: "WITHDRAWAL_PLANNED",
    withdrawalId,
    playerId: plan.playerId,
    amount: plan.amount,
    destinationAddress: plan.destinationAddress,
    payoutWalletAddress: plan.payoutWalletAddress,
    sources: selections.length
  });

  return {
    ok: true,
    plan
  };
}

function getPlan(planId) {
  const plans = loadPlans();
  const plan = plans[planId];

  if (!plan) {
    throw new Error("No existe plan: " + planId);
  }

  return plan;
}

function dryRun(planId) {
  const config = loadWithdrawConfig();
  const plan = getPlan(planId);

  return {
    ok: true,
    dryRun: true,
    broadcastEnabled: config.broadcastEnabled === true,
    message:
      "Este dry-run NO mueve fondos. Solo muestra los pasos que se firmarian.",
    plan: {
      withdrawalId: plan.withdrawalId,
      playerId: plan.playerId,
      destinationAddress: plan.destinationAddress,
      amount: plan.amount,
      payoutWalletAddress: plan.payoutWalletAddress,
      status: plan.status,
      steps: plan.steps,
      gasWarnings: plan.selections.filter(item => item.needsGasTopUp)
    }
  };
}

async function executePlan(planId, args) {
  const config = loadWithdrawConfig();

  if (config.broadcastEnabled !== true) {
    throw new Error(
      "broadcastEnabled=false. No se moveran fondos. Activalo manualmente en custody-withdrawal.config.json solo para produccion."
    );
  }

  if (!args.includes("--i-understand-real-funds")) {
    throw new Error(
      "Falta confirmacion: --i-understand-real-funds"
    );
  }

  const { provider, token, decimals, chain } = await getProviderAndToken();
  const wallets = loadWallets();
  const plans = loadPlans();
  const plan = plans[planId];

  if (!plan) {
    throw new Error("No existe plan: " + planId);
  }

  if (plan.status === "COMPLETED") {
    return {
      ok: true,
      alreadyCompleted: true,
      plan
    };
  }

  if (!["PLANNED", "PARTIAL"].includes(plan.status)) {
    throw new Error("Plan no ejecutable en estado: " + plan.status);
  }

  plan.status = "PARTIAL";
  plan.executionStartedAt = plan.executionStartedAt || nowIso();

  for (const step of plan.steps) {
    if (step.status === "CONFIRMED") {
      continue;
    }

    const wallet =
      wallets.find(item =>
        String(item.walletId) === String(step.fromWalletId)
      );

    if (!wallet) {
      throw new Error("No encontre wallet fuente: " + step.fromWalletId);
    }

    const privateKey = decryptPrivateKey(wallet.privateKeyEncrypted);
    const signer = new ethers.Wallet(privateKey, provider);
    const tokenWithSigner = token.connect(signer);

    const amountAtomic = BigInt(String(step.amountAtomic));

    const tx = await tokenWithSigner.transfer(
      step.to,
      amountAtomic
    );

    step.status = "BROADCASTED";
    step.txHash = tx.hash;
    step.broadcastedAt = nowIso();

    savePlans(plans);

    const receipt = await tx.wait(Number(config.confirmationsToWait || 1));

    step.status = "CONFIRMED";
    step.confirmedAt = nowIso();
    step.blockNumber = receipt ? Number(receipt.blockNumber) : null;

    savePlans(plans);
  }

  plan.status = "COMPLETED";
  plan.completedAt = nowIso();
  plan.updatedAt = nowIso();

  for (const selection of plan.selections) {
    const wallet =
      wallets.find(item =>
        String(item.walletId) === String(selection.walletId)
      );

    if (!wallet) continue;

    const currentReserved =
      BigInt(String(wallet.reservedUSDTAtomic || "0"));

    const release =
      BigInt(String(selection.amountAtomic || "0"));

    const nextReserved =
      currentReserved > release
        ? currentReserved - release
        : 0n;

    wallet.reservedUSDTAtomic = nextReserved.toString();
    wallet.reservedUSDT = ethers.formatUnits(nextReserved, decimals);
    wallet.updatedAt = nowIso();
  }

  saveWallets(wallets);
  savePlans(plans);

  appendAudit({
    type: "WITHDRAWAL_COMPLETED",
    withdrawalId: plan.withdrawalId,
    amount: plan.amount,
    destinationAddress: plan.destinationAddress,
    chainId: Number(chain.chainId),
    steps: plan.steps.map(item => ({
      type: item.type,
      txHash: item.txHash,
      status: item.status
    }))
  });

  return {
    ok: true,
    executed: true,
    plan
  };
}

async function summary() {
  await syncBalances();

  const wallets = loadWallets();
  const config = loadWithdrawConfig();
  const chain = loadChainConfig();

  const groups = {};

  for (const wallet of wallets) {
    const role = wallet.role || "UNKNOWN";

    if (!groups[role]) {
      groups[role] = {
        count: 0,
        totalUSDT: 0,
        totalBNB: 0
      };
    }

    groups[role].count++;
    groups[role].totalUSDT += Number(wallet.balanceUSDT || 0);
    groups[role].totalBNB += Number(wallet.balanceBNB || 0);
  }

  return {
    ok: true,
    network: chain.network,
    chainId: Number(chain.chainId),
    broadcastEnabled: config.broadcastEnabled === true,
    payoutWalletId: config.payoutWalletId,
    payoutWalletAddress: config.payoutWalletAddress,
    groups,
    wallets: wallets.map(publicWallet)
  };
}

async function main() {
  const cmd = String(process.argv[2] || "help").toLowerCase();

  if (cmd === "verify-keys") {
    console.log(JSON.stringify(verifyKeys(), null, 2));
    return;
  }

  if (cmd === "ensure-payout") {
    console.log(JSON.stringify(ensurePayoutWallet(), null, 2));
    return;
  }

  if (cmd === "sync") {
    console.log(JSON.stringify(await syncBalances(), null, 2));
    return;
  }

  if (cmd === "summary") {
    console.log(JSON.stringify(await summary(), null, 2));
    return;
  }

  if (cmd === "plan") {
    const withdrawalId = process.argv[3];
    const amount = process.argv[4];
    const destinationAddress = process.argv[5];
    const playerId = process.argv[6] || "";

    console.log(JSON.stringify(
      await planWithdrawal(
        withdrawalId,
        amount,
        destinationAddress,
        playerId
      ),
      null,
      2
    ));
    return;
  }

  if (cmd === "dry-run") {
    const planId = process.argv[3];

    console.log(JSON.stringify(
      dryRun(planId),
      null,
      2
    ));
    return;
  }

  if (cmd === "execute") {
    const planId = process.argv[3];

    console.log(JSON.stringify(
      await executePlan(planId, process.argv.slice(4)),
      null,
      2
    ));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    usage: [
      "node custody-withdrawal-manager.js verify-keys",
      "node custody-withdrawal-manager.js ensure-payout",
      "node custody-withdrawal-manager.js sync",
      "node custody-withdrawal-manager.js summary",
      "node custody-withdrawal-manager.js plan WITHDRAWAL_ID AMOUNT_USDT DESTINATION_ADDRESS PLAYER_ID",
      "node custody-withdrawal-manager.js dry-run WITHDRAWAL_ID",
      "node custody-withdrawal-manager.js execute WITHDRAWAL_ID --i-understand-real-funds"
    ],
    safety: {
      broadcastEnabledDefault: false,
      privateKeysPrinted: false,
      executeRequires: [
        "broadcastEnabled=true",
        "--i-understand-real-funds"
      ]
    }
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));

  process.exit(1);
});