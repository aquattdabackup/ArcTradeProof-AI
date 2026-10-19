/**
 * ArcTradeProof AI — Document Intelligence screen.
 *
 * Workflow:
 *   1. Upload Purchase Order + Invoice (or load a demo case)
 *   2. AI extracts structured fields (server-side, real LLM)
 *   3. Deterministic comparison engine flags discrepancies
 *   4. AI generates advisory narrative
 *   5. Buyer reviews the report and prepares a keccak256 hash
 *   6. Hash is displayed as PREPARED (not on-chain until escrow TX)
 *
 * AI is ADVISORY ONLY. Payment decisions belong to the human buyer.
 */

import { useState, useCallback } from 'react'
import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '@/lib/apiClient'
import {
  getHealth,
  extractDocument,
  compareDocuments,
  generateReport,
  fileToBase64,
} from '@/lib/apiClient'
import { hashReviewPackage } from '@/lib/reviewHash'
import { DEMO_DOCS } from '@/lib/demoDocs'
import { useDealReview } from '@/store/dealReviewStore'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS, DEMO_DEAL_ID,
  BUYER_ADDRESS, DEMO_AMOUNT,
} from '@/escrow'
import { useAccount, useReadContract } from 'wagmi'
import { ESCROW_ABI } from '@/escrow'
import { CheckCircle2, ArrowRightCircle } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

type Step = 'upload' | 'extracting' | 'comparing' | 'reporting' | 'review'

interface UploadSlot {
  file: File | null
  demoContent: string | null
  demoFilename: string | null
  demoMime: string | null
}

// ── Status badge ──────────────────────────────────────────────────────────

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

// ── Confidence badge ───────────────────────────────────────────────────────

function ConfBadge({ conf }: { conf: string }) {
  const cls =
    conf === 'high'      ? 'text-emerald-400' :
    conf === 'medium'    ? 'text-amber-400'   :
    conf === 'low'       ? 'text-rose-400'    :
    conf === 'not_found' ? 'text-slate-500'   : 'text-slate-400'
  return <span className={`text-[10px] font-medium uppercase ${cls}`}>{conf.replace('_', ' ')}</span>
}

// ── Document upload card ───────────────────────────────────────────────────

function UploadCard({
  label,
  slot,
  onChange,
}: {
  label: string
  slot: UploadSlot
  onChange: (s: UploadSlot) => void
}) {
  const name = slot.file?.name ?? slot.demoFilename ?? null
  const isDemo = !slot.file && !!slot.demoContent

  return (
    <div className="border border-slate-700/60 rounded-xl p-4 bg-slate-900/40 space-y-3">
      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{label}</p>
      {name ? (
        <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
          <span className="text-[11px] text-slate-300 truncate flex-1">{name}</span>
          {isDemo && (
            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">
              Synthetic
            </span>
          )}
          <button
            onClick={() => onChange({ file: null, demoContent: null, demoFilename: null, demoMime: null })}
            className="text-slate-500 hover:text-rose-400 text-xs transition-colors shrink-0"
          >
            ✕
          </button>
        </div>
      ) : (
        <label className="block cursor-pointer border border-dashed border-slate-600 rounded-lg p-4 text-center hover:border-sky-500/60 transition-colors">
          <input
            type="file"
            accept=".pdf,.txt,.csv"
            className="sr-only"
            onChange={e => {
              const f = e.target.files?.[0]
              if (!f) return
              const allowed = ['application/pdf', 'text/plain', 'text/csv']
              if (!allowed.includes(f.type) && !f.name.endsWith('.txt') && !f.name.endsWith('.csv') && !f.name.endsWith('.pdf')) {
                alert('Only PDF, TXT, and CSV files are supported.')
                return
              }
              if (f.size > 1_048_576) {
                alert('File must be under 1 MB.')
                return
              }
              onChange({ file: f, demoContent: null, demoFilename: null, demoMime: null })
            }}
          />
          <p className="text-xs text-slate-500">Drop PDF or TXT here, or click to browse</p>
          <p className="text-[10px] text-slate-600 mt-1">Max 1 MB · PDF, TXT, CSV</p>
        </label>
      )}
    </div>
  )
}

