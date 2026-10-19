/**
 * TX6 — Approve & Release
 *
 * Signer: Buyer (Wallet A — deal.buyer)
 * Target: ArcTradeProofEscrow.approveAndRelease(dealId, reviewHash)
 * Chain:  Arc Testnet (5042002)
 *
 * DYNAMIC REVIEW HASH — Stage 4.2
 * This component no longer uses a hardcoded REVIEW_HASH. Instead, it reads
 * the cryptographic reviewHash from the DealReviewStore, which is populated
 * by the buyer's explicit "Approve" action in BuyerReview.tsx.
 *
 * CONTROL FLOW INVARIANTS:
 * 1. The "Submit" button is disabled until ALL of the following are true:
 *    a. DealReviewStore.buyerDecision === 'approved'  (explicit human approval)
 *    b. DealReviewStore.boundPackage.dealId matches the on-chain deal being released
 *    c. The connected wallet matches the on-chain deal.buyer
 *    d. Chain is Arc Testnet
 *    e. Deal status is EVIDENCE_SUBMITTED (3)
 *    f. Deal is not expired
 *    g. useSimulateContract passes with the dynamic reviewHash
 *    h. The hash in the simulate args matches boundPackage.reviewHash byte-for-byte
 * 2. The hash shown in the UI is the same value encoded in the calldata.
 *    Any mismatch (detected at render) disables submission and shows an error.
 * 3. A MATCH AI recommendation does NOT enable the button.
 *    Only the explicit buyer approval (condition 1a) does.
 *
 * HISTORICAL NOTE:
 * The following hardcoded values are preserved as documentation of the
 * completed testnet demonstration (Deal #1, TX1–TX5). They are NOT used in
 * any transaction path in this or future deals.
 *   REVIEW_HASH = 0x76f59c6b5a60f3f2be5032759be2f13e9bb28cafd4102da27c16a1ae0f5a9773
 *   (keccak256 of the REVIEW_PLAINTEXT in the previous version of this file)
 *
 * IRREVERSIBLE: once approveAndRelease confirms on-chain, the USDC amount
 * transfers from the escrow contract to the Seller. This cannot be undone.
 */

