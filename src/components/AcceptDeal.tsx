import { useAccount, useReadContract, useSimulateContract,
         useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2,
         ShieldCheck, Clock, UserCheck } from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS,
  DEMO_SELLER,
  ESCROW_ABI, DEAL_STATUS_LABELS, DEAL_STATUS_COLORS,
} from '@/escrow'
import { buildTxExplorerUrl } from '@/onchain-facts'

const DEAL_ID = 1n

function truncate(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function formatExpiry(ts: bigint): string {
  return new Date(Number(ts) * 1000).toUTCString()
}

function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001'))
    return 'Transaction cancelled — no funds moved.'
  if (msg.includes('dealexpired'))
    return 'Deal has expired and can no longer be accepted.'
  if (msg.includes('invalidstate'))
    return 'Deal is not in CREATED state — it may already have been accepted.'
  if (msg.includes('unauthorized'))
    return 'Only the designated seller can accept this deal.'
  if (msg.includes('reverted'))
    return 'Transaction reverted. Confirm you are using Wallet B (Seller).'
  return 'Transaction failed — check the browser console for details.'
}

export function AcceptDeal() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isWrongChain  = isConnected && chainId !== ARC_TESTNET_CHAIN_ID
  const isRightSeller = address?.toLowerCase() === DEMO_SELLER.toLowerCase()

  // ── live deal read ─────────────────────────────────────────────────────────
  const { data: deal, isLoading: isDealLoading, error: dealError } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getDeal',
    args: [DEAL_ID],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { refetchInterval: 6_000 },
  })

  // ── simulate acceptDeal ────────────────────────────────────────────────────
  const { data: simResult, isLoading: isSimLoading, error: simError } = useSimulateContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'acceptDeal',
    args: [DEAL_ID],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: {
      enabled: isConnected && !isWrongChain && isRightSeller && (deal?.status === 0),
    },
  })

  // ── write + receipt ────────────────────────────────────────────────────────
  const { writeContract, data: txHash, isPending: isWalletPending, error: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash, chainId: ARC_TESTNET_CHAIN_ID })

  // ── derived state ──────────────────────────────────────────────────────────
  const currentStatus = deal?.status ?? 0
  const alreadyAccepted = currentStatus >= 1

  const simOk        = !!simResult && !simError
  const canSubmit    = simOk && !isWalletPending && !isConfirming && !isConfirmed && !alreadyAccepted
  const isBusy       = isWalletPending || isConfirming

  const displayError = writeError ? parseOnchainError(writeError)
                     : simError   ? `Simulation: ${(simError as Error).message?.slice(0, 120)}`
                     : null

  function handleAccept() {
    if (!simResult?.request) return
    reset()
    writeContract(simResult.request)
  }

  // ── guard: not connected ───────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-8 text-center space-y-3">
          <UserCheck className="w-10 h-10 text-slate-500 mx-auto" />
          <p className="font-display text-lg font-semibold text-white">Connect Wallet B — Seller</p>
          <p className="text-sm text-slate-400">
            Connect MetaMask as Seller&nbsp;
            <span className="font-mono text-xs text-slate-300">{truncate(DEMO_SELLER)}</span>
            &nbsp;to accept Deal&nbsp;#1.
          </p>
        </div>
      </div>
    )
  }

  // ── guard: wrong chain ─────────────────────────────────────────────────────
  if (isWrongChain) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="font-semibold text-amber-300">Wrong network</p>
          </div>
          <p className="text-sm text-slate-300">
            Switch MetaMask to <strong>Arc Testnet</strong> (chain&nbsp;5042002) to continue.
          </p>
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            disabled={isSwitching}
            className="w-full py-2.5 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400
                       active:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed
                       text-slate-950 transition-colors"
          >
            {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-24 space-y-5">

      {/* ── page title ───────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Accept Deal
        </h1>
        <p className="text-sm text-slate-400">
          TX2 of 6 — Seller accepts terms to advance the deal to&nbsp;
          <span className="text-blue-400 font-medium">ACCEPTED</span>.
        </p>
      </div>

      {/* ── signer guard ─────────────────────────────────────────────────── */}
      {!isRightSeller && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-300 space-y-0.5">
            <p className="font-semibold">Wrong signer</p>
            <p>
              This action requires <span className="font-mono text-xs">{truncate(DEMO_SELLER)}</span>.
              Currently connected: <span className="font-mono text-xs">{truncate(address ?? '')}</span>.
            </p>
            <p className="text-rose-400/70 text-xs mt-1">
              Switch MetaMask to Wallet&nbsp;B (Seller) and reconnect.
            </p>
          </div>
        </div>
      )}

      {/* ── live deal card ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest uppercase text-slate-500">
            Live Deal State
          </span>
          {isDealLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
          {dealError && <span className="text-xs text-rose-400">RPC error</span>}
        </div>

        {deal ? (
          <div className="px-5 py-4 space-y-3 text-sm">

            {/* status badge */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Status</span>
              <span className={`font-semibold tabular-nums ${DEAL_STATUS_COLORS[currentStatus] ?? 'text-white'}`}>
                {DEAL_STATUS_LABELS[currentStatus] ?? String(currentStatus)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Deal&nbsp;ID</span>
              <span className="font-mono text-xs text-slate-300 tabular-nums">{deal.dealId.toString()}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Buyer</span>
              <span className="font-mono text-xs text-slate-300">{truncate(deal.buyer)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Seller</span>
              <span className="font-mono text-xs text-slate-300">{truncate(deal.seller)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Amount</span>
              <span className="font-semibold tabular-nums text-white">
                {(Number(deal.amount) / 1_000_000).toFixed(6)}&nbsp;USDC
              </span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-400 shrink-0 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />Expires
              </span>
              <span className="font-mono text-xs text-slate-300 text-right break-all">
                {formatExpiry(deal.expiration)}
              </span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-400 shrink-0">Terms hash</span>
              <span className="font-mono text-[10px] text-slate-400 text-right break-all leading-relaxed">
                {deal.termsHash}
              </span>
            </div>

          </div>
        ) : !isDealLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            {dealError ? 'Could not load deal. Check RPC connectivity.' : 'Deal #1 not found.'}
          </p>
        ) : (
          <div className="px-5 py-6 flex items-center gap-3 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading deal from Arc Testnet…</span>
          </div>
        )}
      </div>

      {/* ── what accepting means ──────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-950/20 px-4 py-3">
        <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300 leading-relaxed">
          By accepting, you (Seller) confirm the terms hash above and allow the buyer to fund escrow.
          Accepting does not move any USDC — funding happens in TX4.
          <span className="block mt-1 text-slate-500">
            [SYNTHETIC TEST DATA] — no real goods, delivery, or AI analysis involved.
          </span>
        </p>
      </div>

      {/* ── simulation status ─────────────────────────────────────────────── */}
      {isRightSeller && !alreadyAccepted && (
        <div className={`flex items-center gap-2.5 text-xs px-4 py-2.5 rounded-xl border ${
          isSimLoading
            ? 'border-slate-700/50 bg-slate-800/40 text-slate-400'
            : simOk
            ? 'border-emerald-600/30 bg-emerald-950/20 text-emerald-400'
            : simError
            ? 'border-rose-600/30 bg-rose-950/20 text-rose-400'
            : 'border-slate-700/50 bg-slate-800/40 text-slate-400'
        }`}>
          {isSimLoading
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Simulating call…</span></>
            : simOk
            ? <><CheckCircle2 className="w-3.5 h-3.5" /><span>Simulation passed — ready to submit</span></>
            : <><AlertTriangle className="w-3.5 h-3.5" /><span>Simulation not ready</span></>
          }
        </div>
      )}

      {/* ── already accepted ──────────────────────────────────────────────── */}
      {alreadyAccepted && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-600/30 bg-emerald-950/20 px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300 font-medium">
            Deal #1 is already {DEAL_STATUS_LABELS[currentStatus]} — TX2 complete.
          </p>
        </div>
      )}

      {/* ── error surface ─────────────────────────────────────────────────── */}
      {displayError && !isConfirmed && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-300">{displayError}</p>
        </div>
      )}

      {/* ── pending states ────────────────────────────────────────────────── */}
      {isWalletPending && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 font-medium">Waiting for MetaMask confirmation…</p>
        </div>
      )}

      {isConfirming && txHash && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-950/20 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
          <div className="text-sm space-y-0.5">
            <p className="text-blue-300 font-medium">Transaction submitted — confirming on Arc Testnet…</p>
            <a
              href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 break-all"
            >
              {txHash} <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </div>
      )}

      {/* ── success receipt ───────────────────────────────────────────────── */}
      {isConfirmed && txHash && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 overflow-hidden">
          <div className="px-5 py-3 border-b border-emerald-700/30 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-emerald-300 text-sm">TX2 Confirmed</span>
          </div>
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-400 shrink-0">Tx hash</span>
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-sky-400 hover:text-sky-300 text-right break-all
                           flex items-start gap-1 transition-colors"
              >
                {txHash}
                <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Deal ID</span>
              <span className="font-mono text-xs text-slate-300 tabular-nums">1</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">New status</span>
              <span className="font-semibold text-blue-400">ACCEPTED (1)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Signer</span>
              <span className="font-mono text-[10px] text-slate-300">{truncate(DEMO_SELLER)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Contract</span>
              <span className="font-mono text-[10px] text-slate-400">{truncate(ESCROW_ADDRESS)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Chain</span>
              <span className="text-slate-300">Arc Testnet (5042002)</span>
            </div>
            <p className="text-xs text-slate-500 pt-1 leading-relaxed">
              No USDC was moved. The buyer may now approve and fund the escrow (TX3 + TX4).
            </p>
          </div>
        </div>
      )}

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      {!alreadyAccepted && (
        <button
          onClick={handleAccept}
          disabled={!canSubmit || !isRightSeller}
          className={`w-full py-4 rounded-2xl font-display font-bold text-base tracking-tight
                      transition-all duration-150 flex items-center justify-center gap-2
                      ${canSubmit && isRightSeller
                        ? 'bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white shadow-lg shadow-sky-900/40 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
        >
          {isBusy
            ? <><Loader2 className="w-4 h-4 animate-spin" />Processing…</>
            : isConfirmed
            ? <><CheckCircle2 className="w-4 h-4" />Accepted</>
            : 'Accept Deal #1'
          }
        </button>
      )}

      {/* ── testnet disclaimer ────────────────────────────────────────────── */}
      <p className="text-center text-xs text-slate-600 leading-relaxed">
        Arc Testnet only — no real USDC. TX2 of 6 in the demo lifecycle.
      </p>

    </div>
  )
}
