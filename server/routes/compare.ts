/**
 * POST /compare
 *
 * Body: { po: ExtractedDocument, invoice: ExtractedDocument }
 * Returns: ComparisonResult
 *
 * DETERMINISTIC comparison — no AI involved.
 * All monetary comparisons use integer arithmetic (6-decimal USDC base units).
 * This function is pure: same inputs always produce same outputs.
 */

import type { Request, Response } from 'express'
import { compareDocuments } from '../lib/compare.js'
import type { ExtractedDocument } from '../types.js'

export async function compareHandler(req: Request, res: Response): Promise<void> {
  const { po, invoice } = req.body as { po?: ExtractedDocument; invoice?: ExtractedDocument }

  if (!po || !invoice) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'Both po and invoice documents are required.' })
    return
  }

  try {
    const result = compareDocuments(po, invoice)
    res.json(result)
  } catch (e) {
    res.status(500).json({
      error: 'COMPARISON_FAILED',
      message: e instanceof Error ? e.message : 'Comparison failed.',
    })
  }
}
