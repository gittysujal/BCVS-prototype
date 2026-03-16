// src/lib/ipfsClient.ts
import { create } from "@storacha/client";
import { encryptJSON, generateKeyBytes, keyBytesToBase64 } from "./crypto";

// Reuse one client instance
const clientPromise = create();

// localStorage namespace: per-CID data encryption key (DEK)
const KEY_PREFIX = "bcvs:dek:";

function storeKeyForCid(cid: string, keyBytes: Uint8Array) {
  // Demo-friendly: persist DEK locally so you can later decrypt after fetching CID
  // GDPR erasure (prototype): deleting this key = cryptographic erasure
  const keyB64 = keyBytesToBase64(keyBytes);
  localStorage.setItem(`${KEY_PREFIX}${cid}`, keyB64);
}

/**
 * Uploads ENCRYPTED JSON to Storacha and returns the CID.
 * Minimal-change: same function name + same return type.
 */
export async function uploadJSONToIPFS(payload: unknown): Promise<string> {
  // ✅ Definitive log: if you don't see this, you're not calling THIS function.
  console.error("✅ ENCRYPTED UPLOAD FUNCTION CALLED (uploadJSONToIPFS)");

  const client = await clientPromise;

  const email = import.meta.env.VITE_STORACHA_EMAIL as string | undefined;
  if (!email) throw new Error("VITE_STORACHA_EMAIL is not set in .env.local");

  // Login (first time sends email; after uses stored auth)
  const account = await client.login(email as `${string}@${string}`);

  // Wait for plan (dev-safe)
  if (account.plan && account.plan.wait) {
    try {
      await account.plan.wait();
    } catch (e) {
      console.warn("plan.wait() failed or timed out:", e);
    }
  }

  // Ensure a current space
  const space = await client.createSpace("bcvs-dev", { account });
  await client.setCurrentSpace(space.did());

  // ---- Safety check: if payload contains obvious PII keys, we still encrypt it,
  // but this log proves the payload is indeed being processed here.
  try {
    const payloadStr = JSON.stringify(payload);
    console.log("🔎 Payload size (chars):", payloadStr.length);
    // Optional: uncomment if you want to prove plaintext would have been present:
    // console.log("🔎 Payload preview:", payloadStr.slice(0, 200));
  } catch {
    console.warn("Payload is not JSON-stringifiable (still attempting encrypt).");
  }

  // 1) Encrypt payload client-side (AES-256-GCM)
  const keyBytes = generateKeyBytes();
  const encrypted = await encryptJSON(payload, keyBytes);

  // ✅ Definitive log: encrypted object must contain ONLY iv/ciphertext (no PII)
  console.log("✅ Encrypted object keys:", Object.keys(encrypted));
  console.log("✅ Encrypted preview:", {
    v: encrypted.v,
    alg: encrypted.alg,
    iv_len: encrypted.iv?.length,
    ciphertext_len: encrypted.ciphertext?.length,
  });

  // 2) Upload encrypted JSON (NOT plaintext PII)
  const encryptedStr = JSON.stringify(encrypted);

  // ✅ Hard fail if encryption was bypassed somehow (should never trigger)
  // This is a guard for presentation safety.
  if (
    encryptedStr.includes('"holder"') ||
    encryptedStr.includes('"credential"') ||
    encryptedStr.includes('"studentId"') ||
    encryptedStr.includes('"name"') ||
    encryptedStr.includes('"gpa"')
  ) {
    throw new Error(
      "REFUSING TO UPLOAD: Encrypted payload still contains plaintext-like keys. Encryption is not applied."
    );
  }

  const blob = new Blob([encryptedStr], { type: "application/json" });

  const file = new File([blob], "credential.enc.json", {
    type: "application/json",
  });

  const cid = await client.uploadFile(file);
  const cidStr = cid.toString();

  // ✅ Definitive log: this is the CID of the ENCRYPTED payload
  console.log("✅ Uploaded ENCRYPTED CID:", cidStr);

  // 3) Store key locally (prototype only)
  storeKeyForCid(cidStr, keyBytes);

  return cidStr;
}

/**
 * OPTIONAL helper for GDPR demo: remove key => content becomes undecryptable.
 * Call this when a user requests erasure.
 */
export function destroyKeyForCid(cid: string) {
  localStorage.removeItem(`${KEY_PREFIX}${cid}`);
}
