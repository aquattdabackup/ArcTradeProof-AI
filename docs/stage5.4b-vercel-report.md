# Stage 5.4B — Vercel migration

2026-10-20. **Implemented and locally verified; awaiting review. No deployment performed.** Vercel replaces Render as the selected hosting platform. Initial deployment remains a limited testnet preview with paid AI disabled. It is not a completed contest submission or a mainnet demonstration.

## Baseline and inspection before implementation

Started on clean `main`, HEAD `1e4b0836c12101cc5adacd59d9dc1403acb7875e`, with origin `https://github.com/aquattdabackup/ArcTradeProof-AI.git`. Read the project instructions, README/architecture, package and lockfile metadata, production entrypoints, routes/schemas/PDF handling, frontend/wallet configuration, existing tests and Stage 5.3/5.4A evidence. Pre-implementation findings were recorded in temporary task memory before code changes; this report retains the decisions.

The former Render design runs one Bun process: Express handles `/api/*` and serves Vite's dist/ assets and index.html. It relies on PORT and a long-lived process, with a local JSON budget file that would need retained storage before paid inference. That hosting plan was never deployed or verified here. The prior [Stage 5.4A report](stage5.4a-report.md) remains unchanged historical evidence; its Render settings are not the selected setup now.

Official documentation findings used for this migration:

