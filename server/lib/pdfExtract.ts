/** Bounded server-side text extraction using the installed pdf-parse v2 API. */
import { MAX_TEXT } from '../schemas.js'

export async function extractTextFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF')
    // PDF.js needs native canvas globals on Node. Keep optional PDF loading out
    // of API startup; import failures are handled by the extraction route.
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false })
    try {
      const info = await parser.getInfo()
      if (info.total > 10) throw new Error('Too many pages')
      let text = ''
      for (let page = 1; page <= info.total; page++) {
        const result = await parser.getText({ partial: [page] })
        text += result.text
        if (text.length > MAX_TEXT) throw new Error('Too much text')
      }
      return text
    } finally { await parser.destroy() }
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return buffer.toString('utf8')
  throw new Error('Unsupported file type')
}
