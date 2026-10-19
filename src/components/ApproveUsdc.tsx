/**
 * TX3 — Approve 0.25 USDC
 *
 * Calls approve(escrowAddress, 250000) on the USDC ERC-20 contract.
 * This grants the escrow contract permission to pull exactly 250 000 base
 * units (0.25 USDC, 6-decimal ERC-20 view) during fundDeal.
 *
 * IMPORTANT:
 * - Target contract is USDC (0x3600…), NOT the escrow.
 * - Exact allowance only — never MaxUint256.
 * - Does NOT transfer USDC; only sets the spending permission.
 * - Real transfer happens in TX4 (fundDeal).
 */

import { useEffect } from 'react'
import { useReadContract, useSimulateContract,
         useWriteContract, useWaitForTransactionReceipt,
         useSwitchChain, useAccount } from 'wagmi'
import { erc20Abi } from 'viem'
import { AlertTriangle, CheckCircle2, ExternalLink,
         Loader2, ShieldCheck, Info, Coins } from 'lucide-react'
import { ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS,
         DEMO_BUYER, DEMO_AMOUNT, ESCROW_ABI } from '@/escrow'
import { buildTxExplorerUrl } from '@/onchain-facts'

// ── helpers ────────────────────────────────────────────────────────────────

function fmtUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = raw % 1_000_000n
  return `${whole}.${String(frac).padStart(6, '0').replace(/0+$/, '') || '0'} USDC`
}

function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001'))
    return 'Approval cancelled — no allowance was set.'
  if (msg.includes('reverted'))
    return 'Transaction reverted. Confirm you are on Arc Testnet with Wallet A.'
  if (msg.includes('network') || msg.includes('timeout'))
    return 'Network error — check your connection and retry.'
  return 'Transaction failed — check the browser console for details.'
}

// ── Row helper ─────────────────────────────────────────────────────────────

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-400 text-xs shrink-0">{label}</span>
      <span className={`text-right text-xs break-all ${mono ? 'font-mono text-slate-300' : 'text-slate-200'}`}>
        {value}
      </span>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────