// ── Extracted doc summary ─────────────────────────────────────────────────

function ExtractedDocCard({ doc, label }: { doc: ExtractedDocument; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">{label}</span>
          <span className="text-[10px] text-slate-500">{doc.filename}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Model: {doc.model}</span>
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-slate-950/40 space-y-2">
          {[
            ['Document Type',  doc.documentType],
            ['Doc Number',     doc.documentNumber],
            ['Buyer',          doc.buyerName],
            ['Seller',         doc.sellerName],
            ['Total Amount',   doc.totalAmount],
            ['Currency',       doc.currency],
            ['Payment Terms',  doc.paymentTerms],
            ['Delivery',       doc.deliveryConditions],
            ['Issue Date',     doc.issueDate],
            ['Due Date',       doc.dueDate],
          ].map(([label, field]) => {
            const f = field as ExtractedDocument['documentType']
            return (
              <div key={label as string} className="flex items-start gap-3 text-xs">
                <span className="w-28 shrink-0 text-slate-500">{label as string}</span>
                <span className="text-slate-200 flex-1">{f.value ?? <span className="text-slate-600">not found</span>}</span>
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
      )}
    </div>
  )
}

// ── Comparison table ───────────────────────────────────────────────────────

function ComparisonTable({ result }: { result: ComparisonResult }) {
  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-900/60 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">Deterministic Comparison</span>
        <StatusBadge status={result.overallStatus} />
      </div>
      {result.monetaryMismatch && result.exactDiscrepancyUsdc && (
        <div className="px-4 py-2 bg-rose-950/30 border-b border-rose-800/40">
          <p className="text-xs text-rose-300 font-semibold">
            ⚠ Monetary mismatch: {result.exactDiscrepancyUsdc}
          </p>
        </div>
      )}
      <div className="divide-y divide-slate-800/60">
        {result.fields.map((f, i) => (
          <div key={i} className="px-4 py-2.5 grid grid-cols-[1fr_1fr_1fr_auto] gap-3 text-[11px] items-start">
            <span className="text-slate-400 font-medium">{f.fieldName}</span>
            <span className="text-slate-300">{f.poValue ?? <span className="text-slate-600">—</span>}</span>
            <span className="text-slate-300">{f.invoiceValue ?? <span className="text-slate-600">—</span>}</span>
            <StatusBadge status={f.status} />
          </div>
        ))}
      </div>
      <div className="px-4 py-1.5 bg-slate-900/30 flex gap-4 text-[10px] text-slate-600">
        <span>PO value</span><span>Invoice value</span>
      </div>
    </div>
  )
}

// ── Advisory report ────────────────────────────────────────────────────────

function AdvisoryReportCard({ report }: { report: AdvisoryReport }) {
  const [open, setOpen] = useState(true)
  const assessmentBg: Record<string, string> = {
    PROCEED:            'bg-emerald-950/40 border-emerald-800/40',
    REVIEW_REQUIRED:    'bg-amber-950/40 border-amber-800/40',
    MISMATCH_DETECTED:  'bg-rose-950/40 border-rose-800/40',
    INSUFFICIENT_DATA:  'bg-slate-900/60 border-slate-700/40',
  }
  const bg = assessmentBg[report.overallAssessment] ?? 'bg-slate-900/60 border-slate-700/40'
  return (
    <div className={`border rounded-xl overflow-hidden ${bg}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">AI Advisory Report</span>
          <StatusBadge status={report.overallAssessment} />
        </div>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 text-xs">
          {/* AI disclaimer */}
          <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2 text-amber-300 text-[11px]">
            ⚠ AI ADVISORY ONLY — This report cannot verify real-world delivery. Payment decisions belong to the human buyer.
          </div>
          {/* Executive summary */}
          <div>
            <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">Executive Summary</p>
            <p className="text-slate-200 leading-relaxed">{report.executiveSummary}</p>
          </div>
          {/* Discrepancies */}
          {report.discrepancyExplanations.length > 0 && (
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">Discrepancies</p>
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
          {/* Recommended next steps */}
          {report.recommendedNextSteps.length > 0 && (
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">Recommended Next Steps</p>
              <ul className="space-y-1">
                {report.recommendedNextSteps.map((s, i) => (
                  <li key={i} className="text-slate-300 flex gap-2"><span className="text-sky-500">›</span>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {/* Risk indicators */}
          {report.riskIndicators.length > 0 && (
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">Risk Indicators</p>
              <ul className="space-y-1">
                {report.riskIndicators.map((r, i) => (
                  <li key={i} className="text-rose-400 flex gap-2"><span>⚠</span>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {/* Limitations */}
          <div className="border-t border-slate-800/60 pt-3 space-y-1">
            <p className="text-slate-500 text-[10px] uppercase tracking-wide">Limitations</p>
            {report.limitations.map((l, i) => (
              <p key={i} className="text-slate-600 text-[10px]">· {l}</p>
            ))}
            <p className="text-slate-500 text-[10px] mt-1">Model: {report.model} · Generated: {report.generatedAt}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review hash card ───────────────────────────────────────────────────────

function ReviewHashCard({
  po, invoice, comparison, report,
}: {
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport
}) {
  // Timestamp fixed once on mount via useState lazy initialiser (never updates)
  const [hashTimestamp] = useState<string>(() => new Date().toISOString())
  const pkg = { po, invoice, comparison, report, hashTimestamp }
  const { hash, method, timestamp } = hashReviewPackage(pkg)

  // Also show the canonical plaintext (collapsed)
  const canonical = JSON.stringify({ po, invoice, comparison, report, hashTimestamp: timestamp }, null, 2)
  const [showCanonical, setShowCanonical] = useState(false)

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-900/60">
        <p className="text-xs font-semibold text-slate-200">Cryptographic Review Hash</p>
        <p className="text-[10px] text-amber-400 mt-0.5">
          PREPARED — NOT YET ON-CHAIN. This hash is not committed until a confirmed escrow transaction.
        </p>
      </div>
      <div className="px-4 py-3 bg-slate-950/40 space-y-3">
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">keccak256 Hash</p>
          <p className="font-mono text-[11px] text-sky-300 break-all">{hash}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Method</p>
          <p className="font-mono text-[10px] text-slate-400">{method}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[10px]">
          <div>
            <p className="text-slate-500 uppercase tracking-wide">Timestamp</p>
            <p className="text-slate-300">{timestamp}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wide">Model</p>
            <p className="text-slate-300">{report.model}</p>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Verification</p>
          <p className="text-[10px] text-slate-400">
            Run <code className="bg-slate-800 px-1 rounded">keccak256(toBytes(canonicalJSON))</code> on the canonical content below to reproduce this hash.
          </p>
        </div>
        <button
          onClick={() => setShowCanonical(o => !o)}
          className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
        >
          {showCanonical ? 'Hide canonical content ▲' : 'Show canonical content ▼'}
        </button>
        {showCanonical && (
          <pre className="text-[9px] text-slate-500 bg-slate-950 border border-slate-800 rounded p-3 overflow-auto max-h-64">
            {canonical}
          </pre>
        )}
        <div className="border-t border-slate-800/60 pt-3 space-y-1 text-[10px] text-slate-500">
          <p>· This hash covers the full review package: extracted fields, comparison, and AI narrative.</p>
          <p>· To commit this hash on-chain, use it as the <code className="bg-slate-800 px-0.5 rounded">reviewHash</code> parameter in <code className="bg-slate-800 px-0.5 rounded">approveAndRelease(dealId, reviewHash)</code>.</p>
          <p>· AI cannot sign transactions or release escrow. Buyer must authorize payment explicitly.</p>
        </div>
      </div>
    </div>
  )
}

// ── Demo case picker ───────────────────────────────────────────────────────

function DemoCasePicker({
  onSelect,
}: {
  onSelect: (
    poSlot: UploadSlot,
    invSlot: UploadSlot,
  ) => void
}) {
  return (
    <div className="border border-amber-700/30 rounded-xl bg-amber-950/10 px-4 py-3 space-y-3">
      <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide">
        ⚠ Synthetic Demo Cases — No real documents, goods, or AI results are pre-loaded.
        Both cases run through the actual AI extraction pipeline.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.entries(DEMO_DOCS) as [keyof typeof DEMO_DOCS, typeof DEMO_DOCS[keyof typeof DEMO_DOCS]][]).map(
          ([key, demo]) => (
            <button
              key={key}
              onClick={() => {
                onSelect(
                  {
                    file: null,
                    demoContent: demo.po.content,
                    demoFilename: demo.po.filename,
                    demoMime: demo.po.mimeType,
                  },
                  {
                    file: null,
                    demoContent: demo.invoice.content,
                    demoFilename: demo.invoice.filename,
                    demoMime: demo.invoice.mimeType,
                  },
                )
              }}
              className="text-left border border-slate-700/50 rounded-lg px-3 py-2.5 bg-slate-900/40 hover:bg-slate-800/60 transition-colors space-y-0.5"
            >
              <p className="text-[11px] font-semibold text-slate-200">{demo.label}</p>
              <p className="text-[10px] text-slate-500">{demo.description}</p>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// ── Deal binding card ─────────────────────────────────────────────────────

/**
 * After the AI analysis is complete, this card lets the buyer bind the
 * review package to an active on-chain deal. It reads the deal live from
 * the contract, verifies the buyer address and deal status, computes the
 * dynamic reviewHash and stores it in the shared DealReviewStore.
 *
 * The buyer then proceeds to the BuyerReview screen to make their decision.
 */
function DealBindingCard({
  po, invoice, comparison, report, onBound,
}: {
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport
  onBound: () => void
}) {
  const { bindReview, boundPackage } = useDealReview()
  const { address, chainId } = useAccount()

  // For the demo: read deal #1 live. In a multi-deal app the user would
  // enter any deal ID here; DEMO_DEAL_ID is the pre-filled default.
  const [dealIdInput, setDealIdInput] = useState<string>(String(DEMO_DEAL_ID))
  const dealId = (() => {
    try { return BigInt(dealIdInput) } catch { return null }
  })()

  type DealShape = {
    dealId: bigint; buyer: `0x${string}`; seller: `0x${string}`
    amount: bigint; status: number; expiration: bigint
  }

  const { data: dealRaw, isLoading: dealLoading, error: dealError } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getDeal',
    args: dealId !== null ? [dealId] : [DEMO_DEAL_ID],
    query: { enabled: dealId !== null },
  })
  const deal = dealRaw as DealShape | undefined

  const isBuyer = address?.toLowerCase() === BUYER_ADDRESS.toLowerCase()
  const isCorrectChain = chainId === ARC_TESTNET_CHAIN_ID
  const dealStatus = deal ? Number(deal.status) : -1
  // Status 3 = EVIDENCE_SUBMITTED (ready for review)
  const dealReadyForRelease = dealStatus === 3

  // Guard: the connected address must match the deal's buyer
  const buyerMatches = deal
    ? address?.toLowerCase() === deal.buyer.toLowerCase()
    : false

  const canBind = !!deal && dealReadyForRelease && buyerMatches && isCorrectChain

  const alreadyBound = boundPackage?.dealId === dealId && boundPackage?.reviewHash !== undefined

  function handleBind() {
    if (!deal || !canBind) return
    bindReview({
      dealId:          deal.dealId,
      contractAddress: ESCROW_ADDRESS,
      chainId:         ARC_TESTNET_CHAIN_ID,
      buyerAddress:    deal.buyer,
      sellerAddress:   deal.seller,
      amount:          deal.amount ?? DEMO_AMOUNT,
      po, invoice, comparison, report,
    })
    onBound()
  }

  const STATUS_LABELS: Record<number, string> = {
    0: 'CREATED', 1: 'ACCEPTED', 2: 'FUNDED',
    3: 'EVIDENCE_SUBMITTED', 4: 'RELEASED', 5: 'REFUNDED',
  }

  return (
    <div className="rounded-xl border border-sky-700/40 bg-sky-950/15 p-5 space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide">
          Step 2 — Bind Analysis to On-Chain Deal
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Associate this AI analysis with an active escrow deal. The review hash
          will be computed and stored — then you review and explicitly approve
          before any transaction can be submitted.
        </p>
      </div>

      {/* Deal ID input */}
      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Deal ID</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={dealIdInput}
            onChange={e => setDealIdInput(e.target.value.trim())}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2
                       text-sm text-slate-200 font-mono focus:outline-none focus:border-sky-600"
            placeholder="1"
          />
        </div>
        <p className="text-[10px] text-slate-600">
          The demo uses Deal #1. For future deals, enter the deal ID from the Create step.
        </p>
      </div>

      {/* Live deal status */}
      {dealLoading && (
        <p className="text-xs text-slate-500">Loading deal from chain…</p>
      )}
      {dealError && (
        <p className="text-xs text-rose-400">Error reading deal: {dealError.message.slice(0, 80)}</p>
      )}
      {deal && (
        <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-3 space-y-1.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Live Deal State</p>
          {[
            ['Deal ID',   String(deal.dealId)],
            ['Status',    STATUS_LABELS[dealStatus] ?? String(dealStatus)],
            ['Buyer',     `${deal.buyer.slice(0, 12)}…${deal.buyer.slice(-6)}`],
            ['Seller',    `${deal.seller.slice(0, 12)}…${deal.seller.slice(-6)}`],
            ['Amount',    (() => {
              const raw = deal.amount
              const whole = raw / 1_000_000n
              const frac = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'
              return `${whole}.${frac} USDC`
            })()],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-[11px]">
              <span className="text-slate-500">{k}</span>
              <span className={`text-slate-300 font-mono ${k === 'Status' && dealReadyForRelease ? 'text-violet-300' : ''}`}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Guard messages */}
      {deal && !dealReadyForRelease && (
        <div className="rounded-lg bg-amber-950/20 border border-amber-700/30 px-3 py-2 text-xs text-amber-300">
          Deal status must be EVIDENCE_SUBMITTED (3) for buyer review.
          Current: {STATUS_LABELS[dealStatus] ?? dealStatus}
        </div>
      )}
      {deal && !buyerMatches && address && (
        <div className="rounded-lg bg-rose-950/20 border border-rose-700/30 px-3 py-2 text-xs text-rose-300">
          Connected wallet is not the buyer for this deal.
          Expected: {deal.buyer.slice(0, 12)}…{deal.buyer.slice(-6)}
        </div>
      )}
      {!isCorrectChain && (
        <div className="rounded-lg bg-rose-950/20 border border-rose-700/30 px-3 py-2 text-xs text-rose-300">
          Switch MetaMask to Arc Testnet (chain {ARC_TESTNET_CHAIN_ID}).
        </div>
      )}
      {!isBuyer && address && (
        <div className="rounded-lg bg-amber-950/20 border border-amber-700/30 px-3 py-2 text-xs text-amber-300">
          Connect as the Buyer wallet ({BUYER_ADDRESS.slice(0, 12)}…) to bind and proceed.
        </div>
      )}

      {/* Already bound indicator */}
      {alreadyBound && (
        <div className="rounded-lg bg-emerald-950/20 border border-emerald-700/30 px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={12} />
          Analysis already bound to Deal #{String(dealId)}. Proceeding to review.
        </div>
      )}

      <button
        onClick={handleBind}
        disabled={!canBind}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2
          ${canBind
            ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/30'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
      >
        <ArrowRightCircle size={15} />
        Bind to Deal #{String(dealId ?? '?')} &amp; Proceed to Buyer Review
      </button>
      {!canBind && deal && dealReadyForRelease && (
        <p className="text-[10px] text-slate-600 text-center">
          {!buyerMatches
            ? 'Connect as the buyer address to enable binding.'
            : !isCorrectChain
            ? 'Switch to Arc Testnet to enable binding.'
            : 'Checking…'}
        </p>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function AiDocIntelligence({ onProceedToReview }: { onProceedToReview?: () => void }) {
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const [aiModel, setAiModel] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  const [poSlot, setPoSlot] = useState<UploadSlot>({
    file: null, demoContent: null, demoFilename: null, demoMime: null,
  })
  const [invSlot, setInvSlot] = useState<UploadSlot>({
    file: null, demoContent: null, demoFilename: null, demoMime: null,
  })

  const [poDoc, setPoDoc]         = useState<ExtractedDocument | null>(null)
  const [invDoc, setInvDoc]       = useState<ExtractedDocument | null>(null)
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [report, setReport]       = useState<AdvisoryReport | null>(null)

  // ── Health check ─────────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const h = await getHealth()
      setAiReady(h.aiReady)
      setAiModel(h.model)
      setAiMessage(h.message)
    } catch {
      setAiReady(false)
      setAiMessage('Cannot reach the API server. Make sure the backend is running.')
    }
  }, [])

  // Kick health check on first render
  useState(() => { void checkHealth() })

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function getBase64(slot: UploadSlot): Promise<{ filename: string; mimeType: string; base64: string }> {
    if (slot.file) {
      const base64 = await fileToBase64(slot.file)
      const mimeType = slot.file.type || 'text/plain'
      return { filename: slot.file.name, mimeType, base64 }
    }
    if (slot.demoContent && slot.demoFilename && slot.demoMime) {
      const base64 = btoa(unescape(encodeURIComponent(slot.demoContent)))
      return { filename: slot.demoFilename, mimeType: slot.demoMime, base64 }
    }
    throw new Error('No document selected')
  }

  // ── Run analysis ───────────────────────────────────────────────────────────
  async function runAnalysis() {
    setError(null)
    setStep('extracting')

    let po: ExtractedDocument
    let inv: ExtractedDocument

    try {
      const [poRaw, invRaw] = await Promise.all([getBase64(poSlot), getBase64(invSlot)])
      ;[po, inv] = await Promise.all([
        extractDocument(poRaw.filename, poRaw.mimeType, poRaw.base64),
        extractDocument(invRaw.filename, invRaw.mimeType, invRaw.base64),
      ])
      setPoDoc(po)
      setInvDoc(inv)
    } catch (e) {
      setError(`Extraction failed: ${e instanceof Error ? e.message : String(e)}`)
      setStep('upload')
      return
    }

    setStep('comparing')
    let cmp: ComparisonResult
    try {
      cmp = await compareDocuments(po, inv)
      setComparison(cmp)
    } catch (e) {
      setError(`Comparison failed: ${e instanceof Error ? e.message : String(e)}`)
      setStep('upload')
      return
    }

    setStep('reporting')
    let rpt: AdvisoryReport
    try {
      rpt = await generateReport(po, inv, cmp)
      setReport(rpt)
    } catch (e) {
      setError(`Report generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setStep('upload')
      return
    }

    setStep('review')
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function reset() {
    setStep('upload')
    setError(null)
    setPoSlot({ file: null, demoContent: null, demoFilename: null, demoMime: null })
    setInvSlot({ file: null, demoContent: null, demoFilename: null, demoMime: null })
    setPoDoc(null)
    setInvDoc(null)
    setComparison(null)
    setReport(null)
  }

  const hasDocuments = (!!poSlot.file || !!poSlot.demoContent) && (!!invSlot.file || !!invSlot.demoContent)
  const isProcessing = step === 'extracting' || step === 'comparing' || step === 'reporting'

  const stepLabel: Record<Step, string> = {
    upload:     'Upload Documents',
    extracting: 'Extracting with AI…',
    comparing:  'Comparing fields…',
    reporting:  'Generating advisory report…',
    review:     'Review Complete',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-24 space-y-6">

      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white tracking-tight">AI Document Intelligence</h2>
        <p className="text-xs text-slate-400">
          Upload a Purchase Order and Invoice. Real AI extracts trade data,
          deterministic logic flags discrepancies, and an advisory report prepares a verifiable hash.
        </p>
        <p className="text-[10px] text-amber-400">
          AI is advisory only. Payment authorization belongs solely to the human buyer.
        </p>
      </div>

      {/* AI readiness banner */}
      {aiReady !== null && (
        <div className={`rounded-lg px-3 py-2 text-[11px] border ${
          aiReady
            ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
            : 'bg-rose-950/30 border-rose-800/40 text-rose-300'
        }`}>
          {aiReady
            ? `AI configured · Model: ${aiModel}`
            : `✗ ${aiMessage}`}
          {!aiReady && (
            <span className="block mt-1 text-slate-400">
              AI analysis is currently unavailable. Ask the demo operator to check access and the remaining allowance.
            </span>
          )}
        </div>
      )}

      {/* Progress indicator */}
      {isProcessing && (
        <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-4 py-3 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-sm text-sky-300">{stepLabel[step]}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-800/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
          <p className="font-semibold mb-0.5">Error</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* Upload step */}
      {step === 'upload' && (
        <div className="space-y-4">
          <DemoCasePicker
            onSelect={(po, inv) => {
              setPoSlot(po)
              setInvSlot(inv)
            }}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UploadCard label="Purchase Order" slot={poSlot} onChange={setPoSlot} />
            <UploadCard label="Commercial Invoice" slot={invSlot} onChange={setInvSlot} />
          </div>
          <button
            disabled={!hasDocuments || !aiReady}
            onClick={() => void runAnalysis()}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all
              ${hasDocuments && aiReady
                ? 'bg-sky-600 hover:bg-sky-500 text-white'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
          >
            {!aiReady ? 'AI analysis unavailable' : 'Analyse Documents'}
          </button>
        </div>
      )}

      {/* Results step */}
      {step === 'review' && poDoc && invDoc && comparison && report && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-400">✓ Analysis complete</span>
            <button
              onClick={reset}
              className="text-xs text-slate-400 hover:text-white transition-colors border border-slate-700 rounded-lg px-3 py-1"
            >
              Start new analysis
            </button>
          </div>

          <ExtractedDocCard doc={poDoc}  label="Purchase Order — Extracted Fields" />
          <ExtractedDocCard doc={invDoc} label="Commercial Invoice — Extracted Fields" />
          <ComparisonTable result={comparison} />
          <AdvisoryReportCard report={report} />
          <ReviewHashCard po={poDoc} invoice={invDoc} comparison={comparison} report={report} />

          {/* ── Deal binding — connects AI analysis to the on-chain escrow ── */}
          <div className="border-t border-slate-800/60 pt-4">
            <p className="text-xs font-semibold text-slate-300 mb-3">
              Ready to authorize payment?
            </p>
            <DealBindingCard
              po={poDoc}
              invoice={invDoc}
              comparison={comparison}
              report={report}
              onBound={() => onProceedToReview?.()}
            />
          </div>
        </div>
      )}
    </div>
  )
}
