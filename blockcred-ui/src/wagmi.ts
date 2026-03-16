// src/wagmi.ts
import { createConfig, http } from 'wagmi'
import { injected } from '@wagmi/connectors'
import { defineChain } from 'viem'

// .env (Vite) – make sure these exist and restart dev server after editing
// VITE_RPC_URL=http://127.0.0.1:7545
// VITE_CHAIN_ID=1337

const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:7545'
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 1337)

export const ganacheLocal = defineChain({
  id: CHAIN_ID,
  name: 'Ganache Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
})

export const config = createConfig({
  chains: [ganacheLocal],
  connectors: [
    injected(), // MetaMask / browser wallets
  ],
  transports: {
    [ganacheLocal.id]: http(RPC_URL),
  },
})


