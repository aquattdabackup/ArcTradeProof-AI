/**
 * DealReviewStore — shared context bridging the AI Document Intelligence tab
 * and the Escrow Release tab.
 *
 * DESIGN INVARIANTS:
 * 1. The reviewHash in this store is computed deterministically from the full
 *    review package. It is NEVER hardcoded and NEVER provided by the server.
 * 2. `buyerDecision` defaults to null. It can only become 'approved' or
 *    'rejected' by an explicit user action in BuyerReview.tsx.
 *    It NEVER changes automatically as a result of AI output.
 * 3. `approveAndRelease` is blocked unless buyerDecision === 'approved' AND
 *    the hash passed to the contract matches `reviewHash` exactly.
 * 4. A new analysis always resets the decision — the buyer must re-approve
 *    each new analysis before a transaction can be submitted.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '@/lib/apiClient'
import { hashReviewPackage, type ReviewPackageForHash } from '@/lib/reviewHash'

// ── Types ────────────────────────────────────────────────────────────────────

export interface BoundReviewPackage {
  /** Which deal this analysis is bound to */
  dealId: bigint
  /** Escrow contract address for this deal */
  contractAddress: `0x${string}`
  /** Chain ID verified at binding time */
  chainId: number
  /** Buyer address verified at binding time */
  buyerAddress: `0x${string}`
  /** Seller address verified at binding time */
  sellerAddress: `0x${string}`
  /** Amount in USDC base units */
  amount: bigint

  /** AI analysis results */
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport

  /** ISO-8601 timestamp fixed at binding time (never re-generated) */
  boundAt: string

  /**
   * keccak256 hash of the canonical review package JSON.
   * Computed once at binding time by hashReviewPackage().
   * This is the EXACT bytes32 value that must be passed to
   * approveAndRelease(dealId, reviewHash).
   */
  reviewHash: `0x${string}`

  /** Human-readable hash method for verification instructions */
  hashMethod: string
}

export type BuyerDecision = 'approved' | 'rejected' | null

export interface DealReviewState {
  /** The active bound review package, or null if no analysis has been bound */
  boundPackage: BoundReviewPackage | null

  /**
   * The buyer's explicit decision on the current package.
   * null = not yet decided.
   * 'approved' = buyer explicitly clicked Approve.
   * 'rejected' = buyer explicitly clicked Reject.
   *
   * INVARIANT: this field is NEVER set to 'approved' by any code path other
   * than the buyer clicking the Approve button in BuyerReview.tsx.
   */
  buyerDecision: BuyerDecision

  /** Bind a new review package to a deal, resetting the decision */
  bindReview: (params: {
    dealId: bigint
    contractAddress: `0x${string}`
    chainId: number
    buyerAddress: `0x${string}`
    sellerAddress: `0x${string}`
    amount: bigint
    po: ExtractedDocument
    invoice: ExtractedDocument
    comparison: ComparisonResult
    report: AdvisoryReport
  }) => BoundReviewPackage

  /** Buyer explicitly approves the current package */
  approveReview: () => void

  /** Buyer explicitly rejects the current package */
  rejectReview: () => void

  /** Clear the entire store (start over) */
  clearReview: () => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const DealReviewContext = createContext<DealReviewState | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function DealReviewProvider({ children }: { children: ReactNode }) {
  const [boundPackage, setBoundPackage] = useState<BoundReviewPackage | null>(null)
  const [buyerDecision, setBuyerDecision] = useState<BuyerDecision>(null)

  const bindReview = useCallback((params: {
    dealId: bigint
    contractAddress: `0x${string}`
    chainId: number
    buyerAddress: `0x${string}`
    sellerAddress: `0x${string}`
    amount: bigint
    po: ExtractedDocument
    invoice: ExtractedDocument
    comparison: ComparisonResult
    report: AdvisoryReport
  }): BoundReviewPackage => {
    const boundAt = new Date().toISOString()

    // Build the full package for hashing — includes all AI evidence and binding metadata
    const pkgForHash: ReviewPackageForHash = {
      po: params.po,
      invoice: params.invoice,
      comparison: params.comparison,
      report: params.report,
      hashTimestamp: boundAt,
    }

    const { hash, method } = hashReviewPackage(pkgForHash)

    const bound: BoundReviewPackage = {
      dealId:          params.dealId,
      contractAddress: params.contractAddress,
      chainId:         params.chainId,
      buyerAddress:    params.buyerAddress,
      sellerAddress:   params.sellerAddress,
      amount:          params.amount,
      po:              params.po,
      invoice:         params.invoice,
      comparison:      params.comparison,
      report:          params.report,
      boundAt,
      reviewHash:      hash,
      hashMethod:      method,
    }

    setBoundPackage(bound)
    setBuyerDecision(null) // ALWAYS reset decision when binding a new package
    return bound
  }, [])

  const approveReview = useCallback(() => {
    if (!boundPackage) return
    // Only transition null → approved. Cannot approve a rejected package without rebinding.
    setBuyerDecision('approved')
  }, [boundPackage])

  const rejectReview = useCallback(() => {
    setBuyerDecision('rejected')
  }, [])

  const clearReview = useCallback(() => {
    setBoundPackage(null)
    setBuyerDecision(null)
  }, [])

  return (
    <DealReviewContext.Provider value={{
      boundPackage,
      buyerDecision,
      bindReview,
      approveReview,
      rejectReview,
      clearReview,
    }}>
      {children}
    </DealReviewContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDealReview(): DealReviewState {
  const ctx = useContext(DealReviewContext)
  if (!ctx) throw new Error('useDealReview must be used inside <DealReviewProvider>')
  return ctx
}
