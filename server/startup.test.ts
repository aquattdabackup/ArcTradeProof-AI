import { test, expect } from 'bun:test'

test('Node API cold start survives missing PDF native dependencies with paid AI disabled', async () => {
  // A fresh Node process avoids Bun's module mocks and cached PDF globals.
  // Resolve source .js imports to .ts for Node 24's built-in type stripping.
  const worker = `
    import assert from 'node:assert/strict'
    import { registerHooks } from 'node:module'
    import { existsSync } from 'node:fs'
    import { pathToFileURL } from 'node:url'
    let canvasAttempts = 0
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === '@napi-rs/canvas') {
          canvasAttempts++
          throw Object.assign(new Error("Cannot find module '@napi-rs/canvas'"), { code: 'MODULE_NOT_FOUND' })
        }
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
          const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
          if (existsSync(source)) return nextResolve(source.href, context)
        }
        return nextResolve(specifier, context)
      }
    })
    assert.equal(globalThis.DOMMatrix, undefined)
    const { default: app } = await import(pathToFileURL(process.cwd() + '/api/index.ts').href)
    assert.equal(canvasAttempts, 0, 'API startup must not load PDF native dependencies')
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const base = 'http://127.0.0.1:' + server.address().port
    try {
      const health = await fetch(base + '/api/health')
      assert.equal(health.status, 200)
      assert.equal((await health.json()).aiReady, false)
      const missing = await fetch(base + '/api/nonexistent')
      assert.equal(missing.status, 404)
      assert.equal((await missing.json()).error, 'NOT_FOUND')
      for (const route of ['extract', 'report']) {
        const response = await fetch(base + '/api/' + route, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        })
        assert.equal(response.status, 503)
        assert.equal((await response.json()).error, 'AI_NOT_CONFIGURED')
      }
      const denied = await fetch(base + '/api/health', { headers: { Origin: 'https://hostile.example' } })
      assert.equal(denied.status, 403)
      const { extractTextFromBuffer } = await import(pathToFileURL(process.cwd() + '/server/lib/pdfExtract.ts').href)
      assert.equal(await extractTextFromBuffer(Buffer.from('Synthetic text'), 'text/plain'), 'Synthetic text')
      assert.equal(canvasAttempts, 0, 'Disabled AI and text extraction must not load PDF dependencies')
      await assert.rejects(extractTextFromBuffer(Buffer.from('%PDF-1.4'), 'application/pdf'),
        /DOMMatrix is not defined/)
      assert.ok(canvasAttempts > 0, 'Reproduce missing native dependency only when PDF is requested')
      assert.equal((await fetch(base + '/api/health')).status, 200)
      console.log('COLD_START_WITHOUT_CANVAS_PASS')
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  `
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', VERCEL: '1',
    PUBLIC_ORIGIN: 'https://demo.example', ALLOWED_ORIGIN: '', TRUST_PROXY_HOPS: '0',
    AI_MAX_CALLS: '0', NODEJS_HELPERS: '0' }
  delete env.OPENAI_API_KEY
  delete env.AI_BUDGET_FILE
  const child = Bun.spawn(['node', '--input-type=module', '-e', worker], {
    env, stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 20_000)
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect({ status, stderr }).toMatchObject({ status: 0 })
    expect(stdout).toContain('COLD_START_WITHOUT_CANVAS_PASS')
  } finally {
    clearTimeout(timer)
    child.kill()
  }
}, 25_000)
