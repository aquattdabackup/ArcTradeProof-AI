/**
 * Text extraction from PDF and plain-text buffers.
 * Uses pdf-parse for PDF; plain text is decoded directly.
 *
 * SECURITY: This runs server-side only. File content is treated as untrusted data.
 * Scanned-image PDFs produce empty text; the caller handles that case.
 */

// pdf-parse uses a dynamic require internally; the types package covers the API
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>

export async function extractTextFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const result = await pdfParse(buffer)
    return result.text
  }

  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return buffer.toString('utf-8')
  }

  throw new Error(`Unsupported MIME type: ${mimeType}`)
}
