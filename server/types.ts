/** Shared types for ArcTradeProof AI server and frontend. */

export interface ExtractedField {
  label: string
  value: string | null
  sourceExcerpt: string | null
  confidence: 'high' | 'medium' | 'low' | 'not_found'
}

export interface LineItem {
  description: string
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
}

export interface ExtractedDocument {
  filename: string
  mimeType: string
  extractedAt: string
  model: string
  documentType: ExtractedField
  documentNumber: ExtractedField
  buyerName: ExtractedField
  sellerName: ExtractedField
  items: LineItem[]
  totalAmount: ExtractedField
  currency: ExtractedField
  paymentTerms: ExtractedField
  deliveryConditions: ExtractedField
  issueDate: ExtractedField
  dueDate: ExtractedField
  rawWarnings: string[]
}

export type FieldStatus = 'MATCH' | 'MISMATCH' | 'MISSING_INFORMATION' | 'REQUIRES_HUMAN_REVIEW'
export type OverallStatus = 'MATCH' | 'MISMATCH' | 'MISSING_INFORMATION' | 'REQUIRES_HUMAN_REVIEW'

export interface FieldComparison {
  fieldName: string
  poValue: string | null
  invoiceValue: string | null
  status: FieldStatus
  discrepancy: string | null
}

export interface ComparisonResult {
  comparedAt: string
  overallStatus: OverallStatus
  fields: FieldComparison[]
  monetaryMismatch: boolean
  exactDiscrepancyUsdc: string | null  // exact string, e.g. "250.00 USDC over-invoice"
}

export interface AdvisoryReport {
  generatedAt: string
  model: string
  overallAssessment: 'PROCEED' | 'REVIEW_REQUIRED' | 'MISMATCH_DETECTED' | 'INSUFFICIENT_DATA'
  executiveSummary: string
  discrepancyExplanations: Array<{
    field: string
    explanation: string
    severity: 'critical' | 'major' | 'minor' | 'informational'
  }>
  missingDocumentation: string[]
  riskIndicators: string[]
  recommendedNextSteps: string[]
  limitations: string[]
}

export interface ReviewPackage {
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport
  canonicalHash: string       // keccak256 of canonical JSON
  hashTimestamp: string
  hashMethod: string
}
