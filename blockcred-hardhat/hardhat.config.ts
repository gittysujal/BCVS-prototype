import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Local Hardhat network
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // 🔗 Ganache GUI or CLI
    ganache: {
      url: process.env.GANACHE_RPC || "http://127.0.0.1:7545",
      chainId: Number(process.env.GANACHE_CHAIN_ID || 1337),
      // ⬇️ Replace this with the private key from Ganache GUI (first account)
      accounts: [
        process.env.GANACHE_PRIVATE_KEY ||
          "0x0a1999e0121ebe415711e95bb573fd60dd34042fc257b19ca8",
      ],
    },
  },
};

export default config;

