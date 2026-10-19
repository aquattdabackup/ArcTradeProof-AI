/**
 * TX4 — Fund Escrow
 *
 * Calls fundDeal(1) on the escrow contract as the Buyer.
 * The escrow contract internally calls safeTransferFrom(buyer, escrow, 250000).
 * Native transaction value is ZERO — no USDC is sent directly to the contract.
 *
 * Pre-conditions verified before enabling submit:
 *   - getDeal(1).status == 1 (ACCEPTED)
 *   - allowance(buyer, escrow) >= 250000
 *   - balanceOf(buyer) >= 250000
 *   - connected address == BUYER_ADDRESS on Arc Testnet
 *
 * Post-confirmation invariants:
 *   - getDeal(1).status == 2 (FUNDED)
 *   - totalEscrowLocked() == 250000
 *   - USDC Transfer event: from=buyer to=escrow value=250000
 */

import { useEffect } from 'react'
import {
  useReadContract, useSimulateContract,
  useWriteContract, useWaitForTransactionReceipt,
  useSwitchChain, useAccount,
} from 'wagmi'
import { erc20Abi } from 'viem'
import {
  AlertTriangle, CheckCircle2, ExternalLink,
  Loader2, ShieldCheck, Lock, Coins, ArrowRight,
} from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS,
  BUYER_ADDRESS, DEMO_DEAL_ID, DEMO_AMOUNT,
  ESCROW_ABI, STATUS_LABELS, buildExplorerTxUrl,
} from '@/escrow'

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = raw % 1_000_000n
  return `${whole}.${String(frac).padStart(6, '0').replace(/0+$/, '') || '0'} USDC`
}

function fmtAddr(addr: string): string {
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`
}

// Typed status label lookup — avoids unsafe Record<number,...> index access
function statusLabel(s: number): string {
  return STATUS_LABELS[s] ?? `STATUS_${s}`
}

// Status badge colors — typed tuple avoids unsafe member access
const STATUS_BG: [string, string, string, string, string, string] = [
  'bg-slate-700/50 text-slate-300',   // 0 CREATED
  'bg-amber-900/40 text-amber-300',   // 1 ACCEPTED
  'bg-sky-900/40 text-sky-300',       // 2 FUNDED
  'bg-violet-900/40 text-violet-300', // 3 EVIDENCE_SUBMITTED
  'bg-emerald-900/40 text-emerald-300', // 4 RELEASED
  'bg-rose-900/40 text-rose-300',     // 5 REFUNDED
]

function statusBadge(s: number) {
  const cls = (s >= 0 && s <= 5) ? STATUS_BG[s] : 'bg-slate-800 text-slate-400'
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold font-mono ${cls}`}>
      {statusLabel(s)}
    </span>
  )
}

// ── component ────────────────────────────────────────────────────────────────

