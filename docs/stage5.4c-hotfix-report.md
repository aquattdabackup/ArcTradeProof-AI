# Stage 5.4C — Vercel API startup hotfix

2026-10-20. Final review for an authorized local commit only. No push, redeploy, dashboard changes, paid resources or blockchain operations.

## Root cause and evidence

Baseline: `fc85e60593bcef08df565b8519d6831819bb6279`.

The public `/api/health` returned HTTP 500 with `X-Vercel-Error: FUNCTION_INVOCATION_FAILED`. The supplied Vercel runtime log identifies the cause:

```text
Cannot find module '@napi-rs/canvas'
Cannot polyfill DOMMatrix
ReferenceError: DOMMatrix is not defined
at node_modules/pdfjs-dist/legacy/build/pdf.mjs:15620:22
```

The import chain was `api/index.ts` → `server/index.ts` → `routes/extract.ts` → `lib/pdfExtract.ts` → `pdf-parse` → PDF.js. The eager PDF import ran before Express initialized, even for health checks and with AI disabled. Without the native canvas package, PDF.js could not initialize its DOMMatrix global and crashed the Function process.

This is a source-level startup coupling exposed by the deployed dependency bundle. It is not evidence of a CORS, proxy or API-key configuration error. The supplied log establishes that canvas was unavailable; why the platform omitted it has not been established from build logs. The fix does not claim to repair Linux native PDF packaging.

A fresh Node process with a resolution hook rejecting only `@napi-rs/canvas` reproduced the same exception at **15620:22** before the change. Installed dependencies were not removed or modified. Earlier Windows smoke tests had native dependencies available and therefore did not reproduce this deployed condition.

## Minimal change

- `server/lib/pdfExtract.ts`: move the PDF import into the PDF branch, after the existing PDF signature check. Text/CSV, health, comparison and disabled AI requests do not load it. PDF import rejection propagates through the existing extraction route catch, which returns generic `422 EXTRACTION_FAILED`.
- `server/startup.test.ts`: regression in an isolated Node process with missing canvas simulated. It checks startup, health 200/AI false, unknown API JSON 404, both paid endpoints 503, hostile-origin 403, text extraction, PDF rejection and continued health after that rejection. Included by existing `test:all`, lint and strict typecheck scopes.
- `architecture.md`: record the PDF import boundary and cloud verification limitation.
- This report records evidence and review requirements.

No changes to the API entrypoint, routing configuration, dependency manifest/lockfile, environment defaults, wallets or contracts. `AI_MAX_CALLS=0`, absent real API key, Vercel file-budget refusal, exact CORS origins, proxy trust, validation, limits, timeouts and human release approval remain intact.

## Verification

| Check | Result |
|---|---|
| Before-fix regression | Failed as intended: missing canvas followed by `DOMMatrix is not defined`, same PDF.js line as live stack |
| `bun run test:all` | **96 pass, 0 fail, 241 expectations**, 4 files, 42.08s; output explicitly includes the passing `server/startup.test.ts` regression |
| `bun run contracts:test` | **61 pass, 0 fail, 0 skipped**, 1 suite, 44.84ms; Forge 1.7.1 |
| `bun run lint:app` | Exit 0, no diagnostics |
| `bun run typecheck:app` | Exit 0, strict application settings retained |
| `bun run build` | Exit 0, Vite 6.4.4, 25.32s; existing chunk-size warning (largest 1,413.16 kB, gzip 425.04 kB) |
| Official local Node builder | Exit 0; helpers false, 614 traced files, 9,408,494 bytes |
| Missing-canvas regression on emitted JavaScript | `COLD_START_WITHOUT_CANVAS_PASS` |
| Local Node HTTP/routing/dependency smoke | **43 checks passed**, including synthetic PDF with locally installed native dependencies |

Tools: Bun 1.3.14, Node 24.19.0, local `@vercel/node` 25.0.0. No live provider calls. Existing security tests use a nonfunctional placeholder and mocked SDK; the new regression removes the API-key environment variable.

Intermediate failures are retained in ignored `.runtime/stage5.4c-*.log`: the initial pre-fix build attempt hit sandbox filesystem restrictions and passed when rerun with appropriate local access. Two full-suite runs after the source fix encountered a synchronous child-process timeout in the new test harness; isolated Node checks passed. The test now uses a bounded asynchronous child process, and the final full suite and static checks pass. No application protection was changed to address either test-environment issue.

The final-review contract test initially crashed in the sandbox with `could not detect user home directory` (exit 9). The same command passed with the local toolchain's required filesystem access. Final-review logs use `.runtime/stage5.4c-final-review-*`. All current-state checks were rerun for this review, including the missing-canvas regression on freshly emitted Function JavaScript and the HTTP smoke against the fresh frontend build. The before-fix failure is retained evidence from the initial investigation.

The local official Vercel Node builder runs in dev mode on Windows. It does not establish a clean Linux install or actual cloud execution. A separate check applied the missing-canvas simulation to its emitted JavaScript and passed; the ordinary Node HTTP/routing/PDF smoke also passed 43 checks with installed native dependencies.

## Remaining limits and review

- The production URL has not received this fix. Restored public health/API behavior requires separately approved push/redeployment followed by live verification.
- PDF parsing with missing canvas still rejects. That failure is isolated from API startup; successful cloud PDF extraction remains unverified. Native package tracing/installation must be investigated before future PDF/AI enablement.
- Paid AI stays disabled; real inference remains unverified. No key should be added as part of this hotfix.
- Testnet Deal #1 is already RELEASED (4); do not repeat its release. Mainnet deployment remains pending.
- No browser testing was performed; contract tests passed and contract sources are unchanged.
- Only the four intended paths are authorized for the local commit. Push and deployment remain unapproved.