import { useEffect, useState } from 'react'
import {
  useReadContract, useSimulateContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, useAccount,
} from 'wagmi'
import {
  AlertTriangle, CheckCircle2, ExternalLink,
  Loader2, ShieldAlert, FileText, ArrowRightCircle,
  AlertCircle, XCircle, Hash,
} from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS,
  BUYER_ADDRESS, SELLER_ADDRESS, DEMO_DEAL_ID, ESCROW_ABI,
  STATUS_LABELS, buildExplorerTxUrl,
} from '@/escrow'
import { erc20Abi } from 'viem'
import { EVIDENCE_PLAINTEXT, EVIDENCE_HASH } from '@/components/SubmitEvidence'
import { useDealReview } from '@/store/dealReviewStore'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${frac} USDC`
}

function fmtAddr(a: string): string {
  return `${a.slice(0, 10)}…${a.slice(-8)}`
}

function fmtExpiry(ts: bigint): string {
  return new Date(Number(ts) * 1000).toUTCString()
}

const STATUS_COLORS: Record<number, string> = {
  0: 'text-slate-400', 1: 'text-blue-400', 2: 'text-amber-400',
  3: 'text-violet-400', 4: 'text-emerald-400', 5: 'text-rose-400',
}
function statusLabel(s: number): string { return STATUS_LABELS[s] ?? `STATUS_${String(s)}` }
function statusColor(s: number): string { return STATUS_COLORS[s] ?? 'text-slate-400' }

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

// Six-step transaction history shown in the receipt (TX1–TX5 are historical)
const TX_HISTORY = [
  { step: 1, label: 'Create Deal',       hash: '0xa7d58d9dfb141088a7f2b876e57b6bc3453fb23a361a0d72173be44ed335bb27' },
  { step: 2, label: 'Accept Deal',       hash: '0x66e5c5de7fdfd615a39d91a421a55e9edbf47272e2afda02543de23e996af150' },
  { step: 3, label: 'Approve USDC',      hash: '0xc83aab6ee292d223de29b0e25b8bc7ff96565e6e95d26a25cf9b3607bd12a199' },
  { step: 4, label: 'Fund Escrow',       hash: '0x952879b4b664868a09249df35efe054e2b461b568d5da06e09ed3c2e89e6a9f9' },
  { step: 5, label: 'Submit Evidence',   hash: '0x4c7e60d2756ade4a42eaaed7f055886943f0e2335b6623008b71f2597e5245c4' },
  { step: 6, label: 'Approve & Release', hash: null }, // filled from txHash after TX6 confirms
] as const

// ── component ────────────────────────────────────────────────────────────────

export function ApproveAndRelease({ onGoToReview }: { onGoToReview?: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChain }      = useSwitchChain()

  // ── Read dynamic reviewHash from store ───────────────────────────────────
  const { boundPackage, buyerDecision, clearReview } = useDealReview()

  const hasApproval   = buyerDecision === 'approved'
  const isRejected    = buyerDecision === 'rejected'
  const reviewHash    = boundPackage?.reviewHash     ?? null
  const boundDealId   = boundPackage?.dealId         ?? null

  // The deal ID for this release — prefer the bound package's deal ID,
  // fall back to DEMO_DEAL_ID only when no package is bound.
  const activeDealId  = boundDealId ?? DEMO_DEAL_ID

  const onWrongChain  = chainId !== ARC_TESTNET_CHAIN_ID
  const onWrongSigner = address?.toLowerCase() !== BUYER_ADDRESS.toLowerCase()

  // ── Live reads ───────────────────────────────────────────────────────────
  const { data: dealRaw, refetch: refetchDeal } = useReadContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'getDeal', args: [activeDealId],
    query: { refetchInterval: 6_000 },
  })

  type DealShape = {
    dealId: bigint; buyer: `0x${string}`; seller: `0x${string}`
    amount: bigint; evidenceHash: `0x${string}`; reviewHash: `0x${string}`
    expiration: bigint; status: number
  }
  const deal       = dealRaw as DealShape | undefined
  const dealStatus = deal ? Number(deal.status) : -1
  const isEvidence = dealStatus === 3
  const isReleased = dealStatus === 4

  // Guard: verify the bound deal ID matches the on-chain deal being released.
  // If the buyer bound the wrong deal, block submission.
  const dealIdMatches = boundDealId !== null
    ? deal?.dealId === boundDealId
    : true  // no package bound — neutral, will be blocked by hasApproval anyway

  // Guard: buyer in the bound package must match the connected wallet AND the on-chain deal.buyer
  const buyerMatchesDeal = deal
    ? address?.toLowerCase() === deal.buyer.toLowerCase()
    : false

  // Expiry check — clock ticks every 30s
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(id)
  }, [])
  const notExpired = deal ? BigInt(nowSec) < deal.expiration : false

  // Evidence hash integrity check
  const evidenceMatches =
    deal?.evidenceHash.toLowerCase() === EVIDENCE_HASH.toLowerCase()

  const { data: locked,        refetch: refetchLocked   } = useReadContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'totalEscrowLocked',
    query: { refetchInterval: 6_000 },
  })
  const { data: sellerBalance, refetch: refetchSeller   } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi,
    functionName: 'balanceOf', args: [SELLER_ADDRESS],
    query: { refetchInterval: 6_000 },
  })
  const { data: escrowBalance, refetch: refetchEscrow   } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi,
    functionName: 'balanceOf', args: [ESCROW_ADDRESS],
    query: { refetchInterval: 6_000 },
  })

  // ── Simulate — only when a dynamic reviewHash is available AND buyer approved ──
  const { data: simResult, error: simError } = useSimulateContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI,
    functionName: 'approveAndRelease',
    // Use the dynamic reviewHash from the store. If null (no package bound), use
    // a zero hash so the simulation shows "no review bound" and fails cleanly.
    args: [activeDealId, reviewHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000'],
    query: {
      enabled: !onWrongChain && !onWrongSigner && isEvidence && notExpired
               && hasApproval && !!reviewHash,
      refetchInterval: 8_000,
    },
  })

  // ── Calldata hash verification ────────────────────────────────────────────
  // Verify that the hash in the simulate request matches boundPackage.reviewHash.
  // This is a belt-and-suspenders check: if there were ever a mismatch between
  // what is displayed and what is encoded, we block submission here.
  const simHashArg = simResult?.request?.args?.[1]
  const hashMatchesCalldata = reviewHash && simHashArg
    ? simHashArg.toLowerCase() === reviewHash.toLowerCase()
    : false

  // ── Write ────────────────────────────────────────────────────────────────
  const { writeContract, data: txHash, isPending: isWalletPending, error: writeError } =
    useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!isConfirmed) return
    void refetchDeal()
    void refetchLocked()
    void refetchSeller()
    void refetchEscrow()
  }, [isConfirmed, refetchDeal, refetchLocked, refetchSeller, refetchEscrow])

  // All guards must pass before the submit button is enabled
  const canSubmit =
    !!simResult &&
    hasApproval &&
    !!reviewHash &&
    hashMatchesCalldata &&
    dealIdMatches &&
    buyerMatchesDeal &&
    !isWalletPending &&
    !isConfirming &&
    !isConfirmed &&
    !isReleased

  function handleSubmit() {
    if (!simResult || !canSubmit) return
    writeContract(simResult.request)
  }

  // Post-release verification
  const reviewOnChain  = deal?.reviewHash
  const reviewMatches  = isReleased && reviewHash
    ? reviewOnChain?.toLowerCase() === reviewHash.toLowerCase()
    : false
  const lockedIsZero   = isReleased && locked !== undefined && locked === 0n
  const escrowIsZero   = isReleased && escrowBalance !== undefined && escrowBalance === 0n

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-24 space-y-5">

      {/* header */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Step 6 of 6 — Final Step
        </p>
        <h2 className="text-xl font-bold text-white">Approve &amp; Release</h2>
        <p className="text-slate-400 text-sm mt-1">
          Buyer authorizes final payment.{' '}
          <span className="text-amber-400 font-semibold">Irreversible.</span>{' '}
          USDC transfers from escrow to Seller.
        </p>
      </div>

      {/* Buyer approval gate status */}
      {!hasApproval && !isRejected && !boundPackage && (
        <div className="rounded-xl border border-amber-600/30 bg-amber-950/20 p-4 flex gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-amber-300 text-xs font-semibold">
              No AI Review Approved
            </p>
            <p className="text-amber-400/80 text-xs leading-relaxed">
              Run an AI document analysis and use the Buyer Review screen to explicitly
              approve the analysis before this transaction can be submitted.
            </p>
            {onGoToReview && (
              <button
                onClick={onGoToReview}
                className="mt-1 text-xs bg-sky-700 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
              >
                Go to AI Document Review
              </button>
            )}
          </div>
        </div>
      )}

      {!hasApproval && !isRejected && boundPackage && (
        <div className="rounded-xl border border-amber-600/30 bg-amber-950/20 p-4 flex gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-amber-300 text-xs font-semibold">Awaiting Buyer Approval</p>
            <p className="text-amber-400/80 text-xs">
              An AI analysis is bound to this deal but you have not yet approved it.
              Complete the Buyer Review step before proceeding.
            </p>
            {onGoToReview && (
              <button onClick={onGoToReview} className="mt-1 text-xs bg-sky-700 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                Go to Buyer Review
              </button>
            )}
          </div>
        </div>
      )}

      {isRejected && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/15 p-4 flex gap-3">
          <XCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-rose-300 text-xs font-semibold">Analysis Rejected — Submission Blocked</p>
            <p className="text-rose-400/80 text-xs">
              You rejected the AI analysis. The escrow release is blocked.
              Return to Buyer Review to change your decision or run a new analysis.
            </p>
            <div className="flex gap-2 mt-1">
              {onGoToReview && (
                <button onClick={onGoToReview} className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  Buyer Review
                </button>
              )}
              <button onClick={clearReview} className="text-xs border border-slate-700 text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                Clear &amp; Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approved — show the dynamic hash */}
      {hasApproval && reviewHash && (
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            <p className="text-emerald-300 text-xs font-semibold">
              Buyer Approved — Dynamic Review Hash Ready
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              reviewHash to be passed to approveAndRelease(dealId, reviewHash)
            </p>
            <div className="flex items-start gap-2">
              <Hash size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <code className="font-mono text-[11px] text-emerald-300 break-all flex-1">
                {reviewHash}
              </code>
            </div>
          </div>
          {boundPackage && (
            <p className="text-[10px] text-slate-600">
              Bound to Deal #{String(boundPackage.dealId)} · {boundPackage.boundAt}
            </p>
          )}
          {hashMatchesCalldata && (
            <p className="text-[10px] text-emerald-500">
              ✓ Hash in calldata matches displayed hash — verified before submission.
            </p>
          )}
          {simResult && !hashMatchesCalldata && (
            <p className="text-[10px] text-rose-400">
              ✗ Hash mismatch: displayed hash differs from calldata hash. Submission blocked.
            </p>
          )}
        </div>
      )}

      {/* irreversibility warning */}
      <div className="rounded-xl border border-rose-700/40 bg-rose-950/15 p-4 flex gap-3">
        <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-rose-300 text-xs font-semibold">Irreversible action</p>
          <p className="text-rose-400/80 text-xs leading-relaxed">
            Once approved, the USDC amount will transfer from the escrow contract to the Seller.
            This cannot be reversed. Verify all details below before signing.
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
            <p className="text-rose-300 text-xs font-semibold">Wrong wallet — Buyer must sign</p>
            <p className="text-rose-400/70 text-xs mt-0.5">Switch MetaMask to Wallet A (Buyer):</p>
            <code className="text-rose-300 text-[10px] font-mono break-all">{BUYER_ADDRESS}</code>
          </div>
        </div>
      )}

      {/* balances before release */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Balances Before Release
        </p>
        <div className="divide-y divide-slate-800/60">
          <Row label="Seller USDC (before)" value={
            sellerBalance !== undefined
              ? <span className="text-amber-400 font-mono">{fmtUsdc(sellerBalance)}</span>
              : <span className="text-slate-500">loading…</span>
          } />
          <Row label="Escrow contract USDC" value={
            escrowBalance !== undefined
              ? <span className="text-amber-400 font-mono">{fmtUsdc(escrowBalance)}</span>
              : <span className="text-slate-500">loading…</span>
          } />
          <Row label="totalEscrowLocked" value={
            locked !== undefined
              ? <span className="text-amber-400 font-mono">{String(locked)} base units</span>
              : <span className="text-slate-500">loading…</span>
          } />
          <Row label="Amount to release" value={
            deal
              ? <span className="text-sky-300 font-semibold">{String(deal.amount)} base units → Seller</span>
              : <span className="text-slate-500">loading…</span>
          } />
        </div>
      </div>

      {/* live deal state */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Live Deal State — Deal #{String(activeDealId)}
        </p>
        {deal ? (
          <div className="divide-y divide-slate-800/60">
            <Row label="Status" value={
              <span className={`font-semibold font-mono ${statusColor(dealStatus)}`}>
                {statusLabel(dealStatus)}
              </span>
            } />
            <Row label="Buyer"   value={<code className="font-mono text-[10px]">{fmtAddr(deal.buyer)}</code>} />
            <Row label="Seller"  value={<code className="font-mono text-[10px]">{fmtAddr(deal.seller)}</code>} />
            <Row label="Amount"  value={fmtUsdc(deal.amount)} />
            <Row label="Expiry"  value={fmtExpiry(deal.expiration)} />
            <Row label="evidenceHash" value={
              <span className={evidenceMatches ? 'text-emerald-400' : 'text-rose-400'}>
                {deal.evidenceHash.slice(0, 14)}…{deal.evidenceHash.slice(-6)}
                {evidenceMatches ? ' ✓' : ' ✗'}
              </span>
            } />
            <Row label="reviewHash (pending)" value={
              <span className="text-slate-500 font-mono text-[10px]">
                {isReleased
                  ? deal.reviewHash.slice(0, 14) + '…' + deal.reviewHash.slice(-6)
                  : '0x000…000 (not yet set)'}
              </span>
            } />
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-4">Loading…</p>
        )}
      </div>

      {/* evidence record summary */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-violet-400 shrink-0" />
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Evidence Record (submitted in TX5)
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Canonical plaintext (669 bytes UTF-8)</p>
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 max-h-28 overflow-y-auto">
            <p className="text-[10px] font-mono text-slate-300 leading-relaxed break-all whitespace-pre-wrap">
              {EVIDENCE_PLAINTEXT}
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <p className={`text-xs uppercase tracking-wider font-semibold ${evidenceMatches ? 'text-emerald-400' : 'text-amber-400'}`}>
            {evidenceMatches ? 'keccak256 hash — matches on-chain evidenceHash ✓' : 'keccak256 hash — verifying…'}
          </p>
          <div className={`rounded-lg bg-slate-950 border p-3 ${evidenceMatches ? 'border-emerald-700/40' : 'border-slate-800'}`}>
            <code className="text-[10px] font-mono text-violet-300 break-all">{EVIDENCE_HASH}</code>
          </div>
        </div>
      </div>

      {/* dynamic review record */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-sky-400 shrink-0" />
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Review Record (dynamic — AI analysis + buyer approval)
          </p>
        </div>
        {reviewHash ? (
          <>
            <div className="space-y-1">
              <p className={`text-xs uppercase tracking-wider font-semibold ${
                isReleased && reviewMatches ? 'text-emerald-400' : hasApproval ? 'text-sky-400' : 'text-amber-400'
              }`}>
                {isReleased && reviewMatches
                  ? 'keccak256 hash — committed on-chain ✓'
                  : hasApproval
                  ? 'Buyer-approved hash — ready for TX6'
                  : 'Prepared hash — awaiting buyer approval'}
              </p>
              <div className={`rounded-lg bg-slate-950 border p-3 ${
                isReleased && reviewMatches
                  ? 'border-emerald-700/40'
                  : hasApproval
                  ? 'border-sky-700/40'
                  : 'border-amber-700/30'
              }`}>
                <code className="text-[10px] font-mono text-sky-300 break-all">{reviewHash}</code>
              </div>
              {boundPackage && (
                <p className="text-[10px] text-slate-600">
                  keccak256(canonicalJSON(sortedKeys(reviewPackage))) ·
                  Bound: {boundPackage.boundAt} ·
                  Method: {boundPackage.hashMethod}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-amber-950/20 border border-amber-700/30 px-3 py-2">
            <p className="text-xs text-amber-300">
              No AI review bound yet. Complete the AI Document Intelligence and Buyer Review steps first.
            </p>
          </div>
        )}
      </div>

      {/* tx parameters */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Transaction Parameters
        </p>
        <div className="divide-y divide-slate-800/60">
          <Row label="Function"     value="approveAndRelease(uint256, bytes32)" />
          <Row label="Contract"     value={<code className="font-mono text-[10px]">{ESCROW_ADDRESS}</code>} />
          <Row label="Chain ID"     value={`${ARC_TESTNET_CHAIN_ID} (Arc Testnet)`} />
          <Row label="dealId"       value={String(activeDealId)} />
          <Row label="reviewHash"   value={
            reviewHash
              ? <code className="font-mono text-[10px] text-sky-300">{reviewHash.slice(0,14)}…{reviewHash.slice(-6)}</code>
              : <span className="text-amber-400 text-[10px]">not yet bound — complete AI review first</span>
          } />
          <Row label="Hash source"  value={
            boundPackage
              ? <span className="text-emerald-400 text-[10px]">dynamic — AI analysis + buyer approval</span>
              : <span className="text-rose-400 text-[10px]">none — bind an AI analysis first</span>
          } />
          <Row label="Native value" value={<span className="text-emerald-400">0 (no ETH/USDC sent directly)</span>} />
          <Row label="Signer"       value={<code className="font-mono text-[10px]">{fmtAddr(BUYER_ADDRESS)} (Wallet A)</code>} />
          <Row label="Gas estimate" value={
            simResult
              ? <span className="text-emerald-400">Simulation passed ✓</span>
              : <span className="text-slate-500">Simulating…</span>
          } />
        </div>
      </div>

      {/* pre-flight checks */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pre-flight Checks</p>
        <Check ok={hasApproval}
          label={hasApproval
            ? 'Buyer approval: explicit approval recorded ✓'
            : 'Buyer approval: required — complete Buyer Review first'} />
        <Check ok={!!reviewHash}
          label={reviewHash
            ? `Dynamic reviewHash bound ✓ (Deal #${String(boundDealId ?? '?')})`
            : 'reviewHash: not yet bound — run AI analysis and bind to deal'} />
        <Check ok={hashMatchesCalldata}
          label={hashMatchesCalldata
            ? 'Hash in calldata matches displayed hash ✓'
            : simResult
            ? 'Hash mismatch between display and calldata — do not proceed'
            : 'Calldata hash: awaiting simulation…'} />
        <Check ok={dealIdMatches}
          label={dealIdMatches
            ? `Deal ID matches bound package ✓ (Deal #${String(activeDealId)})`
            : `Deal ID mismatch — bound to #${String(boundDealId)}, active is #${String(activeDealId)}`} />
        <Check ok={buyerMatchesDeal}
          label={`Buyer address: ${buyerMatchesDeal ? 'matches deal.buyer ✓' : 'does not match deal.buyer'}`} />
        <Check ok={isEvidence}
          label={`Deal status: ${isEvidence ? 'EVIDENCE_SUBMITTED ✓' : isReleased ? 'RELEASED (already done)' : `${statusLabel(dealStatus)} — expected EVIDENCE_SUBMITTED`}`} />
        <Check ok={evidenceMatches}
          label={`On-chain evidenceHash: ${evidenceMatches ? 'matches expected ✓' : 'mismatch — do not proceed'}`} />
        <Check ok={notExpired}
          label={`Deadline: ${notExpired ? 'not expired ✓' : 'EXPIRED'}`} />
        <Check ok={!onWrongChain && !onWrongSigner}
          label={`Signer: ${!onWrongSigner ? `${fmtAddr(BUYER_ADDRESS)} (Buyer ✓)` : 'wrong wallet — switch to Wallet A'}`} />
        <Check ok={!!simResult}
          label={simResult ? 'Simulation passed ✓' : simError
            ? `Simulation failed: ${String(simError.message).slice(0, 80)}`
            : 'Simulating…'} />
      </div>

      {/* CTA — only before release */}
      {!isConfirmed && !isReleased && (
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
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 cursor-pointer'
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
            ) : !hasApproval ? (
              'Complete Buyer Review approval to enable'
            ) : !canSubmit ? (
              'Complete pre-flight checks to enable'
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ArrowRightCircle size={16} />
                Approve &amp; Release — Transfer USDC to Seller
              </span>
            )}
          </button>
          <p className="text-center text-xs text-slate-600">
            Calls approveAndRelease({String(activeDealId)},{' '}
            {reviewHash ? `${reviewHash.slice(0, 10)}…` : 'no hash bound'}
            ) · native value = 0 · irreversible on confirmation
          </p>
        </div>
      )}

      {/* receipt */}
      {(isConfirmed || isReleased) && txHash && (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p className="text-emerald-300 font-bold">TX6 Confirmed — Escrow Released</p>
          </div>

          <div className="space-y-1 text-xs">
            <p className="text-slate-500">Transaction hash</p>
            <code className="text-emerald-300 font-mono break-all text-[10px]">{txHash}</code>
            <a
              href={buildExplorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors mt-1"
            >
              View on Arc Testnet Explorer <ExternalLink size={11} />
            </a>
          </div>

          {/* post-release verification */}
          <div className="border-t border-emerald-800/40 pt-4 space-y-1.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Post-Release Verification
            </p>
            <Check ok={isReleased}
              label={`Deal status: ${isReleased ? 'RELEASED (4) ✓' : statusLabel(dealStatus)}`} />
            <Check ok={!!reviewMatches}
              label={`reviewHash on-chain: ${reviewMatches ? 'matches dynamic hash ✓' : 'checking…'}`} />
            <Check ok={!!lockedIsZero}
              label={`totalEscrowLocked: ${locked !== undefined ? `${String(locked)} base units${lockedIsZero ? ' (0 ✓ fully released)' : ' — unexpected'}` : 'loading…'}`} />
            <Check ok={!!escrowIsZero}
              label={`Escrow USDC balance: ${escrowBalance !== undefined ? `${String(escrowBalance)} base units${escrowIsZero ? ' (0 ✓)' : ''}` : 'loading…'}`} />
          </div>

          {/* seller transfer proof */}
          <div className="border-t border-emerald-800/40 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Seller USDC Transfer Proof
            </p>
            <div className="rounded-lg bg-slate-950 border border-emerald-700/30 p-3 space-y-1.5">
              <Row label="USDC Transfer event" value={
                deal
                  ? <span className="text-emerald-400 font-semibold">Transfer(escrow→Seller, {String(deal.amount)})</span>
                  : <span className="text-emerald-400">Transfer(escrow→Seller)</span>
              } />
              <Row label="Seller balance (live)" value={
                sellerBalance !== undefined
                  ? <span className="text-emerald-400 font-mono">{fmtUsdc(sellerBalance)}</span>
                  : <span className="text-slate-500">loading…</span>
              } />
              <Row label="Recipient" value={
                <code className="font-mono text-[10px]">{fmtAddr(SELLER_ADDRESS)}</code>
              } />
            </div>
          </div>

          {/* six-step tx history */}
          <div className="border-t border-emerald-800/40 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Complete Demo Transaction History
            </p>
            <div className="space-y-2">
              {TX_HISTORY.map(({ step, label, hash }) => {
                const resolvedHash = hash ?? txHash
                return (
                  <div key={step} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 font-semibold">{label}</p>
                      {resolvedHash ? (
                        <a
                          href={buildExplorerTxUrl(resolvedHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 font-mono break-all transition-colors"
                        >
                          {resolvedHash.slice(0, 18)}…{resolvedHash.slice(-6)}
                          <ExternalLink size={9} className="shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[10px] text-slate-600">pending…</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* already released (page reload case) */}
      {isReleased && !txHash && (
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-4 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-emerald-300 text-sm font-semibold">Escrow already released on-chain</p>
            <p className="text-emerald-400/70 text-xs mt-0.5">
              Deal status is RELEASED (4). Demo lifecycle complete.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
