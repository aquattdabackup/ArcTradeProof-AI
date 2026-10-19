# Stage 5.3 final pre-commit verification

2026-10-19. Existing `main` branch. This report supersedes the check scope and staging state in the historical Stage 5.2 report. All Stage 5.2 work was preserved and reviewed. No commit, push, history rewrite, deployment, wallet action or USDC transfer was performed.

## Compass dependency and check separation

`@circlefin/compass-chains` is imported only by `scripts/compass-deploy.ts`; it is absent from package.json/bun.lock and the installed modules. The Stage 5.2 public npm lookup returned 404. The helper also dynamically loads `@circlefin/compass-deploy` and `@circlefin/compass-ecosystem-evm`, assumes `/home/user/app`, and uses Studio RPC configuration. `self-deploy.ts` explicitly requires Studio-injected onchain facts. These are concrete signs of a Studio environment dependency. Its exact private-package distribution is not independently established. No production src/server/Vite entry point imports these deployment scripts.

The production `tsconfig.json` now includes `src`, `server` and `vite.config.ts`, keeping **all existing compiler options, including strict: true**. No ambient substitute, any-typed shim, suppression or compiler relaxation was introduced. New `scripts/tsconfig.json` extends those settings with explicit Node/Bun types for the preserved deployment tools. It is placed in scripts/ so the type-aware linter discovers the correct project automatically; see [Oxlint configuration discovery](https://oxc.rs/docs/guide/usage/linter/cli).

`lint:app` and `typecheck:app` are the production application checks; default `lint` and `typecheck` delegate to them. `lint:studio`, `typecheck:studio` and `check:studio` expose the separate tooling checks. The Studio checks still fail on the unavailable Compass dependency and are **not verified**. All existing deployment source files and contract sources/tests remain unchanged.

## Security review

Reviewed every changed Stage 5.2 source/config/documentation file and the complete new schema/test files. The two staged log removals correspond to the previously inspected local files (219 console lines and 73 trace lines); they remain locally available and ignored. No new secrets were detected in the intended source/documentation snapshot. This is not an exhaustive audit of historical Git objects.

- Both production tracing import paths are guarded by DEV and explicit opt-in. A production build with `VITE_STUDIO_DEBUG=true` still contains none of the Studio trace/console/control or fetch-patching markers. Studio source/provenance is preserved.
- Credentials are read only by the server. No real key was added; no credential patterns or API-key label appeared in emitted JS. AI success/error tests use synthetic responses and a nonfunctional test placeholder.
- CORS denies unconfigured/unapproved origins; request count limiting precedes body parsing, with explicit bounded proxy trust. Local proxy tests cover client separation and spoofed leftmost X-Forwarded-For values. The actual Render proxy path is not verified.
- Uploads, decoded bytes, MIME types, PDF page counts, extracted text, report prompts and model output are bounded and schema validated. Responses/errors do not disclose raw document/provider exceptions. PDF v2 extraction is covered by a synthetic PDF test.
- Monetary comparison remains deterministic BigInt; malformed inputs fail closed. The report route recomputes comparison data rather than accepting a forged client comparison.
- AI calls have a finite allowance, concurrency two, maximum 2,500 output tokens, zero automatic retries, and a 30-second abort signal. A real elapsed-time regression verifies generic JSON 504 behavior when the provider callback observes the abort. Disconnect cancellation is separately tested. Provider billing after cancellation remains possible; this is not verification of a live OpenAI call or hard CPU timeout for PDF parsing.
- Human approval and dynamic reviewHash wiring are unchanged. All 27 store/hash tests pass; source review confirms the simulated hash argument, displayed-hash equality check, explicit approval/deal/buyer guards and wallet submission of the simulated request. Contract buyer-only release tests pass. No wallet transaction was executed.

## Persisted budget: verified behavior and deployment boundary

The file at the operator-configured **absolute `AI_BUDGET_FILE` path** stores a JSON integer counting attempts. The sample `/var/data/arctradeproof/ai-calls.json` is documentation, not a provisioned mount. `AI_MAX_CALLS` defaults to **0**, disabling paid AI; maximum allowed configuration is 300. An unset or relative file-path setting or invalid allowance configuration fails closed. When an explicit valid path is supplied, a previously nonexistent file starts at zero. Corrupt contents, failed writes and exhausted allowance reject the call.

The count is written to a temporary sibling and atomically renamed **before** invoking the provider. A new regression launches three separate Bun processes against one temporary budget file: the first two reserve attempts, the third is rejected, and the counter remains two. This proves persistence across normal local process restarts using the same retained file. It does not establish resilience to filesystem loss/power failure or distributed concurrency.

**Render persistent storage has not been configured or verified by this work.** Before enabling paid AI, an operator must attach retained storage, set the path inside its mount and use exactly one process/instance. Ephemeral redeploys, deleting the budget file, or using different paths reset usage. Multiple instances require a shared transactional budget. Anonymous visitors can exhaust the finite shared allowance; an authenticated gateway is still needed for private judging access. Paid AI remains disabled by default.

## Documentation verification

README and AGENTS distinguish the completed testnet transaction from unverified real AI inference and pending mainnet deployment. README states Deal #1 is **RELEASED (4)**, with the owner-confirmed transaction:

`0x1c538deb65c7333e29f7631788319729b326e5d20369a452f2f6d4fb1251ea64`

It records 0.25 TESTNET USDC to the seller and explicitly says not to repeat TX6. Prototype/non-audited status, inability to verify physical delivery and buyer-required release remain explicit. No live transaction re-verification was claimed.

## Commands and actual results

Application checks/build/server: **Bun 1.3.14**, matching `.bun-version`. Contract tests: **Forge 1.7.1**, pinned Solidity **0.8.28**. Runners and command logs are in ignored `.runtime/`; no new production package was installed for Compass.

| Command | Final output summary |
|---|---|
| `bun run test:all` | **91 pass, 0 fail; 205 expect() calls; 3 files; 35.93s**. Includes all 88 Stage 5.2 tests plus fresh-process budget persistence, failed-reservation/configuration and 30-second timeout coverage. |
| `bun run contracts:test` | **61 tests passed, 0 failed, 0 skipped**; four fuzz cases, 256 runs each. |
| `bun run lint:app` | `$ oxlint --type-aware src server vite.config.ts`; exit **0**, no diagnostics. |
| `bun run typecheck:app` | `$ tsc --noEmit -p tsconfig.json`; exit **0**, no diagnostics. |
| `bun run build` with `VITE_STUDIO_DEBUG=true` | Exit **0**, `built in 24.94s`; dependency PURE-annotation warnings and >500 KB chunk warning remain. |
| `bun run start` | Production server listened locally on port **3093** for HTTP verification; paid AI explicitly disabled. |
| Production HTTP smoke | Root, JS/CSS and SPA fallback **200**; health JSON **200**, aiReady false; extract/report without key JSON **503**; invalid/malformed compare JSON **400**; wrong content type JSON **415**; unknown API JSON **404**; attacker origin JSON **403** without an allow-origin header; valid deterministic compare JSON **200**, exact 0.000001 USDC discrepancy. |
| Production bundle scan | No Studio capture markers, API-key label, test placeholder or credential-pattern match. |
| `bun run typecheck:studio` | Exit **1**, TS2307 at `scripts/compass-deploy.ts:14`: cannot find `@circlefin/compass-chains`. Expected unresolved tooling limitation. |
| `bun run lint:studio` | Exit **1**, seven type-aware errors from that unavailable Compass import. Not reported as passed. |
| `git diff --check` and staged equivalent | Pass. |

The initial new process-restart test hit Bun's default five-second test harness timeout while launching three processes; its dedicated harness timeout was raised to 35 seconds with a 10-second child-process bound. The final pinned-runtime run passes. Forge initially could not detect its home directory under the filesystem sandbox; rerunning the same local tests with approved sandbox escalation passed. No contract behavior changed.

Browser interaction was **not performed**; HTTP delivery is not a browser-rendering or wallet end-to-end test. Live OpenAI inference, real Render proxy behavior and deployed persistent disk configuration remain unverified. No paid API request was made.

## Complete staged manifest

The following 26 paths form the intended commit. `console.jsonl` and `traces.jsonl` are index deletions only, with ignored local copies preserved. All other entries are code, tests, configuration or documentation.

```text
.env.example
.gitignore
AGENTS.md
README.md
architecture.md
bun.lock
console.jsonl
docs/stage5.2-report.md
docs/stage5.3-report.md
package.json
scripts/tsconfig.json
server/ai.ts
server/index.ts
server/lib/compare.test.ts
server/lib/compare.ts
server/lib/pdfExtract.ts
server/routes/compare.ts
server/routes/extract.ts
server/routes/report.ts
server/schemas.ts
server/security.test.ts
src/components/AiDocIntelligence.tsx
src/config.ts
src/main.tsx
traces.jsonl
tsconfig.json
```

An explicit file list is used for staging; no blanket `git add .`. The final index is checked for `.env` files (except the blank `.env.example`), credential signatures, private-key material, logs and generated artifacts. Contracts, deployment source, user-local files, build output and runtime tools are excluded from changes. Earlier log history remains untouched.

## Commit recommendation

**Safe to commit as a bounded prototype hardening and verification change**, with the limitations above documented. This is not deployment approval, proof of live AI correctness, a mainnet readiness claim or a security audit. Paid AI stays disabled until the operator configures and verifies its required environment.

Suggested message:

`Harden demo API, remove debug logs, and separate Studio tooling checks`

Stop after staging. User confirmation is required before commit or push.
