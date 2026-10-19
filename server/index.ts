/**
 * ArcTradeProof AI — Express API server
 *
 * SECURITY PROPERTIES:
 * - OPENAI_API_KEY is read from process.env only; never forwarded to browser
 * - CORS restricted to same-origin in production (ALLOWED_ORIGIN env var)
 * - Rate limiting: 20 AI requests / 15 minutes per IP
 * - Request body capped at 1.5 MB (covers 1 MB base64 + JSON overhead)
 * - 30-second timeout on all AI routes
 * - Document content is never logged
 * - Error responses never expose stack traces or raw API errors
 * - Health endpoint reports key presence only (boolean), never the key value
 *
 * ROUTE PREFIX: all routes are mounted at /api/*
 * - In development: the Vite dev proxy forwards /api/* → /api/* (no rewrite needed).
 *   vite.config.ts proxy target is http://localhost:3001 with rewrite removed.
 * - In production: Express serves the SPA from dist/ AND handles /api/* directly.
 *   The SPA calls fetch('/api/...') which Express handles on the same origin.
 *   No CORS issue, no proxy, no rewrite.
 */

import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractDocumentHandler } from './routes/extract.js'
import { compareHandler } from './routes/compare.js'
import { reportHandler } from './routes/report.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

// ── Production static file serving ──────────────────────────────────────────
// In production, Vite's `dist/` is served from this same Express process.
// This eliminates the CORS concern and the Vite dev proxy requirement.
// Build command: bun run build     (runs vite build → dist/)
// Start command: bun run start     (NODE_ENV=production bun run server/index.ts)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR  = path.resolve(__dirname, '..', 'dist')
const IS_PROD   = process.env.NODE_ENV === 'production'

// ── CORS ────────────────────────────────────────────────────────────────────
// Production: same-origin (SPA and API on the same Render URL) — CORS headers
// are not needed for same-origin requests, but we keep the middleware in case
// of future multi-origin setups. ALLOWED_ORIGIN overrides when set.
// Development: allow all origins so the Vite dev server (5173) can call us (3001).
const allowedOrigin = process.env.ALLOWED_ORIGIN
app.use(cors({
  origin: allowedOrigin ?? true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}))

// ── Body parser — cap at 1.5 MB ─────────────────────────────────────────────
app.use(express.json({ limit: '1.5mb' }))

// ── Rate limiter — 20 AI calls per 15 minutes per IP ────────────────────────
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Please try again in 15 minutes.' },
})

// ── 30-second timeout middleware ─────────────────────────────────────────────
function timeout(ms: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'TIMEOUT', message: 'Request timed out.' })
      }
    }, ms)
    res.on('finish', () => clearTimeout(timer))
    res.on('close',  () => clearTimeout(timer))
    next()
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
// GET /api/health
// Reports key PRESENCE only — never the key value, never any substring of it.
// Use this as your Render/hosting liveness probe path.
app.get('/api/health', (_req, res) => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim())
  res.json({
    status: 'ok',
    aiReady: hasKey,
    model: hasKey ? 'gpt-4o-mini' : null,
    message: hasKey
      ? 'OpenAI API key configured. Ready for document analysis.'
      : 'OPENAI_API_KEY not set. Configure it in your hosting environment to enable AI extraction.',
  })
})

// ── AI routes — rate-limited + timeout ──────────────────────────────────────
// POST /api/extract  — PDF/text → structured extraction (OpenAI gpt-4o-mini)
// POST /api/compare  — deterministic comparison (no AI, pure bigint arithmetic)
// POST /api/report   — advisory narrative (OpenAI gpt-4o-mini)
app.post('/api/extract', aiLimiter, timeout(30_000), extractDocumentHandler)
app.post('/api/compare', aiLimiter, timeout(30_000), compareHandler)
app.post('/api/report',  aiLimiter, timeout(30_000), reportHandler)

// ── /api/* catch-all — unknown API routes return 404 JSON, never HTML ────────
// Must be registered AFTER all known /api/* routes and BEFORE express.static
// so that /api/nonexistent gets a proper JSON 404, not the SPA index.html.
app.all('/api/{*splat}', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.' })
})

// ── Global error handler — never expose stack traces ────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ArcTradeProof API] Unhandled error:', err instanceof Error ? err.message : 'unknown')
  if (!res.headersSent) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' })
  }
})

// ── Production: serve Vite SPA + handle client-side routing ─────────────────
// API routes are registered ABOVE. Any other path either:
//   a. Matches a static file in dist/   → served directly by express.static
//   b. Matches nothing                  → falls through to the SPA index.html
//      (required for React client-side navigation)
//
// In development the Vite dev server handles the SPA; only /api/* comes to us.
if (IS_PROD) {
  // Serve static assets (JS, CSS, images, fonts …)
  app.use(express.static(DIST_DIR))
  // SPA fallback — any unmatched GET returns index.html
  // Express 5 / path-to-regexp v8 requires a named wildcard; bare '*' is rejected.
  app.get('/{*splat}', (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.listen(PORT, () => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim())
  console.log(`[ArcTradeProof API] Listening on port ${PORT}`)
  console.log(`[ArcTradeProof API] AI ready: ${hasKey}`)
  console.log(`[ArcTradeProof API] Mode: ${IS_PROD ? 'production (serving dist/)' : 'development (Vite proxy)'}`)
  console.log(`[ArcTradeProof API] CORS origin: ${allowedOrigin ?? '* (development)'}`)
  if (!hasKey) {
    console.warn('[ArcTradeProof API] Set OPENAI_API_KEY in your hosting environment to enable document analysis')
  }
})
