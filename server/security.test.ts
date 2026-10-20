import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import type { Request, Response } from 'express'
import type { Server } from 'node:http'
import { extractTextFromBuffer } from './lib/pdfExtract.js'
import { ExtractionSchema, DocumentSchema, ReportSchema } from './schemas.js'

// Stub the SDK boundary: these tests never contact OpenAI or consume paid usage.
let capturedPrompt = ''
let providerFails = false
const field = { value: 'test', sourceExcerpt: null, confidence: 'high' as const }
const fields = Object.fromEntries(['documentType', 'documentNumber', 'buyerName', 'sellerName',
  'totalAmount', 'currency', 'paymentTerms', 'deliveryConditions', 'issueDate', 'dueDate']
  .map(name => [name, { ...field, label: name }]))
const document = DocumentSchema.parse({ ...fields, filename: 'test.txt', mimeType: 'text/plain',
  model: 'test', extractedAt: '2026-10-19', items: [], rawWarnings: [],
  totalAmount: { ...field, label: 'Total', value: '1.00' },
  currency: { ...field, label: 'Currency', value: 'USDC' },
})
const narrative = { executiveSummary: 'Advisory test', overallAssessment: 'REVIEW_REQUIRED',
  discrepancyExplanations: [], missingDocumentation: [], riskIndicators: [],
  recommendedNextSteps: [], limitations: [],
}
await mock.module('ai', () => ({ generateObject: (options: {
  prompt: string; maxRetries: number; maxOutputTokens: number; abortSignal: AbortSignal
}) => {
  expect(options.maxRetries).toBe(0)
  expect(options.maxOutputTokens).toBe(2500)
  expect(options.abortSignal).toBeInstanceOf(AbortSignal)
  capturedPrompt = options.prompt
  if (providerFails) throw new Error('SECRET_DOCUMENT_PROVIDER_ERROR')
  return Promise.resolve({ object: options.prompt.startsWith('Extract') ? ExtractionSchema.parse(document) : narrative })
} }))
const { createApp } = await import('./index.js')
const { withAiCall } = await import('./ai.js')
const directory = mkdtempSync(join(tmpdir(), 'arctradeproof-security-'))
const budgetFile = join(directory, 'budget.json')
const previous = { key: process.env.OPENAI_API_KEY, max: process.env.AI_MAX_CALLS, file: process.env.AI_BUDGET_FILE,
  vercel: process.env.VERCEL }
