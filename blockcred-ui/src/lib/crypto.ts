// src/lib/crypto.ts

export type EncryptedPayloadV1 = {
  v: 1;
  alg: "AES-256-GCM";
  iv: string;         // base64
  ciphertext: string; // base64
};

function bytesToBase64(u8: Uint8Array): string {
  // Avoid spread on large arrays; this is safe for our small values.
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // Ensures a strict ArrayBuffer (avoids ArrayBufferLike/SharedArrayBuffer typing issues)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function generateKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32)); // 256-bit
}

export function keyBytesToBase64(keyBytes: Uint8Array): string {
  return bytesToBase64(keyBytes);
}

export function keyBase64ToBytes(keyB64: string): Uint8Array {
  return base64ToBytes(keyB64);
}

export async function encryptJSON(
  payload: unknown,
  keyBytes: Uint8Array
): Promise<EncryptedPayloadV1> {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    throw new Error("encryptJSON: keyBytes must be 32 bytes (AES-256).");
  }

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce for GCM
  const rawKey = toArrayBuffer(keyBytes);

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ptU8 = new TextEncoder().encode(JSON.stringify(payload));
  const ptBuf = toArrayBuffer(ptU8);
  const ivBuf = toArrayBuffer(iv);

  const ctArrayBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    ptBuf
  );

  const ctU8 = new Uint8Array(ctArrayBuf);

  return {
    v: 1,
    alg: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ctU8),
  };
}

export async function decryptJSON(
  enc: EncryptedPayloadV1,
  keyBytes: Uint8Array
): Promise<any> {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    throw new Error("decryptJSON: keyBytes must be 32 bytes (AES-256).");
  }
  if (!enc || enc.v !== 1 || enc.alg !== "AES-256-GCM") {
    throw new Error("decryptJSON: unsupported payload.");
  }

  const ivU8 = base64ToBytes(enc.iv);
  const ctU8 = base64ToBytes(enc.ciphertext);
  const rawKey = toArrayBuffer(keyBytes);

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const ivBuf = toArrayBuffer(ivU8);
  const ctBuf = toArrayBuffer(ctU8);

  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    ctBuf
  );

  const ptStr = new TextDecoder().decode(ptBuf);
  return JSON.parse(ptStr);
}
