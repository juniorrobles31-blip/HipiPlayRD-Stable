function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)));
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function deriveEncryptionKey(password, salt) {
  const encoder = new TextEncoder();

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 250000,
      hash: "SHA-256"
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function generateLocalEntropy() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function encryptSecret(secret, password) {
  const encoder = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encoder.encode(secret)
  );

  return {
    version: 1,
    salt: bufferToBase64(salt.buffer),
    iv: bufferToBase64(iv.buffer),
    encryptedSecret: bufferToBase64(encrypted)
  };
}

async function decryptSecret(payload, password) {
  const salt = new Uint8Array(base64ToBuffer(payload.salt));
  const iv = new Uint8Array(base64ToBuffer(payload.iv));
  const encryptedSecret = base64ToBuffer(payload.encryptedSecret);

  const key = await deriveEncryptionKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encryptedSecret
  );

  return new TextDecoder().decode(decrypted);
}

function saveEncryptedVault(payload) {
  localStorage.setItem("hipiplay_local_vault", JSON.stringify(payload));
}

function loadEncryptedVault() {
  const raw = localStorage.getItem("hipiplay_local_vault");
  if (!raw) return null;
  return JSON.parse(raw);
}

function deleteEncryptedVault() {
  localStorage.removeItem("hipiplay_local_vault");
}

window.HipiWalletVault = {
  generateLocalEntropy,
  encryptSecret,
  decryptSecret,
  saveEncryptedVault,
  loadEncryptedVault,
  deleteEncryptedVault
};
