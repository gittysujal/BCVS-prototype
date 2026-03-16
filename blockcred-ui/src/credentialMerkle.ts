// @ts-nocheck
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { Buffer } from "buffer";

// Ensure Buffer is available globally for merkletreejs in browser environments
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

/**
 * Flattens a nested JSON object based on a list of dot-notation paths.
 *
 * @param json The credential JSON object.
 * @param fieldPaths An array of strings representing the paths to extract (e.g., "holder.name").
 * @returns A flat object with keys as paths and values as the corresponding string values.
 */
export const flattenFieldsForMerkle = (
  json: any,
  fieldPaths: string[]
): Record<string, string> => {
  const flattened: Record<string, string> = {};

  for (const path of fieldPaths) {
    // Basic getter to handle nested paths like "holder.name"
    const value = path.split(".").reduce((obj, key) => obj && obj[key], json);

    // If value is null or undefined, treat it as the string "null" for hashing consistency
    if (value === undefined || value === null) {
      flattened[path] = "null";
    } else {
      flattened[path] = String(value);
    }
  }

  return flattened;
};

/**
 * Builds a Merkle tree from a set of fields and returns the root, leaves, and proofs.
 *
 * @param allFields A flat object of all fields that could be part of the tree.
 * @param fieldsToInclude The specific fields to include in this tree's calculations.
 * @returns An object containing the Merkle root, a map of leaves, and a map of proofs.
 */
export const buildMerkleFromFields = (
  allFields: Record<string, string>,
  fieldsToInclude: string[]
): {
  root: string;
  leaves: { [path: string]: string };
  proofs: { [path: string]: string[] };
} => {
  if (fieldsToInclude.length === 0) {
    return { root: "", leaves: {}, proofs: {} };
  }

  // 1. Create leaves for the Merkle tree
  const leaves = fieldsToInclude.map((path) => {
    const value = allFields[path];
    if (value === undefined) {
      throw new Error(`Field path "${path}" not found in provided data.`);
    }
    // Leaf format: keccak256(path + ":" + value)
    return keccak256(`${path}:${value}`);
  });

  // 2. Build the Merkle tree
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  // 3. Get the Merkle root
  const root = tree.getHexRoot();

  // 4. Generate proofs and map leaves for each included field
  const leafMap: { [path: string]: string } = {};
  const proofMap: { [path: string]: string[] } = {};

  fieldsToInclude.forEach((path, index) => {
    const leaf = leaves[index];
    const proof = tree.getHexProof(leaf);
    leafMap[path] = `0x${leaf.toString("hex")}`;
    proofMap[path] = proof;
  });

  return {
    root,
    leaves: leafMap,
    proofs: proofMap,
  };
};

/**
 * Verifies a proof object containing selectively disclosed claims.
 *
 * @param proofObject The object containing the merkleRoot, revealedFields, and proofs.
 * @returns An object indicating if the proof is valid and the verified claims.
 */
export const verifyDisclosedProof = (proofObject: {
  merkleRoot: string;
  revealedFields: Record<string, string>;
  proofs: Record<string, string[]>;
}): { isValid: boolean; verifiedClaims: Record<string, string> } => {
  const { merkleRoot, revealedFields, proofs } = proofObject;

  if (!merkleRoot || !revealedFields || !proofs || Object.keys(revealedFields).length === 0) {
    console.error("Verification failed: Proof object is malformed or empty.");
    return { isValid: false, verifiedClaims: {} };
  }

  for (const path in revealedFields) {
    if (proofs[path]) {
      const value = revealedFields[path];
      const leaf = keccak256(`${path}:${value}`);
      const proof = proofs[path];
      
      // The `sortPairs` option MUST be used here if it was used during tree generation
      const isValid = MerkleTree.verify(proof, leaf, merkleRoot, keccak256, { sortPairs: true });
      
      if (!isValid) {
        console.error(`Verification failed: Merkle proof for field "${path}" is invalid.`);
        return { isValid: false, verifiedClaims: {} };
      }
    } else {
        console.error(`Verification failed: A claim for "${path}" was disclosed without a corresponding proof.`);
        return { isValid: false, verifiedClaims: {} };
    }
  }

  // If all proofs are valid
  return { isValid: true, verifiedClaims: revealedFields };
};
