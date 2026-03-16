import hre from "hardhat";
async function main() {
  const { ethers } = hre;

  const Registry = await ethers.getContractFactory("CredentialRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  console.log("CredentialRegistry deployed to:", await registry.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