| Topic | Verified platform guidance and consequence |
|---|---|
| Vite | Vite static builds are supported; SPA deep links need routing configuration. Keep Vite and dist/ output. [Vite docs](https://vercel.com/docs/frameworks/frontend/vite) |
| Express | Express can be exported for Function execution; express.static does not serve assets in Vercel's Express model. Use platform static hosting separately. [Express docs](https://vercel.com/docs/frameworks/backend/express) |
| Node | TypeScript under api/ is supported. Node 24.x is supported with platform-managed patch versions. [Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) |
| Bun | Runtime remains beta; allowed bunVersion values are 1.x and 1.4.x, not an exact 1.3.14. The documentation currently maps 1.x to 1.3.14, but this is not a patch pin. [Bun runtime](https://vercel.com/docs/functions/runtimes/bun) |
| Configuration | Existing files take precedence over rewrites; current guidance deprecates explicit handle:filesystem configuration. Use high-level rewrites and an API-excluding SPA rule. [Configuration](https://vercel.com/docs/project-configuration/vercel-json) |
| Limits | Normal Function payload limit is 4.5 MB; standard bundle limit is 250 MB. Fluid duration defaults/maxima vary by plan; this API explicitly requests 60 seconds. Platform rejection/timeout may occur before or outside Express. [Function limits](https://vercel.com/docs/functions/limitations) |
| Files and scaling | Function filesystem is read-only except scratch /tmp; instances scale independently. Neither file counters nor process memory are a durable shared quota. [Runtimes](https://vercel.com/docs/functions/runtimes), [scaling](https://vercel.com/docs/functions/concurrency-scaling) |
| Environment | Scope variables deliberately to Production/Preview. VERCEL_URL is a generated hostname without scheme; do not derive CORS trust from request headers. [System variables](https://vercel.com/docs/environment-variables/system-environment-variables), [environment configuration](https://vercel.com/docs/environment-variables) |

## Implemented architecture

```text
Public HTTPS origin (not deployed yet)
  existing files                 -> Vercel static hosting of Vite dist/
  /api and /api/*                -> api/index.ts -> Express createApp
  other frontend paths          -> dist/index.html SPA fallback

Express Function:
  GET  /api/health               -> configuration/liveness JSON
  POST /api/compare              -> validated deterministic BigInt comparison
  POST /api/extract, /api/report -> JSON 503 in initial zero-key mode
  unknown /api paths             -> JSON 404, never SPA HTML
```

`api/index.ts` default-exports the existing Express application with `serveStatic: false` and production origin policy. It does not call listen. Existing standalone `bun run start` retains its combined SPA/API behavior for local use. Request/response schemas, routes and error handling are unchanged.

`vercel.json` explicitly selects Vite, frozen Bun install, `bun run build`, dist output, one api/index.ts Function definition with maxDuration=60, and three rewrites: bare /api, /api/(.*), then a negative-lookahead SPA fallback excluding the entire /api namespace. Explicit bare and wildcard rules cover trailing and repeated slashes. Static assets are served by the platform's filesystem precedence. No legacy builds/routes configuration or global SPA rewrite is mixed in. Local routing tests cover /api, /api/, nested/unknown API paths, /api//unknown, normal frontend paths and static JS/CSS.

### Runtime decision: Node 24.x

Select **Node 24.x**, declared in package.json engines.node. Existing production code uses Express and Node fs/path/url APIs; Bun.spawnSync and bun:test occur only in tests. Vercel's official Node builder successfully transpiled the api/ entry and its server dependency graph using the existing TypeScript 7.0.2 compiler, retaining functional .js import resolution. The emitted application ran under installed Node **24.19.0**, with no Bun global. Express, comparison, schemas and pdf-parse were exercised successfully on that runtime.

Bun is not rejected as incompatible: it still runs the full application suite and local tooling. It was not chosen for Functions because the beta, platform-managed runtime provides no exact existing patch guarantee and the production graph needs no Bun-specific feature. No bunVersion property is set. Bun remains the package manager/build-script runner; .bun-version is the local baseline, not a claim about Vercel's runtime or installed package-manager patch. Record actual build tool versions during the later cloud build. No package upgrade or lockfile regeneration was introduced.

## Exact changed files

| Path | Change |
|---|---|
| `api/index.ts` | New minimal Express Function export; static serving disabled, no listener |
| `vercel.json` | Vite/static output, install/build commands, finite Function duration and API-safe rewrites |
| `server/index.ts` | Optional static-serving switch; exact https://VERCEL_URL fallback when VERCEL=1; preserve standalone Render fallback |
| `server/ai.ts` | Refuse file-based budgets on Vercel before any filesystem read/reservation |
| `server/security.test.ts` | Four regression tests covering API-only serving, Vercel origin fallback/override, invalid/missing hostname, and paid-AI file-budget refusal |
| `package.json` | Node 24.x engine; include api/ in lint:app |
| `tsconfig.json` | Include api/ in the existing strict application scope; no compiler weakening |
| `.env.example` | Zero-AI Vercel configuration guidance; NODEJS_HELPERS, origins and prohibition on Vercel file budgets |
| `.gitignore` | Ignore local .vercel/ project/build metadata |
| `README.md` | Vercel is selected; setup, routing/runtime/environment guide and honest zero-AI behavior; link historical Render report |
| `architecture.md` | Current Vercel architecture, checks, origin/budget boundaries and historical Render context |
| `AGENTS.md` | Append current hosting instructions while retaining historical stage records |
| `docs/stage5.4b-vercel-report.md` | This evidence, deployment procedure, limitations and future requirements |

No contracts, Foundry tests, deployed address records, frontend wallet/approval/store/hash implementation, Studio deployment scripts, previous reports or bun.lock changed. Ignored .runtime tools/logs and dist build output are not intended Git changes. No commit or staging is performed.

## Security behavior and future paid-AI design

Initial Dashboard values are AI_MAX_CALLS=0 and **no OPENAI_API_KEY**. The provider remains server-only; no VITE_ secret or wallet credential is introduced. On Vercel, budget() also returns unavailable before reading a file. Even a synthetic key, positive allowance and writable local counter cannot enable calls when VERCEL=1: the regression verifies health false, both AI routes return AI_BUDGET_UNAVAILABLE and the counter stays zero. Without a key, the normal HTTP error remains AI_NOT_CONFIGURED. Do not override the platform's VERCEL marker.

CORS accepts exact HTTPS origins only. PUBLIC_ORIGIN overrides the platform fallback; when absent on Vercel, only https://VERCEL_URL is accepted. No cross-project wildcard or arbitrary request Host/forwarded-host trust is added. An explicit blank suppresses fallback and denies Origin-bearing requests. The stable production/custom domain needs explicit PUBLIC_ORIGIN; Preview may use the generated deployment URL. Branch aliases need explicit configuration if used. The historical RENDER_EXTERNAL_URL fallback is ignored on Vercel.

Set **NODEJS_HELPERS=0** for both build and runtime so Vercel's Node helper layer does not own parsing/response helpers ahead of Express. The local builder confirmed shouldAddHelpers=false. This is a required deployment setting, not an assertion that all Vercel ingress errors become Express JSON. [Official helper configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)

Retained protections: 1.5 MB uncompressed JSON request bound, 1 MB decoded document bound, ten PDF pages, 12,000-character text/prompt bounds, bounded Zod model/document schemas, deterministic comparison recomputation, advisory-only prompts, generic errors, explicit buyer approval and dynamic reviewHash. Provider retries remain zero, output cap 2,500 tokens and abort timeout 30 seconds. These provider protections are tested with mocks, not live inference.

The in-memory rate limiter is **per instance**, 20 POST requests per 15 minutes per derived client key, not a global quota. The two-call concurrency counter is also per process. Restarts reset memory; more instances multiply limits. TRUST_PROXY_HOPS stays 0 until actual platform proxy behavior is verified; visitors may share buckets. Do not change it to 1 merely to clear a 429. CORS is not authentication. Platform scaling and Vercel billing remain possible even with paid AI disabled.

Future paid AI requires a separately reviewed implementation, not a /tmp counter or a Dashboard-only change:

1. Authenticate users server-side and authorize document/tenant access. For cookie authentication add CSRF protection; never embed a shared API secret in the SPA.
2. Use a shared durable transactional store. Atomically reserve an attempt against both user and project lifetime/time-window caps **before** provider invocation; concurrent requests must not overspend. Store idempotency keys and reservation state. Missing budget records, unavailable storage and failed transactions must fail closed, not silently reset to zero.
3. Coordinate distributed concurrency with bounded leases and cancellation/crash recovery. Retain bounded input/output, provider retries and timeouts. Do not automatically refund uncertain or failed attempts that may already be billed.
4. Test competing Function instances, retries, duplicate requests, process death, timeout, store outages, backup restoration and administrative budget resets. Separate an attempt cap from a dollar spending cap; constrain models/tokens and add provider-side spending controls.
5. Provision nothing without separate approval. A managed transactional SQL database is one possible design, not an integration already implemented. After storage/auth/security review, remove or replace the Vercel file-budget guard deliberately and verify one approved real inference before claiming AI works.

## Validation and exact results

Required commands ran with Bun **1.3.14** and paid AI disabled. Security tests use a nonfunctional placeholder and a mocked SDK. Contract tests use Forge **1.7.1**, existing Solidity 0.8.28 configuration. Local Node checks use **24.19.0**.

| Check | Result |
|---|---|
| `bun run test:all` | Exit 0: **95 pass, 0 fail, 239 expect() calls; 3 files; 37.55s** (91 baseline tests plus four regressions) |
| `bun run contracts:test` | Exit 0: **61 passed, 0 failed, 0 skipped**; suite run 141.35ms; four fuzz tests, 256 runs each |
| `bun run lint:app` | Exit 0: `$ oxlint --type-aware src server api vite.config.ts`; no diagnostics |
| `bun run typecheck:app` | Exit 0: `$ tsc --noEmit -p tsconfig.json`; no diagnostics; strict unchanged |
| `bun run build` | Exit 0: Vite 6.4.4, **built in 37.42s**; existing PURE annotation and >500 KB chunk warnings; largest JS 1,413.16 kB, gzip 425.04 kB |
| `bun install --frozen-lockfile` | Exit 0: **Checked 1028 installs across 1003 packages (no changes) [1069.00ms]** |
| Official routing compiler | @vercel/routing-utils **6.6.0** accepts configuration and resolves tested API/SPA boundaries |
| Official Node builder, local dev mode | @vercel/node **25.0.0** transpiles the API dependency graph; Lambda runtime label `nodejs` in dev mode, helpers false; **614 traced files, 9,408,088 bytes** on this Windows install |
| Node HTTP/routing/dependency smoke | **43 checks passed** under Node 24.19.0, using builder-transpiled app files and installed dependencies; includes synthetic PDF extraction |
| Configuration schema checks | All configured properties validate against the corresponding official schema fragments; whole-schema validation limitation below |
| Final diff and bundle review | `git diff --check` passes; 13 intended paths, empty index, baseline unchanged. No credential signatures in changed files or emitted JS, no .env artifacts in dist, no Studio capture/API-key markers. Studio link and testnet escrow marker retained. This is not an exhaustive secret/security audit. |

The Node smoke harness models filesystem precedence and the routes generated by the official routing compiler. It serves the actual dist files locally and invokes the emitted Express export with the original API URL. It verifies root, JS/CSS MIME and delivery, a deep link, health, zero-key 503 responses, valid comparison with exact 0.000001 discrepancy, unknown/bare/trailing/nested API JSON 404, invalid/malformed 400, body-size 413, unsupported/compressed 415, hostile-origin 403, exact-origin/preflight success, and Node text/PDF dependencies. **This is a local routing simulation, not a Vercel edge/CDN test.**

Local verification scripts/logs are in ignored `.runtime/`: stage5.4b-check.py and command logs; stage5.4b-builder.cjs, builder.log and routes.json; stage5.4b-node-smoke.mjs and its log. The official builder/routing packages were installed only in `.runtime/vercel-tools`, with install scripts disabled, using their verified vercel/vercel repository metadata. No production dependency was added. The builder used dev mode and reused installed packages; this does not validate a clean Linux install, deployed native binaries, platform packaging/duration settings or the cloud routing adapter.

Honest tool limitations: the first builder harness expected `nodejs24.x`, while dev mode returns generic `nodejs`; correcting the local assertion allowed the actual transpilation/Node checks to run. Full validation of the downloaded official vercel.json schema could not complete: it declares draft-04 but contains an unrelated numeric exclusiveMinimum in experimentalTriggers. The proper draft-04 validator rejected that upstream definition. We did not modify the project to bypass validation: checked the properties actually used against their schema fragments, and verified routing with the official compiler. A full cloud configuration/build check remains pending.

No CLI login/link/env pull, vercel build/dev command, Preview deployment or Vercel-hosted request was performed. No credentials were inspected or silently reused. CLI project verification needs **user-operated authentication/linking and separate approval**; no fake project IDs or remote settings were created to bypass this. Browser rendering and wallet interaction were not performed. No paid AI call or blockchain RPC/transaction was used for the migration checks.

## Required Dashboard settings and deployment procedure

This procedure is for the user **after review and separate deployment approval**. Do not run it as part of this local task.

1. Approve the code/report, then separately authorize commit/push if desired. Confirm main, the intended GitHub repository and the approved commit. Do not deploy the current older GitHub baseline expecting these unstaged local changes to exist there.
2. Sign in to Vercel yourself and import `aquattdabackup/ArcTradeProof-AI` using the GitHub integration. Select repository root, Production branch main, **Vite** framework, **Node 24.x**. Keep vercel.json settings: install `bun install --frozen-lockfile`, build `bun run build`, output dist. Do not use the Express preset, a start command, custom PORT, legacy builds or a competing SPA rewrite.
3. Before clicking Deploy, configure Production and Preview environment scopes. Enable automatic system environment variables. Review the chosen plan, function/transfer spending controls and Git-triggered deployment settings. Creating/importing a project can start deployment; this task does not authorize that click or any paid resource.

| Variable | Production | Preview |
|---|---|---|
| NODE_ENV | production | production |
| AI_MAX_CALLS | **0** | **0** |
| OPENAI_API_KEY | **Absent** | **Absent** |
| AI_BUDGET_FILE | Absent | Absent |
| NODEJS_HELPERS | **0**, before build | **0**, before build |
| TRUST_PROXY_HOPS | **0** pending live validation | **0** |
| PUBLIC_ORIGIN | Exact stable project/custom HTTPS origin; no trailing slash | Absent for unique deployment URL, or explicitly configured exact Preview origin |
| ALLOWED_ORIGIN | Absent unless a second exact frontend is approved | Same policy |
| VERCEL / VERCEL_URL | Platform supplied; do not manually override | Platform supplied |
| VITE_STUDIO_DEBUG / wallet/private keys | Absent | Absent |

Check shared/integration-provided environment variables too. Do not upload local .env files. Preview deployment protection may require a Vercel account; configure public judging access deliberately after verification, not by publishing an automation bypass token. The actual URL and live settings are unverified. Environment scopes and secrets are managed in Dashboard, not source. [Environment scopes](https://vercel.com/docs/environment-variables), [secret settings](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

4. After approval, deploy and record the actual SHA, Node/Bun build versions and HTTPS URL. Verify Function packaging, helpers disabled, maxDuration=60, successful cold start and root/assets. Stop on failures; do not weaken CORS or proxy trust. If CLI checks are wanted, the user must authenticate/link first; no credentials should be pasted into chat.
5. On the actual URL, verify root, JS/CSS, refreshed deep links and same-origin /api requests in a browser. Health should be JSON 200 with aiReady false/model null. POST empty JSON to extract/report should be JSON 503 AI_NOT_CONFIGURED. Compare empty JSON should be 400; a structured synthetic comparison should succeed. Unknown /api paths must be JSON 404, not index.html. Check hostile Origin returns 403 without allow-origin and the exact configured Origin is accepted. Keep within the per-instance request limits.
6. Verify a public unauthenticated browser can reach the intended judging URL, with AI marked unavailable. Test an injected wallet's display and network handling without signing: Arc Testnet 5042002, current v2 escrow and released Deal #1. Wrong-network and approval/hash controls must be reviewed on the real UI before any later transaction approval. Do not repeat TX6 or create another deal as a hosting smoke test.

## Remaining blockers and contest requirements

No unresolved failure in the requested local tests/build was observed. **Deployment validation remains blocked on approval and user-operated Vercel access.** Linux/native dependency packaging, actual API URL preservation by Vercel routing, helper settings, platform limits, TLS, proxy IP behavior, deployment protection/public access and browser/wallet rendering still need a real approved Preview. Ingress payload errors above Vercel's limit, cold-start/configuration failures and platform timeouts may be platform-generated responses rather than app JSON.

The UI remains a fixed testnet demo, including fixed participant/evidence guards in several transaction components. Paid AI is unavailable; structured comparison is usable, but a fresh AI-analysis-to-release workflow is not verified. The AI provider has no wallet/signing authority. Review state is browser memory and is not durable across refreshes. Large frontend chunks, non-isolated PDF parsing for future enabled mode, instance-local counters, anonymous request abuse and historical debug-log Git history remain limitations. Compass tooling remains unverified outside Studio and is not part of the production build.

Per the contest requirements supplied by the owner, the following are **still pending**; these are not claims of independently verified current contest rules:

- A working public Vercel application and browser/wallet verification.
- A real, approved AI inference verification after authenticated durable budgeting is implemented.
- Separate Arc Mainnet readiness/security review and deployment. Existing escrow is **Arc Testnet only**, v2 `0x7f1af92df34d8e58dba70688404de57276a42bc7`.
- An explicitly approved real USDC transaction through the mainnet contract and application. The completed testnet Deal #1 **RELEASED (4)**, TX `0x1c538deb65c7333e29f7631788319729b326e5d20369a452f2f6d4fb1251ea64`, does not satisfy that requirement and must not be repeated.
- The actual Arc Studio project URL/provenance evidence (the generic Studio watermark alone is not a project URL), public repository access verification, mainnet contract/transaction links and demo video. No project URL or mainnet evidence was invented.

Recommended next action: review this diff and report. Only after approval should the user authorize commit/push and a user-operated zero-AI Preview, then collect the missing host/browser evidence. Keep paid AI, resource provisioning and all blockchain actions separately gated. Stop here; no commit, push or deployment is performed by this stage.
