/** Server-only provider and finite demo allowance. Never log provider errors. */
import { createOpenAI } from '@ai-sdk/openai'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { Request, Response } from 'express'

export const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })
export const AI_CALL_OPTIONS = { maxRetries: 0, maxOutputTokens: 2500 } as const
let activeCalls = 0

function budget() {
  const maximum = Number(process.env.AI_MAX_CALLS ?? 0)
  const file = process.env.AI_BUDGET_FILE
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 300 || !file || !isAbsolute(file)) return null
  try {
    const used: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : 0
    if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0) return null
    return { file, maximum, used }
  } catch { return null }
}

export function aiAvailable(): boolean {
  const b = budget()
  return Boolean(process.env.OPENAI_API_KEY?.trim() && b && b.used < b.maximum)
}

/** Single-process reservation, persisted BEFORE any billable request. No automatic resets. */
export async function withAiCall<T>(req: Request, res: Response,
  run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI is not configured.' })
    return
  }
  const b = budget()
  if (!b || b.used >= b.maximum) {
    res.status(503).json({ error: 'AI_BUDGET_UNAVAILABLE', message: 'The demo AI allowance is unavailable or exhausted.' })
    return
  }
  if (activeCalls >= 2) {
    res.status(429).json({ error: 'AI_BUSY', message: 'AI is busy. Try again shortly.' })
    return
  }
  try {
    mkdirSync(dirname(b.file), { recursive: true })
    writeFileSync(`${b.file}.tmp`, JSON.stringify(b.used + 1), { mode: 0o600 })
    renameSync(`${b.file}.tmp`, b.file)
  } catch {
    res.status(503).json({ error: 'AI_BUDGET_UNAVAILABLE', message: 'The demo AI allowance is unavailable.' })
    return
  }
  activeCalls++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const disconnected = () => controller.abort()
  res.once('close', disconnected)
  req.once('aborted', disconnected)
  try {
    return await run(controller.signal)
  } catch {
    if (!res.headersSent && !res.destroyed) res.status(controller.signal.aborted ? 504 : 502).json({
      error: controller.signal.aborted ? 'TIMEOUT' : 'AI_CALL_FAILED',
      message: controller.signal.aborted ? 'AI request timed out.' : 'AI analysis failed.',
    })
    return
  } finally {
    clearTimeout(timer)
    res.off('close', disconnected)
    req.off('aborted', disconnected)
    activeCalls--
  }
}
