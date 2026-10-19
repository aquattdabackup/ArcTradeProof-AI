/**
 * Shared AI provider instance.
 * The API key is read from process.env at module load time.
 * It is NEVER forwarded to the browser.
 */
import { createOpenAI } from '@ai-sdk/openai'

export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? '',
})
