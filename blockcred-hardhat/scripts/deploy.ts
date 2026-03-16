import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  // 👇 We are setting the admin to an address for which you have the private key.
  const ADMIN = "0xAe08cb53B907869890Aad02B8582880ce9a5675F";

  const Registry = await ethers.getContractFactory("CredentialRegistry");

  // 👇 constructor(admin)
  const registry = await Registry.deploy(ADMIN);
  await registry.waitForDeployment();

  console.log("✅ Registry deployed to:", await registry.getAddress());
  console.log("👤 Deployed by:", deployer.address);
  console.log("👑 Admin/Issuer (from constructor):", ADMIN);
}

main().catch((e) => console.error(e));



