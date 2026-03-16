import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  const privateKey = process.env.PRIVATE_KEY || '0xac0974cc0cf1775276e0769ee80f14cc542047a21795790be107b2756adfaec7'; // This is a hardcoded private key from hardhat's default account #0. DO NOT USE IN PRODUCTION.

  console.log("--------------------------------------------------------------------------------------------------");
  console.log("WARNING: EXPOSING PRIVATE KEYS IS DANGEROUS. DO NOT USE THIS IN PRODUCTION OR SHARE WITH ANYONE.");
  console.log("--------------------------------------------------------------------------------------------------");
  console.log("Deployer Account Address:", deployer.address);
  console.log("Deployer Account Private Key:", privateKey);
  console.log("--------------------------------------------------------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
