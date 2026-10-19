/**
 * BuyerReview — the human-control gate between AI analysis and fund release.
 *
 * WHAT THIS SCREEN DOES:
 *   1. Shows the buyer the full AI evidence package bound to their deal.
 *   2. Displays extracted commercial terms, discrepancies, risk indicators,
 *      AI limitations, and the cryptographic review hash.
 *   3. Requires the buyer to make an EXPLICIT decision: Approve or Reject.
 *   4. Once approved, the dynamic reviewHash becomes available to
 *      ApproveAndRelease.tsx for submission in the escrow transaction.
 *
 * WHAT THIS SCREEN NEVER DOES:
 *   - Never submits a transaction automatically.
 *   - Never sets buyerDecision to 'approved' programmatically.
 *   - Never releases funds as a consequence of AI output.
 *   - A MATCH recommendation does NOT cause approval or fund release.
 *
 * AI is advisory only. The buyer's explicit click is the only path to approval.
 */

import { useState } from 'react'
import {
  AlertTriangle, CheckCircle2, XCircle, ShieldAlert,
  FileText, ChevronDown, ChevronUp, Hash, Info,
} from 'lucide-react'
import { useDealReview } from '@/store/dealReviewStore'
import { canonicalise } from '@/lib/reviewHash'
import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '@/lib/apiClient'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAddr(a: string): string {
  return `${a.slice(0, 10)}…${a.slice(-8)}`
}

function fmtUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${frac} USDC`
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    MATCH:                 'bg-emerald-500/15 text-emerald-300 border-emerald-700/40',
    MISMATCH:              'bg-rose-500/15 text-rose-300 border-rose-700/40',
    MISSING_INFORMATION:   'bg-amber-500/15 text-amber-300 border-amber-700/40',
    REQUIRES_HUMAN_REVIEW: 'bg-violet-500/15 text-violet-300 border-violet-700/40',
    PROCEED:               'bg-emerald-500/15 text-emerald-300 border-emerald-700/40',
    REVIEW_REQUIRED:       'bg-amber-500/15 text-amber-300 border-amber-700/40',
    MISMATCH_DETECTED:     'bg-rose-500/15 text-rose-300 border-rose-700/40',
    INSUFFICIENT_DATA:     'bg-slate-500/15 text-slate-300 border-slate-700/40',
  }
  const cls = colors[status] ?? 'bg-slate-500/15 text-slate-300 border-slate-700/40'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wide ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function ConfBadge({ conf }: { conf: string }) {
  const cls =
    conf === 'high'      ? 'text-emerald-400' :
    conf === 'medium'    ? 'text-amber-400'   :
    conf === 'low'       ? 'text-rose-400'    :
    conf === 'not_found' ? 'text-slate-500'   : 'text-slate-400'
  return <span className={`text-[10px] font-medium uppercase ${cls}`}>{conf.replace('_', ' ')}</span>
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-500 text-xs shrink-0 w-32">{label}</span>
      <span className="text-slate-200 text-xs text-right break-all flex-1">{value}</span>
    </div>
  )
}

function Collapsible({ title, badge, children, defaultOpen = false }: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">{title}</span>
          {badge}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500 shrink-0" /> : <ChevronDown size={14} className="text-slate-500 shrink-0" />}
      </button>
      {open && <div className="px-4 py-3 bg-slate-950/40">{children}</div>}
    </div>
  )
}

function ExtractedTermsSection({ doc, label }: { doc: ExtractedDocument; label: string }) {
  const fields: [string, ExtractedDocument[keyof ExtractedDocument]][] = [
    ['Document Type',   doc.documentType],
    ['Doc Number',      doc.documentNumber],
    ['Buyer',           doc.buyerName],
    ['Seller',          doc.sellerName],
    ['Total Amount',    doc.totalAmount],
    ['Currency',        doc.currency],
    ['Payment Terms',   doc.paymentTerms],
    ['Delivery',        doc.deliveryConditions],
    ['Issue Date',      doc.issueDate],
    ['Due Date',        doc.dueDate],
  ]
  type EF = { value: string | null; confidence: string }

  return (
    <Collapsible title={label} badge={<span className="text-[10px] text-slate-500">{doc.filename}</span>}>
      <div className="space-y-1">
        {fields.map(([name, field]) => {
          const f = field as EF
          return (
            <div key={name} className="flex items-start gap-3 text-xs py-1">
              <span className="w-28 shrink-0 text-slate-500">{name}</span>
              <span className="text-slate-200 flex-1">
                {f.value ?? <span className="text-slate-600 italic">not found</span>}
              </span>
              <ConfBadge conf={f.confidence} />
            </div>
          )
        })}
        {doc.items.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-800/60">
            <p className="text-[10px] text-slate-500 mb-1">Line Items ({doc.items.length})</p>
            {doc.items.map((item, i) => (
              <div key={i} className="text-[11px] text-slate-300 py-0.5">
                {item.description} · Qty {item.quantity ?? '?'} · {item.unitPrice ?? '?'}/unit · {item.lineTotal ?? '?'}
              </div>
            ))}
          </div>
        )}
        {doc.rawWarnings.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1">
            {doc.rawWarnings.map((w, i) => (
              <p key={i} className="text-[10px] text-amber-400">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        AI model: {doc.model} · Extracted: {doc.extractedAt}
      </p>
    </Collapsible>
  )
}

function DiscrepanciesSection({ comparison }: { comparison: ComparisonResult }) {
  const hasIssues = comparison.overallStatus !== 'MATCH'
  return (
    <Collapsible
      title="Deterministic Field Comparison"
      badge={<StatusBadge status={comparison.overallStatus} />}
      defaultOpen={hasIssues}
    >
      {comparison.monetaryMismatch && comparison.exactDiscrepancyUsdc && (
        <div className="mb-3 px-3 py-2 bg-rose-950/30 border border-rose-800/40 rounded-lg">
          <p className="text-xs text-rose-300 font-semibold">
            ⚠ Monetary mismatch: {comparison.exactDiscrepancyUsdc}
          </p>
        </div>
      )}
      <div className="divide-y divide-slate-800/60">
        {comparison.fields.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 text-[11px] py-2 items-start">
            <span className="text-slate-400 font-medium">{f.fieldName}</span>
            <span className="text-slate-300">{f.poValue ?? <span className="text-slate-600">—</span>}</span>
            <span className="text-slate-300">{f.invoiceValue ?? <span className="text-slate-600">—</span>}</span>
            <StatusBadge status={f.status} />
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-[10px] text-slate-600 mt-1 pt-1 border-t border-slate-800/40">
        <span>PO value</span><span>Invoice value</span>
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        Compared: {comparison.comparedAt} · Engine: deterministic (no AI)
      </p>
    </Collapsible>
  )
}

function AdvisorySection({ report }: { report: AdvisoryReport }) {
  const bg: Record<string, string> = {
    PROCEED:           'border-emerald-800/40 bg-emerald-950/20',
    REVIEW_REQUIRED:   'border-amber-800/40 bg-amber-950/20',
    MISMATCH_DETECTED: 'border-rose-800/40 bg-rose-950/20',
    INSUFFICIENT_DATA: 'border-slate-700/40 bg-slate-900/30',
  }
  return (
    <Collapsible
      title="AI Advisory Report"
      badge={<StatusBadge status={report.overallAssessment} />}
      defaultOpen
    >
      <div className={`rounded-lg px-3 py-2 mb-3 border text-[11px] text-amber-300 ${bg[report.overallAssessment] ?? 'border-slate-700/40'}`}>
        ⚠ AI ADVISORY ONLY — This report cannot verify real-world delivery.
        A MATCH result does NOT authorize payment. Only the buyer can release funds.
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Executive Summary</p>
          <p className="text-slate-200 leading-relaxed">{report.executiveSummary}</p>
        </div>

        {report.discrepancyExplanations.length > 0 && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">AI Discrepancy Explanations</p>
            <div className="space-y-2">
              {report.discrepancyExplanations.map((d, i) => (
                <div key={i} className="border border-slate-700/40 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-300 font-medium">{d.field}</span>
                    <StatusBadge status={d.severity.toUpperCase()} />
                  </div>
                  <p className="text-slate-400">{d.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.missingDocumentation.length > 0 && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Missing Documentation</p>
            <ul className="space-y-1">
              {report.missingDocumentation.map((m, i) => (
                <li key={i} className="text-amber-400 flex gap-2"><span>·</span>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {report.riskIndicators.length > 0 && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Risk Indicators</p>
            <ul className="space-y-1">
              {report.riskIndicators.map((r, i) => (
                <li key={i} className="text-rose-400 flex gap-2"><span>⚠</span>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {report.recommendedNextSteps.length > 0 && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Recommended Next Steps</p>
            <ul className="space-y-1">
              {report.recommendedNextSteps.map((s, i) => (
                <li key={i} className="text-slate-300 flex gap-2"><span className="text-sky-500">›</span>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-slate-800/60 pt-2 space-y-1">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">AI Limitations</p>
          {report.limitations.map((l, i) => (
            <p key={i} className="text-slate-600 text-[10px]">· {l}</p>
          ))}
          <p className="text-slate-500 text-[10px] mt-1">
            Model: {report.model} · Generated: {report.generatedAt}
          </p>
        </div>
      </div>
    </Collapsible>
  )
}

function HashVerificationSection({
  reviewHash, hashMethod, boundAt, po, invoice, comparison, report,
}: {
  reviewHash: `0x${string}`
  hashMethod: string
  boundAt: string
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport
}) {
  const [showCanonical, setShowCanonical] = useState(false)
  const canonical = canonicalise({ po, invoice, comparison, report, hashTimestamp: boundAt })

  return (
    <Collapsible title="Cryptographic Review Hash" badge={
      <span className="text-[10px] text-amber-400 font-semibold">PREPARED — NOT ON-CHAIN</span>
    } defaultOpen>
      <div className="space-y-3">
        <div className="bg-amber-950/20 border border-amber-700/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
          <p className="font-semibold">This hash is not committed to the blockchain until TX6 confirms.</p>
          <p className="mt-0.5 text-amber-400/70">
            The exact value shown here will be passed as <code className="bg-slate-900 px-1 rounded">reviewHash</code> to{' '}
            <code className="bg-slate-900 px-1 rounded">approveAndRelease(dealId, reviewHash)</code>.
            The UI verifies calldata contains this value before enabling submission.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">keccak256 Review Hash</p>
          <div className="flex items-start gap-2">
            <Hash size={12} className="text-sky-400 shrink-0 mt-0.5" />
            <code className="font-mono text-[11px] text-sky-300 break-all flex-1">{reviewHash}</code>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[10px]">
          <div>
            <p className="text-slate-500 uppercase tracking-wide">Bound At</p>
            <p className="text-slate-300">{boundAt}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wide">AI Model</p>
            <p className="text-slate-300">{report.model}</p>
          </div>
        </div>

        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Hash Method</p>
          <code className="text-[10px] text-slate-400 font-mono">{hashMethod}</code>
        </div>

        <div className="space-y-1 text-[10px] text-slate-500 border-t border-slate-800/60 pt-2">
          <p>· Covers: extracted fields (PO + Invoice), field comparison, AI advisory narrative, bound timestamp.</p>
          <p>· Reproduce: <code className="bg-slate-900 px-0.5 rounded">keccak256(toBytes(canonicalJSON(sortedKeys(package))))</code></p>
          <p>· The hash changes if any extracted field, comparison result, or AI narrative changes.</p>
        </div>

        <button
          onClick={() => setShowCanonical(o => !o)}
          className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
        >
          {showCanonical ? 'Hide canonical JSON ▲' : 'Show canonical JSON (for independent verification) ▼'}
        </button>
        {showCanonical && (
          <pre className="text-[9px] text-slate-500 bg-slate-950 border border-slate-800 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {canonical}
          </pre>
        )}
      </div>
    </Collapsible>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function BuyerReview({ onProceedToRelease }: { onProceedToRelease: () => void }) {
  const { boundPackage, buyerDecision, approveReview, rejectReview, clearReview } = useDealReview()

  if (!boundPackage) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24 flex flex-col items-center gap-4 text-center">
        <Info size={32} className="text-slate-600" />
        <p className="text-slate-400 text-sm">No AI analysis has been bound to a deal yet.</p>
        <p className="text-slate-500 text-xs">
          Go to the AI Document Intelligence tab, run an analysis, and use
          "Bind to Deal" to associate the results with an active escrow deal.
        </p>
      </div>
    )
  }

  const { po, invoice, comparison, report, reviewHash, hashMethod, boundAt,
          dealId, contractAddress, chainId, buyerAddress, sellerAddress, amount } = boundPackage

  const isApproved = buyerDecision === 'approved'
  const isRejected = buyerDecision === 'rejected'
  const isPending  = buyerDecision === null

  const hasDiscrepancies = comparison.overallStatus !== 'MATCH' || comparison.monetaryMismatch
  const aiRecommendsProceed = report.overallAssessment === 'PROCEED'

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-24 space-y-5">

      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          AI Document Review — Buyer Approval Gate
        </p>
        <h2 className="text-xl font-bold text-white">Review AI Analysis</h2>
        <p className="text-slate-400 text-sm">
          Examine the AI-extracted trade terms and comparison results below.
          You must explicitly approve or reject this analysis before the escrow release
          transaction can be submitted.
        </p>
      </div>

      {/* AI advisory disclaimer — always visible at top */}
      <div className="rounded-xl border border-amber-600/30 bg-amber-950/15 p-4 flex gap-3">
        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-amber-300 text-xs font-semibold">AI IS ADVISORY ONLY</p>
          <p className="text-amber-400/80 text-xs leading-relaxed">
            This AI report cannot verify real-world delivery, physical goods, or legal obligations.
            A MATCH recommendation does NOT authorize payment and does NOT release funds.
            Only your explicit click on "Approve &amp; Proceed to Release" initiates the escrow transaction.
            You can reject at any time.
          </p>
        </div>
      </div>

      {/* Deal binding summary */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Deal Binding — Analysis is associated with this on-chain deal
        </p>
        <div className="divide-y divide-slate-800/60">
          <Row label="Deal ID"          value={<span className="font-mono">#{String(dealId)}</span>} />
          <Row label="Contract"         value={<code className="font-mono text-[10px]">{fmtAddr(contractAddress)}</code>} />
          <Row label="Chain ID"         value={`${chainId} (Arc Testnet)`} />
          <Row label="Buyer"            value={<code className="font-mono text-[10px]">{fmtAddr(buyerAddress)}</code>} />
          <Row label="Seller"           value={<code className="font-mono text-[10px]">{fmtAddr(sellerAddress)}</code>} />
          <Row label="Amount"           value={<span className="text-amber-400 font-mono">{fmtUsdc(amount)}</span>} />
          <Row label="Bound At"         value={boundAt} />
        </div>
      </div>

      {/* Discrepancy alert (if any) */}
      {hasDiscrepancies && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/15 p-4 flex gap-3">
          <ShieldAlert size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-rose-300 text-xs font-semibold">Discrepancies detected</p>
            <p className="text-rose-400/70 text-xs mt-0.5">
              The deterministic comparison found mismatches between the PO and Invoice.
              Review the Field Comparison section carefully before making your decision.
            </p>
          </div>
        </div>
      )}

      {/* AI assessment banner */}
      <div className={`rounded-xl border p-3 flex items-center gap-3 ${
        aiRecommendsProceed
          ? 'border-emerald-700/30 bg-emerald-950/10'
          : 'border-amber-700/30 bg-amber-950/10'
      }`}>
        <Info size={13} className={aiRecommendsProceed ? 'text-emerald-400 shrink-0' : 'text-amber-400 shrink-0'} />
        <div>
          <span className="text-xs text-slate-300">AI overall assessment: </span>
          <StatusBadge status={report.overallAssessment} />
          <span className="text-[10px] text-slate-500 ml-2">
            (advisory only — does not authorize payment)
          </span>
        </div>
      </div>

      {/* Extracted terms */}
      <ExtractedTermsSection doc={po}      label="Purchase Order — Extracted Fields" />
      <ExtractedTermsSection doc={invoice} label="Commercial Invoice — Extracted Fields" />

      {/* Comparison */}
      <DiscrepanciesSection comparison={comparison} />

      {/* Advisory report */}
      <AdvisorySection report={report} />

      {/* Hash verification */}
      <HashVerificationSection
        reviewHash={reviewHash}
        hashMethod={hashMethod}
        boundAt={boundAt}
        po={po}
        invoice={invoice}
        comparison={comparison}
        report={report}
      />

      {/* ── Decision gate ───────────────────────────────────────────────────── */}
      {isPending && (
        <div className="rounded-xl border border-sky-700/30 bg-sky-950/10 p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-white">Your Decision</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Review all sections above. When you are satisfied, click{' '}
              <strong className="text-emerald-300">Approve &amp; Proceed to Release</strong> to
              proceed to the escrow release transaction — or{' '}
              <strong className="text-rose-300">Reject</strong> to cancel.
            </p>
          </div>
          <p className="text-[10px] text-amber-400">
            Approving here does NOT release funds. It unlocks the escrow release transaction
            screen where you must confirm once more in your wallet (MetaMask).
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={approveReview}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                         bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold
                         transition-all shadow-lg shadow-emerald-900/40"
            >
              <CheckCircle2 size={16} />
              Approve &amp; Proceed to Release
            </button>
            <button
              onClick={rejectReview}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                         bg-rose-900/40 hover:bg-rose-800/40 border border-rose-700/40
                         text-rose-300 text-sm font-semibold transition-all"
            >
              <XCircle size={16} />
              Reject — Do Not Release
            </button>
          </div>
        </div>
      )}

      {/* Approved state */}
      {isApproved && (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p className="text-emerald-300 font-bold">Analysis Approved by Buyer</p>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            You approved this AI analysis. The dynamic review hash is now available
            to the escrow release transaction. Proceed to Step 6 — Approve &amp; Release
            to submit the blockchain transaction and release escrow funds to the Seller.
          </p>

          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Hash to be committed on-chain</p>
            <div className="flex items-start gap-2">
              <Hash size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <code className="font-mono text-[11px] text-emerald-300 break-all flex-1">{reviewHash}</code>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onProceedToRelease}
              className="flex-1 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white
                         text-sm font-bold transition-all shadow-lg shadow-sky-900/30
                         flex items-center justify-center gap-2"
            >
              <FileText size={15} />
              Go to Step 6 — Approve &amp; Release
            </button>
            <button
              onClick={rejectReview}
              className="px-4 py-2 rounded-xl border border-rose-700/30 text-rose-400
                         text-xs hover:bg-rose-950/20 transition-colors"
            >
              Change to Reject
            </button>
          </div>

          <p className="text-[10px] text-slate-600">
            Step 6 will require another explicit confirmation in your wallet (MetaMask).
            Approving here does not release funds.
          </p>
        </div>
      )}

      {/* Rejected state */}
      {isRejected && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/15 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle size={18} className="text-rose-400 shrink-0" />
            <p className="text-rose-300 font-bold">Analysis Rejected — Funds Will Not Be Released</p>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            You rejected this AI analysis. The escrow release transaction is blocked.
            The deal remains in its current state on-chain. You can run a new analysis
            or start a new deal.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={approveReview}
              className="px-4 py-2 rounded-xl border border-emerald-700/30 text-emerald-400
                         text-xs hover:bg-emerald-950/20 transition-colors"
            >
              Change to Approve
            </button>
            <button
              onClick={clearReview}
              className="px-4 py-2 rounded-xl border border-slate-700/30 text-slate-400
                         text-xs hover:bg-slate-800/30 transition-colors"
            >
              Clear and start new analysis
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
