import type { Request, Response } from 'express'
import { compareDocuments } from '../lib/compare.js'
import { DocumentsSchema } from '../schemas.js'

export function compareHandler(req: Request, res: Response): void {
  const parsed = DocumentsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'Two valid extracted documents are required.' })
    return
  }
  res.json(compareDocuments(parsed.data.po, parsed.data.invoice))
}
