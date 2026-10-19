/**
 * Deterministic document comparison engine.
 *
 * DESIGN PRINCIPLE: AI extracts; this function decides.
 * All monetary comparisons use integer arithmetic on 6-decimal USDC base units.
 * No floating-point. No AI involvement. Same inputs → same outputs always.
 *
 * This module is independently testable with no external dependencies.
 */

import type { ExtractedDocument, ComparisonResult, FieldComparison, FieldStatus, OverallStatus } from '../types.js'

// ── Monetary helpers ──────────────────────────────────────────────────────

/**
 * Parse a human-readable amount string into 6-decimal integer base units.
 * Handles: "1000", "1,000.00", "1000 USDC", "USD 1000", "$1000"
 * Returns null if unparseable.
 */
export function parseAmountToBaseUnits(raw: string | null): bigint | null {
  if (!raw) return null
  // Reject signs, scientific notation, ambiguous grouping and excess precision.
  // Never silently delete punctuation/digits or round a financial amount.
  if (raw.length > 100) return null
  const cleaned = raw.trim().replace(/^(?:USD[C]?\s*|\$\s*)/i, '')
    .replace(/\s*USD[C]?$/i, '').trim()
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,6})?$/.test(cleaned)) return null
  const [intPart, fraction = ''] = cleaned.replace(/,/g, '').split('.')
  const fracPart = fraction.padEnd(6, '0')
  try {
    return BigInt(intPart) * 1_000_000n + BigInt(fracPart)
  } catch {
    return null
  }
}

/** Format base units back to a human amount string, e.g. 1250000n → "1,250.000000" */
export function formatBaseUnits(units: bigint): string {
  const abs = units < 0n ? -units : units
  const sign = units < 0n ? '-' : ''
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0')
  return `${sign}${whole.toLocaleString('en-US')}.${frac}`
}

// ── Text normalisation for non-monetary fields ────────────────────────────

function normalise(s: string | null): string {
  if (!s) return ''
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function textStatus(a: string | null, b: string | null): FieldStatus {
  if (!a && !b) return 'MISSING_INFORMATION'
  if (!a || !b) return 'MISSING_INFORMATION'
  if (normalise(a) === normalise(b)) return 'MATCH'
  // Partial containment — one might be a shortened version
  const na = normalise(a), nb = normalise(b)
  if (na.includes(nb) || nb.includes(na)) return 'REQUIRES_HUMAN_REVIEW'
  return 'MISMATCH'
}

function monetaryStatus(
  poRaw: string | null,
  invRaw: string | null,
): { status: FieldStatus; discrepancy: string | null } {
  const po  = parseAmountToBaseUnits(poRaw)
  const inv = parseAmountToBaseUnits(invRaw)

  if (po === null && inv === null) return { status: 'MISSING_INFORMATION', discrepancy: null }
  if (po === null || inv === null) return { status: 'MISSING_INFORMATION', discrepancy: 'One or both amounts could not be parsed.' }

  if (po === inv) return { status: 'MATCH', discrepancy: null }

  const diff = inv - po
  const direction = diff > 0n ? 'invoice exceeds PO' : 'PO exceeds invoice'
  const absDiff = diff > 0n ? diff : -diff
  return {
    status: 'MISMATCH',
    discrepancy: `${direction} by ${formatBaseUnits(absDiff)} USDC (${absDiff} base units)`,
  }
}

// ── Main comparison ───────────────────────────────────────────────────────

export function compareDocuments(po: ExtractedDocument, invoice: ExtractedDocument): ComparisonResult {
  const fields: FieldComparison[] = []

  // Helper to push a field
  const push = (
    fieldName: string,
    poValue: string | null,
    invoiceValue: string | null,
    status: FieldStatus,
    discrepancy: string | null = null,
  ) => fields.push({ fieldName, poValue, invoiceValue, status, discrepancy })

  // Buyer
  const buyerSt = textStatus(po.buyerName.value, invoice.buyerName.value)
  push('Buyer Name', po.buyerName.value, invoice.buyerName.value, buyerSt)

  // Seller
  const sellerSt = textStatus(po.sellerName.value, invoice.sellerName.value)
  push('Seller Name', po.sellerName.value, invoice.sellerName.value, sellerSt)

  // Document numbers
  const docNumSt = textStatus(po.documentNumber.value, invoice.documentNumber.value)
  // PO and Invoice numbers are expected to differ; only flag if identical (possible duplicate)
  const docNumResolved: FieldStatus = docNumSt === 'MATCH' ? 'REQUIRES_HUMAN_REVIEW' : 'MATCH'
  push(
    'Document Numbers (PO vs Invoice)',
    po.documentNumber.value,
    invoice.documentNumber.value,
    docNumResolved,
    docNumSt === 'MATCH' ? 'PO and Invoice have identical document numbers — possible duplicate.' : null,
  )

  // Currency
  const currencySt = textStatus(po.currency.value, invoice.currency.value)
  push('Currency', po.currency.value, invoice.currency.value, currencySt)

  // Total amount — MONETARY, integer arithmetic
  const { status: amtSt, discrepancy: amtDisc } = monetaryStatus(po.totalAmount.value, invoice.totalAmount.value)
  push('Total Amount', po.totalAmount.value, invoice.totalAmount.value, amtSt, amtDisc)

  // Payment terms
  const paymentSt = textStatus(po.paymentTerms.value, invoice.paymentTerms.value)
  push('Payment Terms', po.paymentTerms.value, invoice.paymentTerms.value, paymentSt)

  // Delivery conditions
  const deliverySt = textStatus(po.deliveryConditions.value, invoice.deliveryConditions.value)
  push('Delivery Conditions', po.deliveryConditions.value, invoice.deliveryConditions.value, deliverySt)

  // Dates — informational
  push('Issue Date (PO)', po.issueDate.value, null, po.issueDate.value ? 'MATCH' : 'MISSING_INFORMATION')
  push('Issue Date (Invoice)', null, invoice.issueDate.value, invoice.issueDate.value ? 'MATCH' : 'MISSING_INFORMATION')

  // ── Overall status ─────────────────────────────────────────────────────
  const hasMismatch   = fields.some(f => f.status === 'MISMATCH')
  const hasMissing    = fields.some(f => f.status === 'MISSING_INFORMATION')
  const hasHumanReview = fields.some(f => f.status === 'REQUIRES_HUMAN_REVIEW')

  let overallStatus: OverallStatus
  if (hasMismatch)          overallStatus = 'MISMATCH'
  else if (hasMissing)      overallStatus = 'MISSING_INFORMATION'
  else if (hasHumanReview)  overallStatus = 'REQUIRES_HUMAN_REVIEW'
  else                      overallStatus = 'MATCH'

  // ── Monetary discrepancy detail ────────────────────────────────────────
  const monetaryMismatch = amtSt === 'MISMATCH'
  let exactDiscrepancyUsdc: string | null = null
  if (monetaryMismatch && amtDisc) {
    exactDiscrepancyUsdc = amtDisc
  }

  return {
    comparedAt: new Date().toISOString(),
    overallStatus,
    fields,
    monetaryMismatch,
    exactDiscrepancyUsdc,
  }
}
