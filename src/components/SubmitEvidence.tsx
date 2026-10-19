/**
 * TX5 — Submit Evidence
 *
 * Signer: Seller (Wallet B) — 0x03aa5C68d92Afca1a624009D7380bA0Ad0BC8522
 * Target: ArcTradeProofEscrow.submitEvidence(dealId, evidenceHash)
 * Chain:  Arc Testnet (5042002)
 *
 * SYNTHETIC TEST DATA NOTICE:
 * The evidence record committed here is entirely fabricated for demonstration
 * purposes. No real goods, shipping, tracking numbers, carriers, delivery
 * verification, or AI document review are involved. The hash represents a
 * mock record only.
 *
 * The contract stores only the hash — never the plaintext — and does not
 * interpret its contents. Buyer retains sole authority to approve release.
 */

import { useEffect, useState } from 'react'
import {
  useReadContract, useSimulateContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, useAccount,
} from 'wagmi'
import {
  AlertTriangle, CheckCircle2, ExternalLink,
  Loader2, ShieldAlert, FileText, Clock,
} from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS, SELLER_ADDRESS,
  DEMO_DEAL_ID, ESCROW_ABI, STATUS_LABELS, buildExplorerTxUrl,
} from '@/escrow'

// ── Evidence document ────────────────────────────────────────────────────────

/**
 * SYNTHETIC TEST DATA — full canonical UTF-8 evidence plaintext (669 bytes).
 * No abbreviations. No ellipses. Every address written in full.
 * keccak256 of this exact string = EVIDENCE_HASH below.
 */
export const EVIDENCE_PLAINTEXT =
  '[SYNTHETIC TEST DATA] ArcTradeProof-Demo | EVIDENCE-2026-001 | DealId:1 | ' +
  'Buyer:0x2b270B135667f38bB58Fc9376F29c95173641D31 | ' +
  'Seller:0x03aa5C68d92Afca1a624009D7380bA0Ad0BC8522 | ' +
  'EscrowContract:0x7f1af92df34d8e58dba70688404de57276a42bc7 | ' +
  'Amount:250000 USDC-base-units | ' +
  'MockDeliveryRef:DEMO-SHIPMENT-001 | ' +
  'EvidenceType:SyntheticDocumentSubmission | ' +
  'MockRecipient:0x2b270B135667f38bB58Fc9376F29c95173641D31 | ' +
  'Warning:This is entirely synthetic mock data. No real goods, shipping, ' +
  'tracking, carrier, delivery verification, or AI document review are involved. ' +
  'This hash exists solely to satisfy the escrow contract evidence submission ' +
  'requirement in a controlled demonstration.'

/**
 * keccak256(EVIDENCE_PLAINTEXT) — verified by node/viem before commit.
 * Deterministic: same string always produces this hash.
 */
