function fallbackDigest(data: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(data);
  const output = new Uint8Array(32);

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];

    h1 ^= value;
    h1 = Math.imul(h1, 0x01000193);

    h2 ^= value + i;
    h2 = Math.imul(h2, 0x85ebca6b);

    h3 ^= value + h1;
    h3 = Math.imul(h3, 0xc2b2ae35);

    h4 ^= value + h2;
    h4 = Math.imul(h4, 0x27d4eb2f);
  }

  const values = [
    h1, h2, h3, h4,
    h1 ^ h3, h2 ^ h4, h1 ^ h4, h2 ^ h3
  ];

  values.forEach((value, index) => {
    output[index * 4] = value & 255;
    output[index * 4 + 1] = (value >>> 8) & 255;
    output[index * 4 + 2] = (value >>> 16) & 255;
    output[index * 4 + 3] = (value >>> 24) & 255;
  });

  return output.buffer;
}

export function installWebCryptoDigestFallback() {
  const currentCrypto = globalThis.crypto as Crypto | undefined;

  if (!currentCrypto) {
    return;
  }

  if (currentCrypto.subtle && typeof currentCrypto.subtle.digest === 'function') {
    return;
  }

  Object.defineProperty(currentCrypto, 'subtle', {
    configurable: true,
    value: {
      digest: async (_algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
        const buffer =
          data instanceof ArrayBuffer
            ? data
            : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

        return fallbackDigest(buffer);
      }
    }
  });
}

installWebCryptoDigestFallback();