export function FundDeal() {
  const { address, chainId } = useAccount()
  const { switchChain }      = useSwitchChain()

  const onWrongChain  = chainId !== ARC_TESTNET_CHAIN_ID
  const connectedAddr = address?.toLowerCase() ?? ''
  const onWrongSigner = connectedAddr !== BUYER_ADDRESS.toLowerCase()

  // ── live reads ──────────────────────────────────────────────────────────
  const { data: dealRaw, refetch: refetchDeal } = useReadContract({
    address:      ESCROW_ADDRESS,
    abi:          ESCROW_ABI,
    functionName: 'getDeal',
    args:         [DEMO_DEAL_ID],
    query:        { refetchInterval: 6_000 },
  })

  const deal       = dealRaw
  const dealStatus = deal ? Number(deal.status) : -1
  const isAccepted = dealStatus === 1
  const isFunded   = dealStatus === 2

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address:      USDC_ADDRESS,
    abi:          erc20Abi,
    functionName: 'allowance',
    args:         [BUYER_ADDRESS, ESCROW_ADDRESS],
    query:        { refetchInterval: 6_000 },
  })

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address:      USDC_ADDRESS,
    abi:          erc20Abi,
    functionName: 'balanceOf',
    args:         [BUYER_ADDRESS],
    query:        { enabled: !!address, refetchInterval: 6_000 },
  })

  const { data: escrowLocked, refetch: refetchLocked } = useReadContract({
    address:      ESCROW_ADDRESS,
    abi:          ESCROW_ABI,
    functionName: 'totalEscrowLocked',
    query:        { refetchInterval: 6_000 },
  })

  const allowanceOk = (allowance ?? 0n) >= DEMO_AMOUNT
  const balanceOk   = (balance   ?? 0n) >= DEMO_AMOUNT

  // ── simulate fundDeal(1) ─────────────────────────────────────────────────
  const { data: simResult, error: simError } = useSimulateContract({
    address:      ESCROW_ADDRESS,
    abi:          ESCROW_ABI,
    functionName: 'fundDeal',
    args:         [DEMO_DEAL_ID],
    query: {
      enabled: !onWrongChain && !onWrongSigner && isAccepted && allowanceOk && balanceOk,
      refetchInterval: 8_000,
    },
  })

  // ── write ────────────────────────────────────────────────────────────────
  const {
    writeContract,
    data: txHash,
    isPending: isWalletPending,
    error: writeError,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!isConfirmed) return
    void refetchDeal()
    void refetchAllowance()
    void refetchBalance()
    void refetchLocked()
  }, [isConfirmed, refetchDeal, refetchAllowance, refetchBalance, refetchLocked])

  const canSubmit = !!simResult && !isWalletPending && !isConfirming && !isFunded

  function handleFund() {
    if (!simResult) return
    writeContract(simResult.request)
  }

  const explorerHref = txHash ? buildExplorerTxUrl(txHash) : undefined

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-24 space-y-5">

      {/* header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold tracking-tight">Fund Escrow</h1>
          <span className="ml-auto text-xs text-slate-500 font-mono">TX4 of 6</span>
        </div>
        <p className="text-slate-400 text-sm leading-relaxed">
          Calls <code className="text-sky-300 text-xs bg-slate-800 px-1 py-0.5 rounded">fundDeal(1)</code> on
          the escrow contract. The contract pulls <strong>exactly 250,000 USDC base units (0.25 testnet USDC)</strong> from
          your wallet using the TX3 allowance. Native value is zero — no USDC is sent directly.
        </p>
      </div>

      {/* critical warning */}
      <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-200 space-y-1">
          <p className="font-semibold">USDC will be locked in the escrow contract after this transaction.</p>
          <p className="text-amber-300/80 text-xs leading-relaxed">
            Funds are released only when the Buyer calls <code className="bg-amber-900/40 px-1 rounded">approveAndRelease</code> (TX6),
            or refunded after expiry. This uses testnet USDC only — no real funds at risk.
          </p>
        </div>
      </div>

      {/* wrong chain */}
      {onWrongChain && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-200 text-sm flex-1">Wrong network — Arc Testnet (5042002) required.</span>
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            Switch
          </button>
        </div>
      )}

      {/* wrong signer */}
      {!onWrongChain && onWrongSigner && (
        <div className="rounded-xl border border-rose-600/40 bg-rose-950/30 p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          <div className="text-sm text-rose-200">
            <p className="font-semibold">Wrong wallet connected</p>
            <p className="text-rose-300/80 text-xs mt-0.5">
              TX4 must be signed by the Buyer:<br />
              <code className="font-mono text-rose-200 break-all">{BUYER_ADDRESS}</code>
            </p>
            <p className="text-rose-300/60 text-xs mt-1">Switch to Wallet A in MetaMask and reconnect.</p>
          </div>
        </div>
      )}

      {/* live deal state */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Deal State</span>
          <span className="ml-auto text-xs text-slate-600">refreshes every 6s</span>
        </div>
        <Row label="Deal ID"           value="#1" />
        <Row label="Status"            value={statusBadge(dealStatus)} />
        <Row label="Buyer"             value={<code className="text-xs font-mono text-slate-300">{fmtAddr(BUYER_ADDRESS)}</code>} />
        <Row label="Seller"            value={<code className="text-xs font-mono text-slate-300">{deal ? fmtAddr(deal.seller) : '…'}</code>} />
        <Row label="Amount"            value={<span className="text-sky-300 font-semibold text-sm">250,000 base units (0.25 USDC)</span>} />
        <Row label="Expiry"            value={deal ? new Date(Number(deal.expiration) * 1000).toUTCString() : '…'} />
        <Row label="totalEscrowLocked" value={<span className="font-mono text-xs">{escrowLocked !== undefined ? String(escrowLocked) : '…'}</span>} />
      </div>

      {/* pre-flight checks */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-2.5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Pre-flight Checks</p>
        <Check ok={isAccepted}
          label={`Deal status: ${dealStatus === 1 ? 'ACCEPTED ✓' : isFunded ? 'FUNDED (already done)' : `${statusLabel(dealStatus)} (need ACCEPTED)`}`} />
        <Check ok={allowanceOk}
          label={`Allowance: ${allowance !== undefined ? `${String(allowance)} base units${allowanceOk ? ' ≥ 250,000 ✓' : ' — insufficient'}` : 'loading…'}`} />
        <Check ok={balanceOk}
          label={`Buyer balance: ${balance !== undefined ? fmtUsdc(balance) : 'loading…'}${balanceOk ? '' : ' — insufficient'}`} />
        <Check ok={!onWrongChain && !onWrongSigner}
          label={`Signer: ${!onWrongSigner ? fmtAddr(BUYER_ADDRESS) + ' (Buyer ✓)' : 'wrong wallet — switch to Wallet A'}`} />
        {simError && (
          <p className="text-xs text-rose-400 font-mono mt-1 break-all">
            Simulation: {(simError as Error).message.slice(0, 140)}
          </p>
        )}
        {!simError && !simResult && isAccepted && allowanceOk && balanceOk && !onWrongChain && !onWrongSigner && (
          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Simulating fundDeal(1)…
          </p>
        )}
        {simResult && !isFunded && (
          <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
            <CheckCircle2 className="w-3 h-3" /> Simulation passed — ready to submit
          </p>
        )}
      </div>

      {/* tx parameters */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-2.5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Transaction Parameters</p>
        <Row label="Target contract" value={<code className="text-xs font-mono text-slate-300">{fmtAddr(ESCROW_ADDRESS)}</code>} />
        <Row label="Function"        value={<code className="text-xs font-mono text-sky-300">fundDeal(1)</code>} />
        <Row label="Native value"    value={<span className="text-emerald-400 text-xs font-semibold">0 (not payable)</span>} />
        <Row label="Chain ID"        value={<span className="font-mono text-xs">{ARC_TESTNET_CHAIN_ID}</span>} />
        <Row label="Signer"          value={<span className="text-amber-300 text-xs">Wallet A (Buyer)</span>} />
        <div className="mt-2 pt-2 border-t border-slate-800">
          <p className="text-xs text-slate-500 flex items-start gap-1.5">
            <Coins className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
            The escrow calls <code className="bg-slate-800 px-1 rounded">safeTransferFrom(buyer, escrow, 250000)</code> on
            USDC internally. You call only <code className="bg-slate-800 px-1 rounded">fundDeal(1)</code> — no direct USDC send.
          </p>
        </div>
      </div>

      {/* already funded */}
      {isFunded && !txHash && (
        <div className="rounded-xl border border-sky-600/40 bg-sky-950/30 p-4 flex gap-3">
          <CheckCircle2 className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
          <div className="text-sm text-sky-200">
            <p className="font-semibold">Deal #1 is already FUNDED</p>
            <p className="text-sky-300/70 text-xs mt-0.5">Proceed to TX5 — Submit Evidence.</p>
          </div>
        </div>
      )}

      {/* submit button */}
      {!isFunded && (
        <button
          disabled={!canSubmit}
          onClick={handleFund}
          className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2
            ${canSubmit
              ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
        >
          {isWalletPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Awaiting MetaMask…</>
          ) : isConfirming ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Confirming on-chain…</>
          ) : (
            <><Lock className="w-4 h-4" /> Fund Escrow — Lock 0.25 testnet USDC</>
          )}
        </button>
      )}

      {writeError && (
        <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-700/30 rounded-lg px-3 py-2 font-mono break-all">
          {(writeError as Error).message.slice(0, 200)}
        </p>
      )}

      {/* success receipt */}
      {isConfirmed && txHash && (
        <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/30 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-emerald-300">TX4 Confirmed — Escrow Funded</span>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-400/60 uppercase tracking-wider">Receipt</p>
            <Row label="Tx hash" value={
              explorerHref ? (
                <a href={explorerHref} target="_blank" rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 text-xs font-mono transition-colors">
                  {txHash.slice(0, 18)}…{txHash.slice(-10)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-xs font-mono text-slate-300">{txHash.slice(0, 18)}…</span>
              )
            } />
            <Row label="Deal status"         value={statusBadge(dealStatus)} />
            <Row label="totalEscrowLocked"   value={<span className="font-mono text-xs text-sky-300">{escrowLocked !== undefined ? String(escrowLocked) : '…'}</span>} />
          </div>

          {/* accounting verification */}
          <div className="rounded-lg bg-emerald-900/20 border border-emerald-700/30 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-emerald-400/80 uppercase tracking-wider">Accounting Verification</p>
            <Check ok={isFunded}                     label={`Deal status == FUNDED (2): ${isFunded ? '✓' : `actual ${dealStatus}`}`} />
            <Check ok={escrowLocked === DEMO_AMOUNT}  label={`totalEscrowLocked == 250,000: ${escrowLocked !== undefined ? String(escrowLocked) : '…'}`} />
            <p className="text-xs text-emerald-300/60 mt-1.5 leading-relaxed">
              Verify the USDC Transfer event on-chain via the explorer link above:
              Transfer on USDC contract from <code className="bg-emerald-900/30 px-1 rounded">0x2b270B…1D31</code> to{' '}
              <code className="bg-emerald-900/30 px-1 rounded">0x7f1af9…c7</code> with value <code className="bg-emerald-900/30 px-1 rounded">250000</code>.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1 text-sm text-emerald-300/70">
            <ArrowRight className="w-4 h-4 text-emerald-500" />
            TX4 complete. Switch to <strong className="text-emerald-300">Wallet B (Seller)</strong> for TX5 — Submit Evidence.
          </div>
        </div>
      )}

    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-start gap-2 text-xs ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span className="mt-px shrink-0">{ok ? '✓' : '○'}</span>
      <span>{label}</span>
    </div>
  )
}