export const EVIDENCE_HASH =
  '0x2921f11c1f2a28d63e09bc37204d3129e62fb13c30f685e505b3ef1cd07d847e' as `0x${string}`

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${frac} USDC`
}

function fmtExpiry(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  return d.toUTCString()
}

function fmtAddr(a: string): string {
  return `${a.slice(0, 10)}…${a.slice(-8)}`
}

const STATUS_COLORS: Record<number, string> = {
  0: 'text-slate-400', 1: 'text-blue-400', 2: 'text-amber-400',
  3: 'text-violet-400', 4: 'text-emerald-400', 5: 'text-rose-400',
}

function statusLabel(s: number): string {
  return STATUS_LABELS[s] ?? `STATUS_${String(s)}`
}
function statusColor(s: number): string {
  return STATUS_COLORS[s] ?? 'text-slate-400'
}

// ── sub-components ───────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-500 text-xs shrink-0">{label}</span>
      <span className="text-slate-200 text-xs text-right break-all">{value}</span>
    </div>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs py-1 ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span className="shrink-0">{ok ? '✓' : '○'}</span>
      <span>{label}</span>
    </div>
  )
}

// ── component ────────────────────────────────────────────────────────────────

export function SubmitEvidence() {
  const { address, chainId } = useAccount()
  const { switchChain }      = useSwitchChain()

  const onWrongChain  = chainId !== ARC_TESTNET_CHAIN_ID
  const onWrongSigner = address?.toLowerCase() !== SELLER_ADDRESS.toLowerCase()

  // ── live reads ───────────────────────────────────────────────────────────
  const { data: dealRaw, refetch: refetchDeal } = useReadContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'getDeal', args: [DEMO_DEAL_ID],
    query: { refetchInterval: 6_000 },
  })

  type DealShape = {
    dealId: bigint; buyer: `0x${string}`; seller: `0x${string}`
    amount: bigint; expiration: bigint; status: number
    evidenceHash: `0x${string}`
  }
  const deal       = dealRaw as DealShape | undefined
  const dealStatus = deal ? Number(deal.status) : -1
  const isFunded   = dealStatus === 2
  const isDone     = dealStatus === 3

  // Tick every 30s so the expiry check stays fresh without calling Date.now in render
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(id)
  }, [])
  const notExpired = deal ? BigInt(nowSec) < deal.expiration : false

  const { data: locked, refetch: refetchLocked } = useReadContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'totalEscrowLocked',
    query: { refetchInterval: 6_000 },
  })

  // ── simulate ─────────────────────────────────────────────────────────────
  const { data: simResult, error: simError } = useSimulateContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'submitEvidence',
    args:    [DEMO_DEAL_ID, EVIDENCE_HASH],
    query: {
      enabled: !onWrongChain && !onWrongSigner && isFunded && notExpired,
      refetchInterval: 8_000,
    },
  })

  // ── write ────────────────────────────────────────────────────────────────
  const { writeContract, data: txHash, isPending: isWalletPending, error: writeError } =
    useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!isConfirmed) return
    void refetchDeal()
    void refetchLocked()
  }, [isConfirmed, refetchDeal, refetchLocked])

  const canSubmit = !!simResult && !isWalletPending && !isConfirming && !isConfirmed && !isDone

  function handleSubmit() {
    if (!simResult) return
    writeContract(simResult.request)
  }

  // ── derived ──────────────────────────────────────────────────────────────
  const evidenceOnChain = deal?.evidenceHash
  const evidenceMatches =
    isDone &&
    evidenceOnChain?.toLowerCase() === EVIDENCE_HASH.toLowerCase()
  const lockedCorrect =
    isDone && locked !== undefined && locked === 250_000n

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-24 space-y-5">

      {/* header */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Step 5 of 6
        </p>
        <h2 className="text-xl font-bold text-white">Submit Evidence</h2>
        <p className="text-slate-400 text-sm mt-1">
          Seller submits a hash of the synthetic mock delivery record.
          No USDC moves in this step.
        </p>
      </div>

      {/* synthetic data warning */}
      <div className="rounded-xl border border-amber-600/30 bg-amber-950/20 p-4 flex gap-3">
        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-amber-300 text-xs font-semibold">
            SYNTHETIC TEST DATA — No real goods or delivery
          </p>
          <p className="text-amber-400/80 text-xs leading-relaxed">
            The evidence record below is entirely fabricated for this demonstration.
            No real goods, shipping, tracking numbers, carriers, delivery verification,
            or AI document review are involved. This hash satisfies the contract's
            technical requirement only.
          </p>
        </div>
      </div>

      {/* wrong chain */}
      {onWrongChain && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-rose-400 shrink-0" />
            <span className="text-rose-300 text-sm">Wrong network — switch to Arc Testnet</span>
          </div>
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            className="shrink-0 text-xs bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            Switch
          </button>
        </div>
      )}

      {/* wrong signer */}
      {!onWrongChain && onWrongSigner && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 p-4 flex items-center gap-3">
          <ShieldAlert size={15} className="text-rose-400 shrink-0" />
          <div>
            <p className="text-rose-300 text-xs font-semibold">Wrong wallet connected</p>
            <p className="text-rose-400/70 text-xs mt-0.5">
              Switch MetaMask to Wallet B (Seller):
            </p>
            <code className="text-rose-300 text-[10px] font-mono break-all">{SELLER_ADDRESS}</code>
          </div>
        </div>
      )}

      {/* deal state */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Live Deal State — Deal #1
        </p>
        {deal ? (
          <div className="divide-y divide-slate-800/60">
            <Row label="Status" value={
              <span className={`font-semibold font-mono ${statusColor(dealStatus)}`}>
                {statusLabel(dealStatus)}
              </span>
            } />
            <Row label="Amount locked"   value={fmtUsdc(deal.amount)} />
            <Row label="Buyer"           value={<code className="font-mono text-[10px]">{fmtAddr(deal.buyer)}</code>} />
            <Row label="Seller"          value={<code className="font-mono text-[10px]">{fmtAddr(deal.seller)}</code>} />
            <Row label="Expiry"          value={
              <span className="flex items-center gap-1">
                <Clock size={10} className={notExpired ? 'text-emerald-400' : 'text-rose-400'} />
                {fmtExpiry(deal.expiration)}
              </span>
            } />
            <Row label="totalEscrowLocked" value={
              <span className="text-amber-400 font-semibold">
                {locked !== undefined ? `${String(locked)} base units` : '…'}
              </span>
            } />
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-4">Loading…</p>
        )}
      </div>

      {/* evidence document */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-sky-400 shrink-0" />
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Synthetic Evidence Record
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Full canonical plaintext (673 bytes UTF-8)</p>
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-3">
            <p className="text-[10px] font-mono text-slate-300 leading-relaxed break-all whitespace-pre-wrap">
              {EVIDENCE_PLAINTEXT}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <p className={`text-xs uppercase tracking-wider font-semibold ${
            isDone && evidenceMatches
              ? 'text-emerald-400'
              : 'text-amber-400'
          }`}>
            {isDone && evidenceMatches
              ? 'keccak256 hash — committed on-chain ✓'
              : 'Prepared keccak256 hash — NOT YET COMMITTED'}
          </p>
          <div className={`rounded-lg bg-slate-950 border p-3 ${
            isDone && evidenceMatches ? 'border-emerald-700/40' : 'border-amber-700/30'
          }`}>
            <code className="text-[10px] font-mono text-violet-300 break-all">{EVIDENCE_HASH}</code>
          </div>
          <p className="text-[10px] text-slate-600">
            Deterministic: computed once from the exact UTF-8 plaintext above, verified before commit.
            Never generated at runtime. Will become &quot;committed on-chain&quot; only after TX5 confirms
            and getDeal(1).evidenceHash matches this value.
          </p>
        </div>
      </div>

      {/* pre-flight checks */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pre-flight Checks</p>
        <Check ok={isFunded}
          label={`Deal status: ${isFunded ? 'FUNDED ✓' : isDone ? 'EVIDENCE_SUBMITTED (already done)' : `${statusLabel(dealStatus)} — expected FUNDED`}`} />
        <Check ok={notExpired}
          label={`Deadline: ${notExpired ? 'not expired ✓' : 'EXPIRED — refund path only'}`} />
        <Check ok={!onWrongChain && !onWrongSigner}
          label={`Signer: ${!onWrongSigner ? `${fmtAddr(SELLER_ADDRESS)} (Seller ✓)` : 'wrong wallet — switch to Wallet B'}`} />
        <Check ok={!!simResult}
          label={simResult ? 'Simulation passed ✓' : simError ? `Simulation failed: ${String(simError.message).slice(0, 80)}` : 'Simulating…'} />
      </div>

      {/* CTA */}
      {!isConfirmed && !isDone && (
        <div className="space-y-2">
          {writeError && (
            <p className="text-rose-400 text-xs bg-rose-950/30 border border-rose-800/40 rounded-lg px-3 py-2 break-all">
              {writeError.message}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all
              ${canSubmit
                ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-900/40 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
          >
            {isWalletPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Awaiting MetaMask…
              </span>
            ) : isConfirming ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Confirming on Arc Testnet…
              </span>
            ) : !canSubmit ? (
              'Complete pre-flight checks to enable'
            ) : (
              'Submit Evidence (TX5)'
            )}
          </button>
          <p className="text-center text-xs text-slate-600">
            Calls submitEvidence(1, {EVIDENCE_HASH.slice(0, 14)}…) on the escrow contract.
            No USDC moves. Native value = 0.
          </p>
        </div>
      )}

      {/* receipt */}
      {(isConfirmed || isDone) && txHash && (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p className="text-emerald-300 font-bold">TX5 Confirmed — Evidence Submitted</p>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <p className="text-slate-500 mb-1">Transaction hash</p>
              <code className="text-emerald-300 font-mono break-all text-[10px]">{txHash}</code>
            </div>
            <a
              href={buildExplorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
            >
              View on Arc Testnet Explorer <ExternalLink size={11} />
            </a>
          </div>

          <div className="border-t border-emerald-800/40 pt-4 space-y-1.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Post-TX Verification
            </p>
            <Check ok={dealStatus === 3}
              label={`Deal status: ${dealStatus === 3 ? 'EVIDENCE_SUBMITTED (3) ✓' : statusLabel(dealStatus)}`} />
            <Check ok={!!evidenceMatches}
              label={`evidenceHash on-chain: ${evidenceMatches ? 'matches ✓' : 'checking…'}`} />
            <Check ok={!!lockedCorrect}
              label={`totalEscrowLocked: ${locked !== undefined ? `${String(locked)} base units${lockedCorrect ? ' (250,000 ✓ unchanged)' : ' — unexpected'}` : 'loading…'}`} />
          </div>

          <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3">
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-white">Next:</span> Switch MetaMask back to{' '}
              <span className="font-semibold text-sky-300">Wallet A (Buyer)</span> and proceed to{' '}
              <span className="font-semibold text-sky-300">TX6 — Approve & Release</span>.
            </p>
          </div>
        </div>
      )}

      {/* already done (page reload case) */}
      {isDone && !txHash && (
        <div className="rounded-xl border border-violet-700/30 bg-violet-950/10 p-4 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-violet-400 shrink-0" />
          <div>
            <p className="text-violet-300 text-sm font-semibold">Evidence already submitted on-chain</p>
            <p className="text-violet-400/70 text-xs mt-0.5">
              Deal status is EVIDENCE_SUBMITTED (3). Proceed to TX6 — Release.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
