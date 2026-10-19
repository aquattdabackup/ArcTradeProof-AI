/**
 * POST /report
 *
 * Body: { po: ExtractedDocument, invoice: ExtractedDocument, comparison: ComparisonResult }
 * Returns: AdvisoryReport
 *
 * AI generates a human-readable advisory narrative based on the
 * DETERMINISTIC comparison result. The AI explains; it does not decide.
 * Payment authorization remains solely with the human buyer.
 */

import type { Request, Response } from 'express'
import { openai } from '../ai.js'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '../types.js'

const ReportSchema = z.object({
  executiveSummary: z.string(),
  overallAssessment: z.enum(['PROCEED', 'REVIEW_REQUIRED', 'MISMATCH_DETECTED', 'INSUFFICIENT_DATA']),
  discrepancyExplanations: z.array(z.object({
    field: z.string(),
    explanation: z.string(),
    severity: z.enum(['critical', 'major', 'minor', 'informational']),
  })),
  missingDocumentation: z.array(z.string()),
  riskIndicators: z.array(z.string()),
  recommendedNextSteps: z.array(z.string()),
  limitations: z.array(z.string()),
})

export async function reportHandler(req: Request, res: Response): Promise<void> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({
      error: 'AI_NOT_CONFIGURED',
      message: 'OPENAI_API_KEY is not set.',
    })
    return
  }

  const { po, invoice, comparison } = req.body as {
    po?: ExtractedDocument
    invoice?: ExtractedDocument
    comparison?: ComparisonResult
  }

  if (!po || !invoice || !comparison) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'po, invoice and comparison are required.' })
    return
  }

  const SYSTEM_PROMPT = `You are a trade finance compliance analyst writing advisory reports for buyers considering USDC escrow payment release.

Your role is STRICTLY ADVISORY. You explain discrepancies and risks. You do NOT authorize or recommend payment release.

RULES:
- Base your narrative ONLY on the comparison data provided.
- Do not hallucinate facts not present in the input data.
- If you see a monetary mismatch, state the exact figures and the exact difference.
- Never claim document consistency proves physical delivery of goods.
- Always include the limitation that AI cannot verify real-world events.
- Write in professional but clear language.`

  const USER_PROMPT = `Generate a Trade Verification Report based on the following data.

OVERALL STATUS: ${comparison.overallStatus}

FIELD COMPARISONS:
${comparison.fields.map(f =>
  `${f.fieldName}: ${f.status} | PO: "${f.poValue ?? 'N/A'}" | Invoice: "${f.invoiceValue ?? 'N/A'}"${f.discrepancy ? ` | Discrepancy: ${f.discrepancy}` : ''}`
).join('\n')}

EXTRACTED PO TOTALS: ${po.totalAmount.value ?? 'N/A'} ${po.currency.value ?? ''}
EXTRACTED INVOICE TOTALS: ${invoice.totalAmount.value ?? 'N/A'} ${invoice.currency.value ?? ''}

Generate the advisory report. Remember: this is ADVISORY ONLY. Payment decisions belong to the human buyer.`

  try {
    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: ReportSchema,
      system: SYSTEM_PROMPT,
      prompt: USER_PROMPT,
    })

    const report: AdvisoryReport = {
      generatedAt: new Date().toISOString(),
      model: 'gpt-4o-mini',
      overallAssessment: result.object.overallAssessment,
      executiveSummary: result.object.executiveSummary,
      discrepancyExplanations: result.object.discrepancyExplanations,
      missingDocumentation: result.object.missingDocumentation,
      riskIndicators: result.object.riskIndicators,
      recommendedNextSteps: result.object.recommendedNextSteps,
      limitations: [
        ...result.object.limitations,
        'This report is AI-generated and advisory only. It cannot verify real-world delivery of goods.',
        'Document consistency does not constitute proof of physical shipment.',
        'Payment authorization is solely the buyer\'s responsibility.',
        'This AI cannot sign transactions, access private keys, or release escrow funds.',
      ],
    }

    res.json(report)
  } catch (e) {
    console.error('[report] AI call failed:', e instanceof Error ? e.message : 'unknown error')
    res.status(502).json({
      error: 'AI_CALL_FAILED',
      message: 'Report generation failed.',
    })
  }
}
