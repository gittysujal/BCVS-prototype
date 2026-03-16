# BCVS — Blockchain Credential Verification System

A prototype system for issuing and verifying academic credentials using blockchain technology, built as a final year dissertation project.

---

## What it does

Traditional academic credential verification is slow, costly, and vulnerable to fraud. BCVS replaces that process with a decentralised, tamper-evident system where credentials can be verified instantly — without contacting the issuing institution.

Key features:
- **Credential issuance** — universities issue credentials as smart contract transactions on-chain
- **Selective disclosure** — students share only the specific fields needed for verification using Merkle tree proofs, not their full record
- **Revocation** — invalid or withdrawn credentials can be flagged without altering historical records
- **Privacy-first** — personal data is stored off-chain and encrypted; only cryptographic proofs live on the blockchain
- **GDPR-aware design** — addresses the blockchain immutability vs Right to Erasure conflict through a hybrid architecture

---

## Tech stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity, Hardhat |
| Blockchain | Ethereum (local testnet via Hardhat) |
| Frontend | React, TypeScript, Tailwind CSS, Viem/Wagmi |
| Privacy | Merkle trees, SHA-256 hashing, IPFS |
| Backend mailer | Node.js, Express, Nodemailer |

---

## Project structure

```
BCVS-prototype/
├── blockcred-hardhat/     # Solidity smart contracts + deployment scripts
├── blockcred-ui/          # React frontend (issuer, holder, verifier dashboards)
└── blockcred-mailer/      # Email notification service
```

---

## How to run locally

### 1. Clone the repo
```bash
git clone https://github.com/gittysujal/BCVS-prototype.git
cd BCVS-prototype
```

### 2. Start the local blockchain
```bash
cd blockcred-hardhat
npm install
npx hardhat node
```

### 3. Deploy smart contracts
```bash
npx hardhat run scripts/deploy.ts --network localhost
```

### 4. Start the frontend
```bash
cd ../blockcred-ui
npm install
npm run dev
```

### 5. Start the mailer service
```bash
cd ../blockcred-mailer
npm install
# Add your own .env file (see .env.example)
node server.js
```

> **Note:** You will need MetaMask installed and connected to the local Hardhat network to interact with the app.

---

## Architecture overview

The system uses a hybrid on-chain/off-chain model:

- **On-chain:** credential hashes, Merkle roots, issuance/revocation status
- **Off-chain (IPFS):** encrypted credential data
- **Smart contract:** `CredentialRegistry.sol` manages issuance, verification, and revocation logic

This design ensures personal data never touches the blockchain, maintaining GDPR compliance while preserving the integrity guarantees of a decentralised ledger.

---

## Dissertation

This project was built as part of a BSc Computer Science dissertation at University of West London, 2025/26. The research explores whether blockchain-based credential systems can improve trust and efficiency while remaining compliant with GDPR — specifically the Right to Erasure.

**Research question:** Can a blockchain-based academic credential verification system improve trust and efficiency while respecting privacy and data protection requirements?

**Conclusion:** Yes — by keeping personal data off-chain and applying privacy-by-design principles, the conflict between blockchain immutability and GDPR can be resolved.

---

## Author

**Sujal Basyal** - linkedin.com/in/sujal-basyal-153059224
[GitHub](https://github.com/gittysujal)

