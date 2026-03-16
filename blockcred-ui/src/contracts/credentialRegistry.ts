

// 👇 Replace this with the actual deployed address of CredentialRegistry on 1337
export const CREDENTIAL_REGISTRY_ADDRESS =
 "0x1B0DF7Bef360ae01E3e0E77227e218CD96Fa14BF";

export const credentialRegistryAbi = [
  {
    type: 'function',
    name: 'issueCredential',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'subject', type: 'address' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'cid', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'statusOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'getCredential',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'issuer', type: 'address' },
      { name: 'subject', type: 'address' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'cid', type: 'string' },
      { name: 'issuedAt', type: 'uint64' },
      { name: 'revokedAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'revokeCredential',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
] as const;

