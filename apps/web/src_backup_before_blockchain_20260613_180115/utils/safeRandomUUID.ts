export function safeRandomUUID(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
