import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { Buffer } from "buffer";

// Browser polyfill for Buffer (needed by merkletreejs in Vite/React)
if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}

/**
 * Flatten selected paths from a nested credential object into:
 *  { "holder.name": "Sujal Basyal", ... }
 *
 * merkleFields is an array of dotted paths like:
 *  ["holder.name", "holder.studentId", "credential.courseName", ...]
 */
export function flattenFieldsForMerkle(
  credential: any,
  merkleFields: string[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const path of merkleFields) {
    const parts = path.split(".");
    let current: any = credential;

    for (const p of parts) {
      if (current && typeof current === "object") {
        current = current[p];
      } else {
        current = undefined;
        break;
      }
    }

    result[path] =
      current === undefined || current === null ? "" : String(current).trim();
  }

  return result;
}

/**
 * Build a Merkle tree from flattened fields and return:
 *  - root (0x-prefixed)
 *  - proofs: map path -> array of sibling hashes (0x-prefixed)
 *
 * Leaf = keccak256(`${path}:${value}`)
 * Tree uses sorted pairs to be deterministic.
 */
export function buildMerkleFromFields(
  flattened: Record<string, string>,
  merkleFields: string[]
): { root: string; proofs: Record<string, string[]> } {
  const leaves: Buffer[] = [];
  const leafByPath: Record<string, Buffer> = {};

  for (const path of merkleFields) {
    const value = flattened[path] ?? "";
    const leaf = keccak256(`${path}:${value}`);
    leaves.push(leaf);
    leafByPath[path] = leaf;
  }

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const rootBuf = tree.getRoot();
  const root = "0x" + rootBuf.toString("hex");

  const proofs: Record<string, string[]> = {};
  for (const path of merkleFields) {
    const leaf = leafByPath[path];
    const proofNodes = tree
      .getProof(leaf)
      .map((p) => "0x" + p.data.toString("hex"));
    proofs[path] = proofNodes;
  }

  return { root, proofs };
}

/** Shape of the selective-disclosure proof shared by the Holder. */
export interface DisclosedProof {
  merkleRoot: string;
  disclosedClaims: Record<string, string>;
  disclosedProofs: Record<string, string[]>;
}

// helper: hash of two 0x hex nodes, sorted
const hashPairSorted = (a: string, b: string): string => {
  const [left, right] = [a.toLowerCase(), b.toLowerCase()].sort();
  const leftBuf = Buffer.from(left.slice(2), "hex");
  const rightBuf = Buffer.from(right.slice(2), "hex");
  const combined = Buffer.concat([leftBuf, rightBuf]);
  return "0x" + keccak256(combined).toString("hex");
};

/**
 * Verify a selective-disclosure proof produced by HolderDashboard.handleGenerateProof.
 *
 * Expects:
 *  {
 *    merkleRoot: "0x...",
 *    disclosedClaims: { "holder.name": "Sujal", ... },
 *    disclosedProofs: { "holder.name": ["0x...", ...], ... }
 *  }
 *
 * Returns:
 *  { isValid: boolean; verifiedClaims: Record<string,string> }
 */
export function verifyDisclosedProof(
  proof: DisclosedProof
): { isValid: boolean; verifiedClaims: Record<string, string> } {
  if (
    !proof ||
    typeof proof !== "object" ||
    typeof proof.merkleRoot !== "string" ||
    typeof proof.disclosedClaims !== "object" ||
    typeof proof.disclosedProofs !== "object"
  ) {
    throw new Error("Malformed proof object");
  }

  const merkleRoot = proof.merkleRoot.toLowerCase();
  const verifiedClaims: Record<string, string> = {};

  for (const [path, value] of Object.entries(proof.disclosedClaims)) {
    const siblings = proof.disclosedProofs[path];
    if (!Array.isArray(siblings)) {
      return { isValid: false, verifiedClaims: {} };
    }

    // same leaf encoding as buildMerkleFromFields
    let computed = "0x" + keccak256(`${path}:${value}`).toString("hex");

    for (const sib of siblings) {
      const sibHex = sib.toLowerCase();
      computed = hashPairSorted(computed, sibHex);
    }

    if (computed.toLowerCase() !== merkleRoot) {
      return { isValid: false, verifiedClaims: {} };
    }

    verifiedClaims[path] = String(value);
  }

  return { isValid: true, verifiedClaims };
}

/* ---------- OPTIONAL legacy helpers, not used by current UI ---------- */

export interface CredentialFields {
  studentName: string;
  courseName: string;
  degree: string;
}

export function buildCredentialMerkleRoot(fields: CredentialFields): string {
  const merkleFields = ["studentName", "courseName", "degree"];
  const flattened: Record<string, string> = {};

  for (const key of merkleFields) {
    const value = (fields as any)[key] ?? "";
    flattened[key] = String(value).trim();
  }

  const { root } = buildMerkleFromFields(flattened, merkleFields);
  return root;
}

export function generateMerkleProof(
  allFields: CredentialFields,
  fieldsToShare: string[]
): { root: string; proof: Record<string, string[]> } {
  const merkleFields = ["studentName", "courseName", "degree"];
  const flattened: Record<string, string> = {};

  for (const key of merkleFields) {
    const value = (allFields as any)[key] ?? "";
    flattened[key] = String(value).trim();
  }

  const { root, proofs } = buildMerkleFromFields(flattened, merkleFields);
  const filtered: Record<string, string[]> = {};
  for (const f of fieldsToShare) {
    if (proofs[f]) filtered[f] = proofs[f];
  }
  return { root, proof: filtered };
}
