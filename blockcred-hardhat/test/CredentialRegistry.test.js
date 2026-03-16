const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");

// helper: hash "key:value" -> 0x...
function hashKV(k, v) {
  const buf = keccak256(`${k}:${v}`);
  return "0x" + buf.toString("hex");
}

// Build Merkle tree from [key, value] pairs
function buildMerkle(fields) {
  const leaves = fields.map(([k, v]) =>
    Buffer.from(hashKV(k, v).slice(2), "hex")
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex");
  // We don’t actually use the proofs in this contract,
  // but we keep this here in case you extend later.
  const proofFor = ([k, v]) =>
    tree
      .getProof(Buffer.from(hashKV(k, v).slice(2), "hex"))
      .map((p) => "0x" + p.data.toString("hex"));
  return { root, proofFor };
}

describe("CredentialRegistry", function () {
  it("registers → checks status → revokes", async function () {
    // 🔹 1) Use first signer as admin (and issuer)
    const [admin, subject] = await ethers.getSigners();

    // 🔹 2) Deploy contract and PASS admin.address to constructor ✅
    const Registry = await ethers.getContractFactory("CredentialRegistry", admin);
    const registry = await Registry.deploy(admin.address);
    await registry.waitForDeployment();

    // Enum mapping (Status { None, Active, Revoked })
    const Status = {
      None: 0,
      Active: 1,
      Revoked: 2,
    };

    // 🔹 3) Build Merkle root for sample credential fields
    const fields = [
      ["name", "Sujal K"],
      ["degree", "BSc (Hons) Cyber Security"],
      ["course", "Cyber Security"],
    ];
    const { root } = buildMerkle(fields);
    const cid = "bafy_demo_cid";

    // Use a separate ID for the credential (can be anything bytes32)
    const id = ethers.id("demo-credential-1");

    // 🔹 4) Before issuing → status should be None
    const initialStatus = await registry.statusOf(id);
    expect(initialStatus).to.equal(Status.None);

    // 🔹 5) Issue credential (admin has ISSUER_ROLE from constructor)
    const issuerRole = await registry.ISSUER_ROLE();
    const hasRole = await registry.hasRole(issuerRole, admin.address);
    expect(hasRole).to.be.true;
    
    await registry
      .connect(admin)
      .issueCredential(id, subject.address, root, cid);

    // 🔹 6) After issuing → status should be Active
    const activeStatus = await registry.statusOf(id);
    expect(activeStatus).to.equal(Status.Active);

    // 🔹 7) Check stored struct via getCredential
    const cred = await registry.getCredential(id);

    expect(cred.issuer).to.equal(admin.address);
    expect(cred.subject).to.equal(subject.address);
    expect(cred.merkleRoot).to.equal(root);
    expect(cred.cid).to.equal(cid);
    expect(cred.issuedAt).to.be.gt(0n); // issuedAt > 0
    expect(cred.revokedAt).to.equal(0n); // not revoked yet

    // 🔹 8) Revoke credential (only issuer or DEFAULT_ADMIN_ROLE)
    await registry.connect(admin).revokeCredential(id);

    // 🔹 9) Status should now be Revoked
    const revokedStatus = await registry.statusOf(id);
    expect(revokedStatus).to.equal(Status.Revoked);

    // And the struct should have revokedAt set
    const credAfter = await registry.getCredential(id);
    expect(credAfter.revokedAt).to.be.gt(0n);
  });
});
