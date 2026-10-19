# Stage 5.2 security hardening and Git cleanup

> Historical Stage 5.2 handoff snapshot. Check scope, final testing, runtime and staging state are superseded by [Stage 5.3 verification](stage5.3-report.md).

Verified locally on 2026-10-19. Existing repository, branch `main`; initial working tree was clean. No commit, push, history rewrite, deployment, wallet creation or blockchain transaction was performed.

## Findings and fixes

1. **Published debug data.** Inspected all 219 lines of `console.jsonl` and 73 lines of `traces.jsonl`. Console records were Vite development events/errors. Traces contained wallet addresses, permission metadata, transaction calldata/hashes/signatures, preview URLs and health responses. No credentials or confidential commercial-document contents were found in these current copies. Transaction signature components are public transaction data, not private keys. Both files are ignored and staged for removal from the index; local copies remain. Earlier Git history remains public and was not rewritten. This was not an exhaustive historical secret audit.
2. **Production instrumentation.** `main.tsx` and the indirect import in `config.ts` previously loaded Studio instrumentation in production. Both now dynamically import it only with `import.meta.env.DEV` and `VITE_STUDIO_DEBUG=true`. The Studio modules and provenance watermark remain. Production bundle inspection found no Studio trace/console event markers or fetch-patching marker.
3. **Open CORS and proxy assumptions.** Production no longer reflects arbitrary origins. Only exact configured origins are allowed; unconfigured Origin-bearing requests get JSON 403. Same-origin Render hosting uses `PUBLIC_ORIGIN` or `RENDER_EXTERNAL_URL`. `TRUST_PROXY_HOPS` defaults to zero and accepts only integers 0–5. One-hop tests demonstrate isolated client limits and resistance to spoofed leftmost X-Forwarded-For entries. Live Render topology still requires verification. CORS is not authentication.
4. **Unbounded AI spending and incomplete timeout.** Paid AI is disabled by default. Operators must configure a server key, a finite `AI_MAX_CALLS` allowance (maximum 300), and an absolute `AI_BUDGET_FILE` path. Attempts are atomically recorded before contacting OpenAI and survive restart on persistent storage. Failed attempts count. There are no automatic resets or retries, at most two concurrent provider calls, 2,500 maximum output tokens per call, and a 30-second abort signal also triggered by disconnects. Early readiness checks reject disabled/exhausted usage before parsing documents. This budget is for exactly one process/instance.
5. **Untrusted request/model data.** Added bounded Zod schemas for uploads, extracted documents and model output, with an explicit dependency already present transitively in the lockfile. Enforced JSON/content encoding, 1.5 MB request bodies, 1,000,000 decoded file bytes, base64 syntax, allowed MIME types, ten PDF pages, 12,000 document characters and 12,000 report-prompt characters. Oversized text is rejected instead of silently truncated. Report comparisons are recomputed server-side rather than trusting a client-supplied result. Both AI prompts treat document values as untrusted data; schemas and human review remain necessary because prompts cannot guarantee accuracy.
6. **PDF and monetary correctness.** Replaced the obsolete pdf-parse v1 call with the installed v2 API, page bounds and parser cleanup. BigInt arithmetic remains; malformed signs/grouping, scientific notation and precision beyond six decimals now fail closed rather than being silently stripped or rounded.
7. **Error disclosure.** Removed raw provider/parser error messages from responses and server logs. Malformed/oversized/compressed JSON returns generic JSON errors. Missing keys return JSON 503. Unknown API routes, including `/api`, return JSON 404, preserving the `/api/*` same-origin design.
8. **Documentation and judging UI.** README and AGENTS now record Deal #1 as RELEASED (4), with the owner's confirmed TX6 hash and 0.25 TESTNET USDC result; TX6 must not be repeated. Mainnet and real AI inference remain unverified. Prototype status, physical-delivery limitations and buyer-only release are explicit. Public UI no longer asks visitors to edit `.env` or add an API key. Arc Studio competition provenance is retained.

## Exact files changed

| File | Change |
|---|---|
| `.env.example` | Blank key placeholder; origin/proxy/allowance/storage/debug configuration |
| `.gitignore` | Ignore the two logs and local `.runtime/` tools/results |
| `AGENTS.md` | Correct TX6 and deployment/AI status; current setup requirements |
| `README.md` | Correct deal status, provenance, prototype limits, deployment and abuse-control tradeoffs |
| `package.json` | Declare Zod; run security tests; make lint read-only and include backend |
| `bun.lock` | Add the direct Zod dependency only; no package version churn |
| `server/index.ts` | Origin checks, explicit proxy trust, early rate limit/body guards, JSON errors, testable app factory |
| `server/ai.ts` | Server-only provider, persistent allowance, concurrency/output/retry/abort limits |
| `server/schemas.ts` (new) | Bounded request/document/model schemas |
| `server/routes/extract.ts` | Validate uploads/output; enforce text bounds; generic errors; guarded AI call |
| `server/routes/compare.ts` | Validate both documents before deterministic comparison |
| `server/routes/report.ts` | Validate inputs/output, recompute comparison, bound prompt, guarded AI call |
| `server/lib/pdfExtract.ts` | Correct v2 API, PDF/page/text bounds and cleanup |
| `server/lib/compare.ts` | Reject malformed monetary values while preserving exact integer arithmetic |
| `server/lib/compare.test.ts` | Eleven malformed/precision regression cases |
| `server/security.test.ts` (new) | Fourteen HTTP, allowance, model-boundary and PDF regression tests |
| `src/main.tsx` | Development-only opt-in Studio imports |
| `src/config.ts` | Remove indirect production tracing import |
| `src/components/AiDocIntelligence.tsx` | User-facing AI availability messaging |
| `architecture.md` (new) | Verified architecture and operational invariants |
| `docs/stage5.2-report.md` (new) | This review report |
| `console.jsonl`, `traces.jsonl` | Staged index deletions only; local copies preserved |

