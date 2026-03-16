// src/lib/merkle.ts
import { Buffer } from 'buffer';
import keccak256 from 'keccak256';
import { MerkleTree } from 'merkletreejs';

// Ensure Buffer exists in the browser (for merkletreejs / keccak256)
if (typeof window !== 'undefined' && (window as any).Buffer === undefined) {
  (window as any).Buffer = Buffer;
}

// "key:value" -> 0x...
export function hashKV(key: string, value: string): `0x${string}` {
  const buf = keccak256(`${key}:${value}`);
  return ('0x' + buf.toString('hex')) as `0x${string}`;
}

export function buildMerkleRoot(fields: [string, string][]): `0x${string}` {
  const leaves = fields.map(([k, v]) =>
    Buffer.from(hashKV(k, v).slice(2), 'hex'),
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return ('0x' + tree.getRoot().toString('hex')) as `0x${string}`;
}


