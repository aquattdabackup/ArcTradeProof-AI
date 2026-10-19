import { z } from 'zod'

export const MAX_TEXT = 12_000
export const MAX_FILE_BYTES = 1_000_000
export const FieldSchema = z.object({
  value: z.string().max(1000).nullable(),
  sourceExcerpt: z.string().max(1000).nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'not_found']),
})
const ItemSchema = z.object({
  description: z.string().max(1000),
  quantity: z.string().max(100).nullable(),
  unitPrice: z.string().max(100).nullable(),
  lineTotal: z.string().max(100).nullable(),
})
const fieldNames = ['documentType', 'documentNumber', 'buyerName', 'sellerName', 'totalAmount',
  'currency', 'paymentTerms', 'deliveryConditions', 'issueDate', 'dueDate'] as const
const fields = Object.fromEntries(fieldNames.map(name => [name, FieldSchema])) as Record<typeof fieldNames[number], typeof FieldSchema>
export const ExtractionSchema = z.object({ ...fields,
  items: z.array(ItemSchema).max(50), rawWarnings: z.array(z.string().max(1000)).max(20),
})
const labeledField = FieldSchema.extend({ label: z.string().max(100) })
const labeledFields = Object.fromEntries(fieldNames.map(name => [name, labeledField])) as Record<typeof fieldNames[number], typeof labeledField>
export const DocumentSchema = z.object({ ...labeledFields,
  filename: z.string().min(1).max(255), mimeType: z.string().max(100),
  extractedAt: z.string().max(100), model: z.string().max(100),
  items: z.array(ItemSchema).max(50), rawWarnings: z.array(z.string().max(1000)).max(20),
})
export const DocumentsSchema = z.object({ po: DocumentSchema, invoice: DocumentSchema })
export const UploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/csv']),
  base64Content: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})
export const ReportSchema = z.object({
  executiveSummary: z.string().max(3000),
  overallAssessment: z.enum(['PROCEED', 'REVIEW_REQUIRED', 'MISMATCH_DETECTED', 'INSUFFICIENT_DATA']),
  discrepancyExplanations: z.array(z.object({ field: z.string().max(100),
    explanation: z.string().max(1000), severity: z.enum(['critical', 'major', 'minor', 'informational']),
  })).max(30),
  missingDocumentation: z.array(z.string().max(1000)).max(20),
  riskIndicators: z.array(z.string().max(1000)).max(20),
  recommendedNextSteps: z.array(z.string().max(1000)).max(20),
  limitations: z.array(z.string().max(1000)).max(20),
})
