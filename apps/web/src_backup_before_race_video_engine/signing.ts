export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getDeviceSecret(): Promise<string> {
  const key = 'j123_local_device_secret_v1';
  let secret = localStorage.getItem(key);
  if (!secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, secret);
  }
  return secret;
}

export async function signLocalPayload(payload: unknown) {
  const secret = await getDeviceSecret();
  const canonical = stableStringify(payload);
  const signature = await sha256Hex(`${canonical}.${secret}`);
  const deviceKeyHash = await sha256Hex(secret);
  return {
    signature,
    deviceKeyHash,
    signatureScheme: 'J123-LOCAL-SHA256-MVP',
    canonicalHash: await sha256Hex(canonical)
  };
}

export function newId(prefix: string) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
