import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

export  function ConnectWallet() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-emerald-300 text-sm">
          {address?.slice(0, 6)}…{address?.slice(-4)}
          {typeof chainId === 'number' ? ` · chain ${chainId}` : ''}
        </span>
        <button
          onClick={() => disconnect()}
          className="px-3 py-1.5 rounded-md bg-emerald-600/20 border border-emerald-400/30 hover:bg-emerald-600/30"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      className="px-4 py-2 rounded-md bg-emerald-500/20 border border-emerald-400/40 hover:bg-emerald-500/30"
    >
      {isPending ? 'Connecting…' : 'Connect MetaMask'}
    </button>
  )
}

