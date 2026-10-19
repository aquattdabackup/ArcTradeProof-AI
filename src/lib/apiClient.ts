/**
 * Frontend API client for the ArcTradeProof AI backend.
 * All calls go to relative /api/* paths — Vite proxies them to port 3001.
 * API keys are NEVER in this file or any frontend file.
 */

import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '../../server/types.js'

export type { ExtractedDocument, ComparisonResult, AdvisoryReport }

const BASE = '/api'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
    const msg = (typeof err === 'object' && err !== null && 'message' in err)
      ? String((err as Record<string, unknown>).message)
      : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export interface HealthResponse {
  status: string
  aiReady: boolean
  model: string | null
  message: string
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`)
  return res.json() as Promise<HealthResponse>
}

export async function extractDocument(
  filename: string,
  mimeType: string,
  base64Content: string,
): Promise<ExtractedDocument> {
  return post('/extract', { filename, mimeType, base64Content })
}

export async function compareDocuments(
  po: ExtractedDocument,
  invoice: ExtractedDocument,
): Promise<ComparisonResult> {
  return post('/compare', { po, invoice })
}

export async function generateReport(
  po: ExtractedDocument,
  invoice: ExtractedDocument,
  comparison: ComparisonResult,
): Promise<AdvisoryReport> {
  return post('/report', { po, invoice, comparison })
}

/** Read a File object and return its base64-encoded content. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix: "data:...;base64,"
      const b64 = result.split(',')[1]
      if (!b64) reject(new Error('Could not encode file'))
      else resolve(b64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}
