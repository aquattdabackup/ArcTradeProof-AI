import { ConnectKitButton } from 'connectkit'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { AlertTriangle, CheckCircle2, Wifi } from 'lucide-react'
import { ARC_TESTNET_CHAIN_ID, USDC_ADDRESS } from '@/escrow'
import { usdcDecimalsFor, Amount } from '@/onchain-money'
import { buildTxExplorerUrl } from '@/onchain-facts'

// Re-export so callers can use it
export { buildTxExplorerUrl }

export function WalletHeader() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const onArcTestnet = chainId === ARC_TESTNET_CHAIN_ID

  const { data: rawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const usdcBalance = rawBalance !== undefined
    ? Amount.fromRaw(rawBalance, usdcDecimalsFor(ARC_TESTNET_CHAIN_ID)).toFixed(2)
    : null

  return (
    <header className="w-full border-b border-white/10 bg-white/5 backdrop-blur-sm">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 4V10L7 13L1 10V4L7 1Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-display font-semibold text-sm text-white truncate hidden sm:block">
            ArcTradeProof
          </span>
        </div>

        {/* Network + balance pill */}
        {isConnected && (
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            {onArcTestnet ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono tabular-nums">
                <CheckCircle2 size={11} />
                <span>Arc Testnet</span>
                {usdcBalance !== null && (
                  <span className="text-white/60 pl-1 border-l border-white/10">
                    {usdcBalance} USDC
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
                disabled={isSwitching}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                <AlertTriangle size={11} />
                <span>{isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}</span>
              </button>
            )}
          </div>
        )}

        {/* Connect button */}
        <div className="shrink-0">
          <ConnectKitButton.Custom>
            {({ isConnected, show, address: addr }) => (
              <button
                onClick={show}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${isConnected
                    ? 'bg-white/8 border border-white/12 text-white/80 hover:bg-white/12'
                    : 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20'
                  }
                `}
              >
                <Wifi size={11} className={isConnected ? 'text-emerald-400' : 'text-white/70'} />
                <span className="font-mono tabular-nums">
                  {isConnected && addr
                    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
                    : 'Connect Wallet'}
                </span>
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>

      {/* Wrong-chain banner */}
      {isConnected && !onArcTestnet && (
        <div className="bg-amber-500/10 border-t border-amber-500/20 text-amber-300 text-xs text-center py-1.5 px-4">
          All actions are disabled until you switch to Arc Testnet (chain ID 5042002).
        </div>
      )}
    </header>
  )
}