const servers: Server[] = []
async function serve(overrides: NodeJS.ProcessEnv = {}, options: { serveStatic?: boolean } = {}) {
  const app = createApp({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://demo.example', ...overrides }, options)
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address() as { port: number }
  return `http://127.0.0.1:${address.port}`
}
function post(base: string, route: string, body: unknown, headers = {}) {
  return fetch(`${base}/api/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => {
  delete process.env.VERCEL
  process.env.OPENAI_API_KEY = ''
  process.env.AI_MAX_CALLS = '3'
  process.env.AI_BUDGET_FILE = budgetFile
  writeFileSync(budgetFile, '0')
  providerFails = false
  capturedPrompt = ''
})
afterAll(() => {
  for (const server of servers) server.close()
  for (const [name, value] of Object.entries({ OPENAI_API_KEY: previous.key,
    AI_MAX_CALLS: previous.max, AI_BUDGET_FILE: previous.file, VERCEL: previous.vercel })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  unlinkSync(budgetFile)
})

describe('production HTTP security', () => {
  test('API-only Function serves JSON API routes without a static SPA fallback', async () => {
    const base = await serve({}, { serveStatic: false })
    for (const path of ['/', '/buyer/review', '/index.html']) {
      const res = await fetch(base + path)
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('id="root"')
    }
    const health = await fetch(base + '/api/health')
    expect(health.status).toBe(200)
    expect((await health.json() as { aiReady: boolean }).aiReady).toBe(false)
    const missing = await fetch(base + '/api/not-found')
    expect(missing.status).toBe(404)
    expect((await missing.json() as { error: string }).error).toBe('NOT_FOUND')
  })
  test('Vercel origin fallback allows only the exact deployment; explicit origin overrides it', async () => {
    const env = { PUBLIC_ORIGIN: undefined, VERCEL: '1', VERCEL_URL: 'demo-unique.vercel.app',
      RENDER_EXTERNAL_URL: 'https://old-render.example' }
    const base = await serve(env)
    const accepted = await post(base, 'compare', {}, { Origin: 'https://demo-unique.vercel.app' })
    expect(accepted.status).toBe(400)
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://demo-unique.vercel.app')
    for (const origin of ['https://other.vercel.app', 'https://demo-unique.vercel.app.attacker.example',
      'https://old-render.example', 'http://demo-unique.vercel.app']) {
      const rejected = await post(base, 'compare', {}, { Origin: origin,
        'X-Forwarded-Host': 'demo-unique.vercel.app' })
      expect(rejected.status).toBe(403)
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    }
    const explicit = await serve({ ...env, PUBLIC_ORIGIN: 'https://trade.example' })
    expect((await post(explicit, 'compare', {}, { Origin: 'https://trade.example' })).status).toBe(400)
    expect((await post(explicit, 'compare', {}, { Origin: 'https://demo-unique.vercel.app' })).status).toBe(403)
    const blank = await serve({ ...env, PUBLIC_ORIGIN: '' })
    expect((await post(blank, 'compare', {}, { Origin: 'https://demo-unique.vercel.app' })).status).toBe(403)
  })
  test('missing Vercel hostname fails closed; malformed hostname fails startup', async () => {
    const base = await serve({ PUBLIC_ORIGIN: undefined, VERCEL: '1', RENDER_EXTERNAL_URL: 'https://old.example' })
    expect((await post(base, 'compare', {}, { Origin: 'https://old.example' })).status).toBe(403)
    for (const host of ['https://demo.vercel.app', 'demo.vercel.app/path', 'user@demo.vercel.app']) {
      expect(() => createApp({ NODE_ENV: 'production', VERCEL: '1', VERCEL_URL: host })).toThrow()
    }
  })
  test('Vercel refuses file budgets even with a key and positive allowance', async () => {
    process.env.VERCEL = '1'
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    const base = await serve()
    expect((await (await fetch(base + '/api/health')).json() as { aiReady: boolean }).aiReady).toBe(false)
    for (const route of ['extract', 'report']) {
      const res = await post(base, route, {})
      expect(res.status).toBe(503)
      expect((await res.json() as { error: string }).error).toBe('AI_BUDGET_UNAVAILABLE')
    }
    const req = new EventEmitter() as Request
    const res = new EventEmitter() as Response
    res.status = mock(() => res)
    res.json = mock(() => res)
    const invoke = mock(() => Promise.resolve('must not run'))
    await withAiCall(req, res, invoke)
    expect(invoke).not.toHaveBeenCalled()
    expect(readFileSync(budgetFile, 'utf8')).toBe('0')
  })
  test('health is JSON; both paid routes fail safely without a key', async () => {
    const base = await serve()
    const health = await (await fetch(`${base}/api/health`)).json() as { aiReady: boolean }
    expect(health.aiReady).toBe(false)
    for (const route of ['extract', 'report']) {
      const res = await post(base, route, {})
      expect(res.status).toBe(503)
      expect((await res.json() as { error: string }).error).toBe('AI_NOT_CONFIGURED')
    }
  })
  test('unknown API routes including /api return JSON', async () => {
    const base = await serve()
    for (const path of ['/api', '/api/no-such-route']) {
      const res = await fetch(base + path)
      expect(res.status).toBe(404)
      expect((await res.json() as { error: string }).error).toBe('NOT_FOUND')
    }
  })
  test('CORS accepts only exact configured origins and fails closed without configuration', async () => {
    const base = await serve()
    const rejected = await post(base, 'compare', {}, { Origin: 'https://attacker.example' })
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    const accepted = await post(base, 'compare', {}, { Origin: 'https://demo.example' })
    expect(accepted.status).toBe(400)
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://demo.example')
    const closed = await serve({ PUBLIC_ORIGIN: '' })
    expect((await post(closed, 'compare', {}, { Origin: 'https://demo.example' })).status).toBe(403)
  })
  test('malformed, oversized and compressed bodies return generic JSON', async () => {
    const base = await serve()
    for (const [body, headers, status] of [
      ['{"SECRET_DOCUMENT":', {}, 400],
      [JSON.stringify({ text: 'a'.repeat(1_600_000) }), {}, 413],
      ['{}', { 'Content-Encoding': 'gzip' }, 415],
    ] as const) {
      const res = await fetch(`${base}/api/compare`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }, body })
      expect(res.status).toBe(status)
      expect(JSON.stringify(await res.json())).not.toContain('SECRET_DOCUMENT')
    }
  })
  test('valid comparison works without AI; malformed document shapes are rejected', async () => {
    const base = await serve()
    const res = await post(base, 'compare', { po: document, invoice: { ...document,
      totalAmount: { ...document.totalAmount, value: '1.000001' } } })
    expect(res.status).toBe(200)
    expect((await res.json() as { exactDiscrepancyUsdc: string }).exactDiscrepancyUsdc).toContain('0.000001')
    for (const body of [null, {}, { po: {}, invoice: {} }, { po: { ...document, items: 'bad' }, invoice: document }]) {
      expect((await post(base, 'compare', body)).status).toBe(400)
    }
  })
  test('one-hop proxy isolates clients and ignores spoofed leftmost XFF values', async () => {
    const base = await serve({ TRUST_PROXY_HOPS: '1' })
    for (let i = 0; i < 20; i++) {
      expect((await post(base, 'compare', {}, { 'X-Forwarded-For': `192.0.2.${i + 1}, 198.51.100.1` })).status).toBe(400)
    }
    expect((await post(base, 'compare', {}, { 'X-Forwarded-For': '203.0.113.1, 198.51.100.1' })).status).toBe(429)
    expect((await post(base, 'compare', {}, { 'X-Forwarded-For': '198.51.100.2' })).status).toBe(400)
  })
  test('invalid proxy and origin configuration fail at startup', () => {
    expect(() => createApp({ TRUST_PROXY_HOPS: 'true' })).toThrow()
    expect(() => createApp({ NODE_ENV: 'production', PUBLIC_ORIGIN: '*' })).toThrow()
    expect(() => createApp({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://demo.example' })).toThrow()
  })
  test('bounded, schema-validated extraction and report recomputation use mocked AI', async () => {
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    const base = await serve()
    const extracted = await post(base, 'extract', { filename: 'test.txt', mimeType: 'text/plain',
      base64Content: Buffer.from('Synthetic PO').toString('base64') })
    expect(extracted.status).toBe(200)
    expect(DocumentSchema.safeParse(await extracted.json()).success).toBe(true)
    const report = await post(base, 'report', { po: document, invoice: { ...document,
      totalAmount: { ...document.totalAmount, value: '2' } }, comparison: { overallStatus: 'FORGED_MATCH' } })
    expect(report.status).toBe(200)
    expect((await report.json() as { limitations: string[] }).limitations.join(' ')).toContain('advisory only')
    expect(capturedPrompt).toContain('OVERALL STATUS: MISMATCH')
    expect(capturedPrompt).not.toContain('FORGED_MATCH')
    expect(readFileSync(budgetFile, 'utf8')).toBe('2')
  })
  test('invalid uploads and excessive text consume no allowance', async () => {
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    const base = await serve()
    for (const body of [null, { filename: [], mimeType: 'text/plain', base64Content: 'AAAA' },
      { filename: 'x', mimeType: 'text/plain', base64Content: '%%%!' },
      { filename: 'x', mimeType: 'text/html', base64Content: 'AAAA' },
      { filename: 'x', mimeType: 'text/plain', base64Content: Buffer.alloc(1_000_001).toString('base64') },
      { filename: 'x', mimeType: 'text/plain', base64Content: Buffer.from('a'.repeat(12_001)).toString('base64') }]) {
      const res = await post(base, 'extract', body)
      expect([400, 413]).toContain(res.status)
    }
    expect(readFileSync(budgetFile, 'utf8')).toBe('0')
  })
  test('PDF and provider errors never return internal details; failed AI attempts count', async () => {
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    const base = await serve()
    const pdf = await post(base, 'extract', { filename: 'x.pdf', mimeType: 'application/pdf',
      base64Content: Buffer.from('SECRET_DOCUMENT').toString('base64') })
    expect(pdf.status).toBe(422)
    expect(JSON.stringify(await pdf.json())).not.toContain('SECRET_DOCUMENT')
    providerFails = true
    const res = await post(base, 'report', { po: document, invoice: document })
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('SECRET_DOCUMENT')
    expect(readFileSync(budgetFile, 'utf8')).toBe('1')
  })
  test('persisted exhaustion survives a fresh app; corrupt or disabled budget fails closed', async () => {
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    writeFileSync(budgetFile, '3')
    const base = await serve()
    expect((await post(base, 'report', { po: document, invoice: document })).status).toBe(503)
    writeFileSync(budgetFile, 'corrupt')
    expect((await post(base, 'report', { po: document, invoice: document })).status).toBe(503)
    writeFileSync(budgetFile, '0')
    process.env.AI_MAX_CALLS = '0'
    expect((await post(base, 'report', { po: document, invoice: document })).status).toBe(503)
  })
  test('schemas reject oversized or malformed model output', () => {
    expect(ExtractionSchema.safeParse({ ...document, rawWarnings: Array(21).fill('warning') }).success).toBe(false)
    expect(ReportSchema.safeParse({ ...narrative, overallAssessment: 'RELEASE_FUNDS' }).success).toBe(false)
    expect(ReportSchema.safeParse({ ...narrative, executiveSummary: 'x'.repeat(3001) }).success).toBe(false)
  })
  test('concurrency is bounded and disconnect cancels the provider signal', async () => {
    process.env.OPENAI_API_KEY = 'test-only-placeholder'
    function context() {
      const req = new EventEmitter() as Request
      const res = new EventEmitter() as Response
      res.status = mock(() => res)
      res.json = mock(() => res)
      return { req, res }
    }
    const contexts = [context(), context(), context()]
    const calls = contexts.slice(0, 2).map(({ req, res }) => withAiCall(req, res, signal =>
      new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))))
    const third = contexts[2]
    await withAiCall(third.req, third.res, () => Promise.reject(new Error('Must not run')))
    // eslint-disable-next-line typescript/unbound-method -- intentionally assert the mocked method
    expect(third.res.status).toHaveBeenCalledWith(429)
    contexts[0].res.emit('close')
    contexts[1].req.emit('aborted')
    await Promise.all(calls)
    expect(readFileSync(budgetFile, 'utf8')).toBe('2')
  })
})


/** Minimal synthetic PDF, generated locally; no external fixtures or document data. */
function syntheticPdf(pageCount: number): Buffer {
  const stream = 'BT /F1 12 Tf 50 100 Td (Synthetic trade document) Tj ET'
  const pages = Array.from({ length: pageCount }, (_, i) => `${5 + i} 0 R`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}
test('pdf-parse v2 extracts a real synthetic PDF and rejects more than 10 pages', async () => {
  expect(await extractTextFromBuffer(syntheticPdf(1), 'application/pdf')).toContain('Synthetic trade document')
  const error = await extractTextFromBuffer(syntheticPdf(11), 'application/pdf').catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('Too many pages')
})


test('AI allowance survives fresh processes and blocks the next attempt at the limit', () => {
  const worker = `
    import { EventEmitter } from 'node:events';
    import { withAiCall } from './server/ai.ts';
    const req = new EventEmitter();
    const res = new EventEmitter();
    let status = 200;
    let invoked = false;
    res.status = code => { status = code; return res; };
    res.json = () => res;
    await withAiCall(req, res, async () => { invoked = true; return 'synthetic'; });
    console.log(JSON.stringify({ status, invoked }));
  `
  for (const attempt of [1, 2, 3]) {
    const child = Bun.spawnSync([process.execPath, '--no-env-file', '-e', worker], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, OPENAI_API_KEY: 'test-only-placeholder', AI_MAX_CALLS: '2', AI_BUDGET_FILE: budgetFile },
      stdout: 'pipe', stderr: 'pipe', timeout: 10_000,
    })
    expect(child.exitCode).toBe(0)
    expect(JSON.parse(child.stdout.toString()) as unknown).toEqual({ status: attempt <= 2 ? 200 : 503, invoked: attempt <= 2 })
    expect(readFileSync(budgetFile, 'utf8')).toBe(String(Math.min(attempt, 2)))
  }
}, 35_000)

test('invalid configuration and failed budget writes never invoke AI', async () => {
  process.env.OPENAI_API_KEY = 'test-only-placeholder'
  for (const [maximum, file] of [
    ['', budgetFile], ['301', budgetFile], ['NaN', budgetFile], ['-1', budgetFile],
    ['3', 'relative-budget.json'], ['3', ''], ['3', join(budgetFile, 'nested.json')],
  ]) {
    process.env.AI_MAX_CALLS = maximum
    process.env.AI_BUDGET_FILE = file
    const req = new EventEmitter() as Request
    const res = new EventEmitter() as Response
    const status = mock(() => res)
    res.status = status
    res.json = mock(() => res)
    const invoke = mock(() => Promise.resolve('must not run'))
    await withAiCall(req, res, invoke)
    expect(status).toHaveBeenCalledWith(503)
    expect(invoke).not.toHaveBeenCalled()
  }
  expect(readFileSync(budgetFile, 'utf8')).toBe('0')
})

test('30-second timeout aborts the AI call, returns generic 504 and counts the attempt', async () => {
  process.env.OPENAI_API_KEY = 'test-only-placeholder'
  const req = new EventEmitter() as Request
  const res = new EventEmitter() as Response
  const status = mock(() => res)
  const json = mock(() => res)
  res.status = status
  res.json = json
  const start = performance.now()
  await withAiCall(req, res, signal => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('PRIVATE_PROVIDER_DETAIL')), { once: true })
  }))
  expect(performance.now() - start).toBeGreaterThanOrEqual(29_000)
  expect(status).toHaveBeenCalledWith(504)
  expect(json).toHaveBeenCalledWith({ error: 'TIMEOUT', message: 'AI request timed out.' })
  expect(readFileSync(budgetFile, 'utf8')).toBe('1')
}, 40_000)
