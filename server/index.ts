/** Same-origin API and SPA. AI is advisory; no wallet operations exist here. */
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractDocumentHandler } from './routes/extract.js'
import { compareHandler } from './routes/compare.js'
import { reportHandler } from './routes/report.js'
import { aiAvailable } from './ai.js'

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const app = express()
  const production = env.NODE_ENV === 'production'
  const proxyHops = Number(env.TRUST_PROXY_HOPS ?? 0)
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) {
    throw new Error('Invalid TRUST_PROXY_HOPS configuration')
  }
  // Trust only the documented, tested number of hops; never trust all senders.
  app.set('trust proxy', proxyHops)
  app.disable('x-powered-by')
  const origins = new Set<string>()
  for (const value of [env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL, env.ALLOWED_ORIGIN]) {
    if (!value) continue
    const url = new URL(value)
    if (url.origin !== value || !['https:', 'http:'].includes(url.protocol)
        || (production && url.protocol !== 'https:')) throw new Error('Invalid origin configuration')
    origins.add(value)
  }
  if (!production) origins.add('http://localhost:5173')
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const origin = req.get('origin')
    if (origin && !origins.has(origin)) {
      res.status(403).json({ error: 'ORIGIN_DENIED', message: 'Origin is not allowed.' })
      return
    }
    next()
  }, cors({
    origin: (origin, cb) => cb(null, Boolean(origin && origins.has(origin))),
    methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'],
  }))
  app.get('/api/health', (_req, res) => {
    const ready = aiAvailable()
    res.json({ status: 'ok', aiReady: ready, model: ready ? 'gpt-4o-mini' : null,
      message: ready ? 'AI configured with a bounded demo allowance; inference is not verified by this check.'
        : 'AI unavailable. A server API key and remaining demo allowance are required.' })
  })
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many requests. Try again in 15 minutes.' },
  })
  // Rate-limit before parsing bodies. Reject compressed payloads to limit decompression work.
  app.use(['/api/extract', '/api/compare', '/api/report'], limiter,
    (req, res, next) => {
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'UNSUPPORTED_TYPE', message: 'Send application/json.' })
        return
      }
      next()
    }, express.json({ limit: '1.5mb', inflate: false }))
  app.post('/api/extract', extractDocumentHandler)
  app.post('/api/compare', compareHandler)
  app.post('/api/report', reportHandler)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.' })
  })
  if (production) {
    const dist = fileURLToPath(new URL('../dist/', import.meta.url))
    app.use(express.static(dist, { dotfiles: 'deny' }))
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
  // Never log raw exceptions: parsers/providers can embed input, headers, or credentials.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    const type = (err as { type?: string })?.type
    const status = type === 'entity.too.large' ? 413 : type === 'entity.parse.failed' ? 400
      : type === 'encoding.unsupported' ? 415 : 500
    res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: status === 500 ? 'An unexpected error occurred.' : 'Invalid or oversized JSON request.' })
  })
  return app
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001)
  createApp().listen(port, () => console.log(`[ArcTradeProof API] Listening on port ${port}`))
}