export function ApproveUsdc() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isRightChain  = chainId === ARC_TESTNET_CHAIN_ID
  const isRightSigner = address?.toLowerCase() === DEMO_BUYER.toLowerCase()

  // ── live reads ────────────────────────────────────────────────────────────

  const { data: deal, isLoading: isDealLoading } = useReadContract({
    address:      ESCROW_ADDRESS,
    abi:          ESCROW_ABI,
    functionName: 'getDeal',
    args:         [1n],
    chainId:      ARC_TESTNET_CHAIN_ID,
    query:        { refetchInterval: 6_000 },
  })

  const { data: balance, isLoading: isBalLoading, refetch: refetchBalance } = useReadContract({
    address:      USDC_ADDRESS,
    abi:          erc20Abi,
    functionName: 'balanceOf',
    args:         address ? [address] : undefined,
    chainId:      ARC_TESTNET_CHAIN_ID,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  const { data: allowance, isLoading: isAllowLoading, refetch: refetchAllowance } = useReadContract({
    address:      USDC_ADDRESS,
    abi:          erc20Abi,
    functionName: 'allowance',
    args:         address ? [address, ESCROW_ADDRESS] : undefined,
    chainId:      ARC_TESTNET_CHAIN_ID,
    query:        { enabled: !!address, refetchInterval: 6_000 },
  })

  // Status derived from live deal read — wagmi returns a typed object for tuple outputs
  type DealTuple = { status: number }
  const dealStatus: number = deal ? Number((deal as unknown as DealTuple).status) : -1
  const isAccepted = dealStatus === 1
  const alreadyApproved = (allowance ?? 0n) >= DEMO_AMOUNT

  // ── simulate approve ─────────────────────────────────────────────────────

  const { data: simResult, isLoading: isSimLoading, error: simError } = useSimulateContract({
    address:      USDC_ADDRESS,
    abi:          erc20Abi,
    functionName: 'approve',
    args:         [ESCROW_ADDRESS, DEMO_AMOUNT],
    chainId:      ARC_TESTNET_CHAIN_ID,
    query: {
      enabled: isConnected && isRightChain && isRightSigner && isAccepted && !alreadyApproved,
    },
  })

  // ── write ─────────────────────────────────────────────────────────────────

  const { writeContract, data: txHash, isPending: isWalletPending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  // Refresh live reads once the approval is confirmed on-chain
  useEffect(() => {
    if (!isConfirmed) return
    void refetchAllowance()
    void refetchBalance()
  }, [isConfirmed, refetchAllowance, refetchBalance])

  const canSubmit = !!simResult && !isWalletPending && !isConfirming && !isConfirmed && !alreadyApproved

  function handleApprove() {
    if (!simResult) return
    writeContract(simResult.request)
  }

  // ── button label ─────────────────────────────────────────────────────────

  const btnLabel = isWalletPending
    ? 'Confirm in MetaMask…'
    : isConfirming
    ? 'Confirming on Arc Testnet…'
    : alreadyApproved
    ? 'Allowance already set'
    : 'Approve 0.25 USDC'

  const displayError = writeError ?? (simError && !alreadyApproved && isRightChain && isRightSigner ? simError : null)

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-24 space-y-4">

      {/* page header */}
      <div className="space-y-1">
        <p className="text-slate-500 text-[10px] font-semibold tracking-widest uppercase">Step 3 of 6</p>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">Approve USDC</h1>
        <p className="text-slate-400 text-sm text-pretty leading-relaxed">
          Grant the escrow contract permission to pull exactly{' '}
          <span className="text-white font-semibold">0.25 USDC</span> when you fund the deal.
          This sets a spending allowance only —{' '}
          <span className="text-slate-300">no USDC moves until TX4</span>.
        </p>
      </div>

      {/* connect / chain guards */}
      {!isConnected && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-slate-300 text-sm">Connect Wallet A (Buyer) to continue.</p>
        </div>
      )}

      {isConnected && !isRightChain && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-200 text-sm">Switch to Arc Testnet (chain 5042002) to continue.</p>
          </div>
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            disabled={isSwitching}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs
                       font-semibold border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
          >
            {isSwitching ? 'Switching…' : 'Switch Network'}
          </button>
        </div>
      )}

      {isConnected && isRightChain && !isRightSigner && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-rose-300 text-sm font-semibold">Wrong wallet connected.</p>
            <p className="text-slate-400 text-xs">
              TX3 must be signed by Wallet A (Buyer):<br />
              <span className="font-mono text-slate-300">{DEMO_BUYER}</span>
            </p>
          </div>
        </div>
      )}

      {/* deal status confirmation */}
      {isConnected && isRightChain && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 divide-y divide-slate-800/60">
          <div className="px-4 py-3 flex items-center gap-2">
            <Coins className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300 text-xs font-semibold">Live Deal State — Deal #1</span>
            {isDealLoading && <Loader2 className="w-3 h-3 text-slate-500 animate-spin ml-auto" />}
          </div>
          <div className="px-4 pb-1">
            <Row label="Status" value={
              dealStatus === -1 ? 'Loading…'
              : dealStatus === 1 ? '✓ ACCEPTED — ready to approve'
              : `${['CREATED','ACCEPTED','FUNDED','EVIDENCE_SUBMITTED','RELEASED','REFUNDED'][dealStatus] ?? 'Unknown'} (status ${dealStatus})`
            } />
            <Row label="Amount" value="250,000 base units = 0.25 USDC" />
            <Row label="Escrow contract" value={ESCROW_ADDRESS} mono />
          </div>
        </div>
      )}

      {/* approval context card */}
      <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-sky-300 text-xs font-semibold">What this approval does</span>
        </div>
        <ul className="space-y-1.5 text-xs text-slate-400 leading-relaxed">
          <li className="flex gap-2"><span className="text-sky-500 shrink-0">→</span>
            Calls <span className="font-mono text-slate-300">approve(escrow, 250000)</span> on the USDC contract at{' '}
            <span className="font-mono text-slate-300">{USDC_ADDRESS}</span>.
          </li>
          <li className="flex gap-2"><span className="text-sky-500 shrink-0">→</span>
            Sets an allowance of <strong className="text-white">exactly 250 000 base units</strong> — not unlimited.
          </li>
          <li className="flex gap-2"><span className="text-sky-500 shrink-0">→</span>
            <strong className="text-white">No USDC is transferred</strong> by this transaction.
            The transfer happens in TX4 (Fund Escrow).
          </li>
          <li className="flex gap-2"><span className="text-sky-500 shrink-0">→</span>
            If you do not proceed to TX4, the escrow cannot spend anything.
          </li>
        </ul>
      </div>

      {/* approval parameters */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 divide-y divide-slate-800/60">
        <div className="px-4 py-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400" />
          <span className="text-slate-300 text-xs font-semibold">Approval Parameters</span>
        </div>
        <div className="px-4 pb-1">
          <Row label="Token contract (target)"  value={USDC_ADDRESS}   mono />
          <Row label="Spender"                  value={ESCROW_ADDRESS} mono />
          <Row label="Approve amount"           value="250,000 base units (0.25 USDC, 6 decimals)" />
          <Row label="Unlimited approval?"      value="No — exact amount only" />
          <Row label="Signer (Wallet A / Buyer)" value={DEMO_BUYER}   mono />
        </div>
      </div>

      {/* live wallet state */}
      {isConnected && isRightChain && isRightSigner && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 divide-y divide-slate-800/60">
          <div className="px-4 py-3 flex items-center gap-2">
            <Coins className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300 text-xs font-semibold">Live Wallet State</span>
            {(isBalLoading || isAllowLoading) &&
              <Loader2 className="w-3 h-3 text-slate-500 animate-spin ml-auto" />}
          </div>
          <div className="px-4 pb-1">
            <Row
              label="Buyer USDC balance"
              value={isBalLoading ? 'Loading…' : balance != null ? fmtUsdc(balance) : '—'}
            />
            <Row
              label="Current allowance (buyer → escrow)"
              value={isAllowLoading ? 'Loading…' : allowance != null ? `${allowance.toString()} base units` : '—'}
            />
            <Row
              label="Required allowance"
              value="250,000 base units"
            />
          </div>
        </div>
      )}

      {/* simulation status */}
      {isConnected && isRightChain && isRightSigner && isAccepted && !alreadyApproved && (
        <div className="flex items-center gap-2 text-xs px-1">
          {isSimLoading
            ? <><Loader2 className="w-3 h-3 text-slate-500 animate-spin" /><span className="text-slate-500">Simulating approval…</span></>
            : simError
            ? <><AlertTriangle className="w-3 h-3 text-rose-400" /><span className="text-rose-400">Simulation failed — {(simError as Error).message.slice(0, 80)}</span></>
            : simResult
            ? <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Simulation passed — ready to submit</span></>
            : null
          }
        </div>
      )}

      {/* already approved banner */}
      {alreadyApproved && !isConfirmed && (
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-950/20 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-emerald-300 text-sm font-semibold">Allowance already set.</p>
            <p className="text-slate-400 text-xs">
              Current allowance: <span className="font-mono text-slate-300">{allowance?.toString()} base units</span>.
              Proceed to TX4.
            </p>
          </div>
        </div>
      )}

      {/* CTA */}
      {!isConfirmed && (
        <button
          onClick={handleApprove}
          disabled={!canSubmit}
          className={`w-full py-4 rounded-xl font-display font-semibold text-sm tracking-wide
                      transition-all duration-200 flex items-center justify-center gap-2
                      ${canSubmit
                        ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 active:scale-[0.98]'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
        >
          {(isWalletPending || isConfirming) && <Loader2 className="w-4 h-4 animate-spin" />}
          {btnLabel}
        </button>
      )}

      {/* error display */}
      {displayError && !isConfirmed && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-rose-300 text-sm">{parseOnchainError(displayError)}</p>
        </div>
      )}

      {/* success receipt */}
      {isConfirmed && txHash && (
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-950/10 divide-y divide-slate-800/40">

          <div className="px-4 py-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-300 text-sm font-semibold">TX3 Confirmed — Allowance Set</span>
          </div>

          <div className="px-4 py-3 space-y-2">
            {/* tx hash */}
            <div className="space-y-1">
              <p className="text-slate-500 text-[10px] tracking-widest uppercase">Transaction hash</p>
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sky-400 hover:text-sky-300 text-xs font-mono break-all transition-colors"
              >
                {txHash}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>

            {/* confirmed allowance */}
            <div className="rounded-lg bg-slate-900/60 p-3 space-y-1.5 mt-2">
              <p className="text-slate-500 text-[10px] tracking-widest uppercase">On-chain confirmation</p>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Allowance (buyer → escrow)</span>
                <span className="text-emerald-400 text-xs font-semibold tabular-nums">
                  {isAllowLoading ? 'Refreshing…' : `${(allowance ?? 0n).toString()} base units`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Required for TX4</span>
                <span className="text-slate-300 text-xs tabular-nums">250,000 base units</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Sufficient for fundDeal?</span>
                <span className={`text-xs font-semibold ${(allowance ?? 0n) >= DEMO_AMOUNT ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(allowance ?? 0n) >= DEMO_AMOUNT ? 'Yes — proceed to TX4' : 'No — re-approve'}
                </span>
              </div>
            </div>

            <p className="text-slate-500 text-xs pt-1">
              Switch to <span className="text-sky-400">step 4 (Fund Escrow)</span> to lock 0.25 USDC in the escrow contract.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
