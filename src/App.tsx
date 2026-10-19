import { useState } from 'react'
import { WalletHeader } from '@/components/WalletHeader'
import { AiDocIntelligence } from '@/components/AiDocIntelligence'
import { BuyerReview } from '@/components/BuyerReview'
import { CreateDeal } from '@/components/CreateDeal'
import { AcceptDeal } from '@/components/AcceptDeal'
import { ApproveUsdc } from '@/components/ApproveUsdc'
import { FundDeal } from '@/components/FundDeal'
import { SubmitEvidence } from '@/components/SubmitEvidence'
import { ApproveAndRelease } from '@/components/ApproveAndRelease'
import { DealReviewProvider, useDealReview } from '@/store/dealReviewStore'

// Top-level tabs
type Tab = 'ai' | 'review' | 'escrow'

// Escrow lifecycle steps (1-6)
type Step = 1 | 2 | 3 | 4 | 5 | 6

const STEP_LABELS: Record<Step, string> = {
  1: 'Create',
  2: 'Accept',
  3: 'Approve',
  4: 'Fund',
  5: 'Evidence',
  6: 'Release',
}

// ── Inner app — uses the store ────────────────────────────────────────────────

function AppInner() {
  const [tab, setTab]         = useState<Tab>('ai')
  const [activeStep, setActiveStep] = useState<Step>(6)
  const [doneSteps]           = useState<Set<Step>>(new Set([1, 2, 3, 4, 5]))

  const { boundPackage, buyerDecision } = useDealReview()

  // Badge shown on Buyer Review tab
  const reviewBadge = (() => {
    if (!boundPackage) return null
    if (buyerDecision === 'approved') return 'approved'
    if (buyerDecision === 'rejected') return 'rejected'
    return 'pending'
  })()

  return (
    <div className="min-h-dvh bg-slate-950 text-white">
      <WalletHeader />

      {/* ── top-level tab bar ──────────────────────────────────────────────── */}
      <div className="sticky top-[57px] z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800/60">
        <div className="max-w-2xl mx-auto px-4 flex items-center gap-1 pt-2 pb-0 overflow-x-auto no-scrollbar">

          <button
            onClick={() => setTab('ai')}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0
              ${tab === 'ai'
                ? 'text-sky-300 border-sky-500 bg-sky-950/20'
                : 'text-slate-500 border-transparent hover:text-slate-300'}`}
          >
            AI Document Intelligence
          </button>

          {/* Buyer Review tab — available once an analysis has been bound */}
          <button
            onClick={() => setTab('review')}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors
                        whitespace-nowrap shrink-0 flex items-center gap-1.5
              ${tab === 'review'
                ? 'text-sky-300 border-sky-500 bg-sky-950/20'
                : boundPackage
                ? 'text-slate-300 border-transparent hover:text-slate-100'
                : 'text-slate-600 border-transparent'}`}
          >
            Buyer Review
            {reviewBadge === 'approved' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            )}
            {reviewBadge === 'pending' && (
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            )}
            {reviewBadge === 'rejected' && (
              <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
            )}
          </button>

          <button
            onClick={() => setTab('escrow')}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0
              ${tab === 'escrow'
                ? 'text-sky-300 border-sky-500 bg-sky-950/20'
                : 'text-slate-500 border-transparent hover:text-slate-300'}`}
          >
            Escrow Demo
          </button>
        </div>
      </div>

      {/* ── AI Document Intelligence tab ───────────────────────────────────── */}
      {tab === 'ai' && (
        <main>
          <AiDocIntelligence
            onProceedToReview={() => setTab('review')}
          />
        </main>
      )}

      {/* ── Buyer Review tab ───────────────────────────────────────────────── */}
      {tab === 'review' && (
        <main>
          <BuyerReview
            onProceedToRelease={() => {
              setTab('escrow')
              setActiveStep(6)
            }}
          />
        </main>
      )}

      {/* ── Escrow Demo tab ────────────────────────────────────────────────── */}
      {tab === 'escrow' && (
        <>
          {/* escrow lifecycle stepper */}
          <div className="sticky top-[97px] z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800/40">
            <div className="max-w-lg mx-auto px-4 py-2 flex items-center gap-1 overflow-x-auto no-scrollbar">
              {([1, 2, 3, 4, 5, 6] as Step[]).map((step) => {
                const isDone   = doneSteps.has(step)
                const isActive = step === activeStep
                return (
                  <button
                    key={step}
                    onClick={() => setActiveStep(step)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                whitespace-nowrap shrink-0 transition-colors
                                ${isActive
                                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                  : isDone
                                  ? 'text-emerald-400 border border-emerald-700/30 bg-emerald-950/20'
                                  : 'text-slate-500 border border-slate-800 hover:text-slate-300 hover:border-slate-600'
                                }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0
                                      ${isDone ? 'bg-emerald-500/30' : isActive ? 'bg-sky-500/30' : 'bg-slate-800'}`}>
                      {isDone ? '✓' : step}
                    </span>
                    {STEP_LABELS[step]}
                  </button>
                )
              })}
            </div>
          </div>
          <main>
            {activeStep === 1 && <CreateDeal />}
            {activeStep === 2 && <AcceptDeal />}
            {activeStep === 3 && <ApproveUsdc />}
            {activeStep === 4 && <FundDeal />}
            {activeStep === 5 && <SubmitEvidence />}
            {activeStep === 6 && (
              <ApproveAndRelease
                onGoToReview={() => setTab('review')}
              />
            )}
          </main>
        </>
      )}
    </div>
  )
}

// ── Root — wraps the store provider ──────────────────────────────────────────

export default function App() {
  return (
    <DealReviewProvider>
      <AppInner />
    </DealReviewProvider>
  )
}