No escrow Solidity, contract test, ABI, release component, review-hash implementation or wallet submission code was modified.

## Actual verification

Environment: Windows, Bun 1.4.3 (workspace-local runner), Forge 1.7.1, Solidity 0.8.28. The repository's `.bun-version` pins 1.3.14; that exact Bun version was not exercised here.

| Check | Actual result |
|---|---|
| `bun run test:all` | **88 passed, 0 failed**: 63 existing + 25 new tests; 177 assertions on final run |
| `forge test` | **61 passed, 0 failed, 0 skipped**, including four fuzz cases with 256 runs each |
| `bun run lint` | **Fails**: seven type-aware errors caused by existing unavailable Compass import in `scripts/compass-deploy.ts` |
| `bun run typecheck` | **Fails**: TS2307 for `@circlefin/compass-chains`, imported at `scripts/compass-deploy.ts:14` but absent from dependencies; npm lookup returned 404 |
| `oxlint --type-aware src server` | Pass, exit 0 |
| `oxlint .` | Pass, exit 0 |
| Focused `tsc --noEmit` for `src` and `server` | Pass, exit 0, using ignored `.runtime/tsconfig.verify.json` extending the main config |
| `bun run build` | Pass; dependency PURE-annotation and >500 KB chunk warnings remain |
| Production `bun run start` | Pass; serves on local port 3092 for smoke testing |
| Production HTTP smoke | `/`, JS/CSS assets and SPA fallback 200; health JSON 200/aiReady false; extract/report without key JSON 503; invalid compare JSON 400; unknown API JSON 404 |
| API security regressions | Origin rejection, proxy/IP limits, malformed/oversized/compressed input, valid comparison, schema limits, allowance exhaustion/corruption, concurrency and disconnect cancellation pass |
| PDF extraction | Real synthetic one-page PDF extracts successfully; eleven-page PDF rejected |
| Production bundle scan | No Studio trace/console/control markers, fetch-patching marker, OPENAI_API_KEY label or credential-pattern match |
| Credential signature scan | No matches in reviewed current first-party tracked source/config/docs and new security files; no secret values printed |
| `git diff --check`, staged equivalent | Pass |
| Interactive frontend rendering | **Not verified**: CUA inventory has no browsers; creating an in-app browser reports unavailable. HTML and JS/CSS delivery were verified over HTTP |
| Real OpenAI inference | **Not verified**; all AI success/error regression responses were mocked; no paid API call made |
| Live Render proxy behavior | **Not verified**; tested a local one-hop simulation only |

The original full-project checks were not weakened to hide the missing Compass package. The deployment script was preserved. The focused checks establish the application/backend changes compile and lint, while the full project remains blocked by that dependency.

Dynamic reviewHash verification: all 27 existing store/hash tests pass. Source review confirms `ApproveAndRelease.tsx` still takes the bound package hash, passes it as `args[1]` in simulation, checks that simulation argument against the displayed hash, requires explicit buyer approval and matching deal/buyer, and submits the simulated request. No wallet transaction was signed; these checks are not a live end-to-end wallet test.

## Remaining risks and deployment readiness

**Ready for code review; not an unconditional production sign-off.** The zero-key public prototype can serve the SPA and deterministic API. Enabling paid judging AI requires a persistent disk outside `dist`, one process/instance, an explicit finite allowance and server key configured by the owner, exact production origin and verified proxy hops. Do not use ephemeral storage for an enabled budget. Multiple instances require a transactional shared limiter/budget before enabling AI.

Anonymous visitors can exhaust the shared allowance and deny judges access; an authenticated gateway is the next step if private judging access is needed. The allowance limits attempts, not exact dollars; token/input caps and disabled retries bound each attempt. Aborted requests can still be billed. Deleting or losing the budget file resets usage. Health indicates configuration/remaining allowance, not valid provider credentials or proven inference. PDF parsing has file/page/text bounds but is not isolated in a resource-limited worker; adversarial parser CPU/memory behavior remains a prototype risk.

Resolve the private/unavailable Compass package, verify the pinned hosting runtime, real inference, browser rendering and actual Render proxy behavior before claiming all checks green. Mainnet remains undeployed. This is not an audited trade-finance service and cannot verify real-world delivery; only buyer authorization can release escrow funds.

## Git review state

Only the two log removals are staged. Source, docs and new tests remain unstaged for review. The index contains no real `.env`, debug logs, generated build directories or installed tooling. Local logs remain intact and ignored. Contract sources/tests are unchanged. No unrelated changes were found. No commit or push was made; confirmation is still required for either.

Reference guidance used: [Express proxy trust](https://expressjs.com/en/guide/behind-proxies.html), [Render client-IP guidance](https://render.com/articles/how-render-handles-ddos-attacks), [pdf-parse v2 API](https://github.com/mehmet-kozan/pdf-parse).
