# Stage 5.4A — production deployment pre-flight

2026-10-19. Local preparation only. **Ready for user review of a limited public demo with paid AI disabled**, subject to the host checks below. No runtime blocker was reproduced with Bun 1.3.14 locally. This is not approval or evidence of a completed Render deployment, functioning real AI, or mainnet readiness.

## Baseline and scope

At entry, `git status --short` was empty, branch was `main`, and HEAD was exactly `5200c6063b06b87678fb398b5b2f1fee42fd40fc`. Both origin URLs were `https://github.com/aquattdabackup/ArcTradeProof-AI.git`. HEAD remains unchanged. No staging, commit, push, history rewrite, deployment, paid inference, wallet signing or blockchain transaction was performed.

Read AGENTS.md, README.md, architecture.md, the Stage 5.3 report, package.json, .bun-version, .env.example, server entry/provider/routes/schemas, Vite/frontend/wallet configuration and relevant existing security, comparison and approval/hash tests. Contract tests were rerun without changing contract or deployment source. Studio provenance and the AI → human approval → wallet/contract flow are preserved.

Intended changed paths (all unstaged):

```text
README.md
architecture.md
docs/stage5.4a-report.md
```

The demonstrated problem was the old first-deployment runbook: it suggested `AI_MAX_CALLS=60`, `TRUST_PROXY_HOPS=1`, adding a provider key, and a health result with AI enabled. README now specifies zero allowance, no key, zero proxy trust, a frozen lockfile install, exact runtime/source settings and checks for an intentionally unavailable AI service. Its architecture diagram now identifies the current escrow as testnet-only. Architecture memory records verified configuration behavior and deployment limitations. No speculative application refactor or dependency change was needed.

## Production readiness findings

| Area | Evidence and conclusion |
|---|---|
| Bun/install | `.bun-version` and local executable both report **1.3.14**. `bun install --frozen-lockfile` with NODE_ENV=production succeeded against the existing local installation, with no lockfile changes. This is not a clean Linux dependency install. |
| Build/start | `build` is `vite build`; `start` is `NODE_ENV=production bun run server/index.ts`. Local production startup succeeded on PORT=10000. Bun executes TypeScript directly; no separate backend emit step is required. Build needs devDependencies for Vite. |
| Binding | `listen(Number(PORT ?? 3001))` does not restrict the host to localhost. Local Bun's wildcard listener reports `::` and accepts IPv4 requests. Render requires a publicly reachable wildcard listener on its PORT; verify port detection and IPv4 reachability on the actual Linux host. No local evidence justified changing the listener. [Render port requirements](https://render.com/docs/web-services) |
| SPA and API | Production serves dist/index.html, referenced JS/CSS and deep links. API routes and JSON 404 catch-all precede the SPA fallback; there is no production Vite proxy. `src/lib/apiClient.ts` uses relative `/api/*` calls. |
| Health | `/api/health` returns 200 with `status: "ok"`, `aiReady: false`, `model: null` in the first-deployment mode. It reports liveness/configuration, not inference or frontend/RPC readiness. Missing build output is not tested by health; build success plus root/asset checks are required. |
| Origin policy | Exact HTTPS origin validation is enforced in production. Local probes verified Render fallback, custom-domain override, explicit-empty fail-closed behavior, denied lookalike/hostile origins, and valid OPTIONS preflight. Origin selection comes from server environment, never request Host/forwarded headers. |
| Proxy trust | Default and runbook value remain **0**. Twenty POST requests with changing spoofed X-Forwarded-For values consumed one bucket; the next returned 429. The actual Render proxy chain has not been observed. Visitors may share buckets behind a proxy; this conservatively reduces availability. |
| Runtime secrets | OPENAI_API_KEY is read only by server code; no provider/deployer key is needed for this deployment. No API-key label or credential signature was found in emitted JS. Vite exposes VITE_ configuration, so never use that prefix for secrets. No real credentials were read into the report or added to source. |
| Startup failures | Separate-process probes showed nonzero exit for an invalid PORT, invalid proxy configuration and an insecure Render fallback URL. Invalid/malformed origins fail during app creation. Missing key/disabled or unusable budget keeps AI unavailable while allowing the static app and comparison API. An absent origin denies Origin-bearing API calls but still permits originless health requests. |
| Validation/errors | Bounded JSON/upload/document/model schemas, deterministic comparison and generic errors remain in place. Smoke tests returned JSON 400/413/415 for malformed, oversized and unsupported requests. AI-disabled routes stop before document extraction/inference; tests of enabled behavior use mocks. |
| Tracing | Production JS has zero matches for `studio-trace-event`, `studio-console-log`, `__studioTrace`, `__studioPatched`, OPENAI_API_KEY or the test key placeholder. Studio link/provenance and v2 escrow address remain in the build. Capture imports remain DEV-only opt-in. |
| Wallet and testnet | Injected-wallet connector needs no WalletConnect project secret. Arc Testnet (5042002) is first in wagmi config; Ethereum mainnet is present for ENS, not an Arc Mainnet escrow. Existing chain/signer/simulation guards and buyer approval/hash wiring remain. No wallet or RPC test was executed here. |

The UI is still a **fixed testnet demo**: src/escrow.ts contains demo participants and Deal #1; CreateDeal uses fixed demo arguments, and release retains fixed signer/evidence guards. Some transaction reads follow the active wagmi chain rather than specifying a chain explicitly. Do not interpret the historical fresh-deal procedure as a verified general public onboarding workflow. With paid AI disabled, document analysis is disabled in the UI; deterministic `/api/compare` works with already structured synthetic documents. The full new-analysis-to-release flow is deliberately not demonstrated by this deployment.

Deal #1 remains documented as **RELEASED (status 4)**, with owner-confirmed transaction `0x1c538deb65c7333e29f7631788319729b326e5d20369a452f2f6d4fb1251ea64` and v2 escrow `0x7f1af92df34d8e58dba70688404de57276a42bc7`. No fresh chain query was made. Do not repeat TX6. Real AI integration remains unverified; Arc Mainnet is not deployed.

## Exact Render setup for the operator

Official Render documentation was consulted on the report date. These are instructions for a future approved, user-operated deployment; no service was created or inspected.

1. After approval, open Render **New → Web Service → Git Provider**. Connect GitHub and select `aquattdabackup/ArcTradeProof-AI`. Use branch `main` and leave Root Directory unset. Confirm the approved commit in deploy details. Creating the service launches the first build/deployment. [Web Service setup](https://render.com/docs/web-services)
2. Select the native **Node / JavaScript-TypeScript** runtime, using Bun for this app. Render supports both Node and Bun; no Dockerfile or Studio deploy command is needed. [Native runtimes](https://render.com/docs/native-runtimes)
3. Set build command to `bun --version && bun install --frozen-lockfile && bun run build`; start command to `bun run start`. Keep devDependencies installed. Set health path to `/api/health`; healthy HTTP status is 2xx/3xx. [Health checks](https://render.com/docs/health-checks)
4. Use one instance and the single app process. Choose the region and compute plan deliberately. A Free service is suitable only for this limited preview: it spins down after 15 minutes idle, has cold starts and cannot attach a persistent disk. Render does not recommend Free instances for production applications. Choose paid compute for production availability. [Free service limitations](https://render.com/docs/free)
5. Set Auto-Deploy to **Off** for this controlled rollout (Settings → Auto-Deploy). GitHub-connected services otherwise default to deploy on commit. This setting does not prevent the initial creation deploy. [Deployment controls](https://render.com/docs/deploys)

Configure the following before creating the service:

| Environment setting | First-deployment value/action |
|---|---|
| BUN_VERSION | `1.3.14` |
| NODE_ENV | `production` |
| AI_MAX_CALLS | `0` |
| TRUST_PROXY_HOPS | `0` |
| OPENAI_API_KEY | **Absent**; check attached environment groups too |
| AI_BUDGET_FILE | Absent; no disk required while AI is disabled |
| PORT | Do not override Render's supplied value, normally `10000` |
| PUBLIC_ORIGIN | Absent for the default onrender.com URL; do not create an empty entry |
| RENDER_EXTERNAL_URL | Automatically supplied by Render; do not manually replace it |
| ALLOWED_ORIGIN | Absent |
| VITE_STUDIO_DEBUG | Absent |
| Private keys / seed phrases / Studio deploy credentials | None required; do not configure them |

Render supports `.bun-version`; BUN_VERSION has higher precedence, so both should agree at 1.3.14. The explicit environment setting is for clarity, not a fix for an unsupported version file. [Bun version selection](https://render.com/docs/bun-version)

**PUBLIC_ORIGIN may safely remain absent for the default domain.** Render documents RENDER_EXTERNAL_URL as the full HTTPS onrender.com URL; the server validates it strictly. For a custom domain, explicitly set PUBLIC_ORIGIN to its exact HTTPS origin without a trailing slash. That override replaces the default origin; only add ALLOWED_ORIGIN if a second frontend origin is deliberately required. Blank PUBLIC_ORIGIN suppresses fallback. Do not loosen CORS. [Default environment variables](https://render.com/docs/environment-variables)

The actual public URL is **not yet assigned or verified**. Use the URL shown in the Render dashboard. Render terminates HTTPS at its load balancer and redirects HTTP to HTTPS; verify that behavior after deployment. [Public service access](https://render.com/docs/web-services)

## Persisted AI budget and remaining security risks

The state is a JSON integer at the absolute `AI_BUDGET_FILE` path in server/ai.ts. It is read and incremented synchronously via a temporary file and rename **before** provider invocation. Failed attempts count. Separate-process tests verify normal local restart persistence. Invalid/corrupt/unwritable state fails closed, but **a missing/deleted file starts at zero**. A disk loss or restoring an old snapshot can therefore recreate allowance. Atomic rename is not an fsync-backed crash-durability guarantee and does not coordinate multiple processes.

For a later, separately approved paid demo, attach a **paid persistent disk** mounted at `/var/data` and use `/var/data/arctradeproof/ai-calls.json`, outside dist. Only the mount's contents persist; the disk is runtime-only and supports one instance. Redeploys with a disk stop the old instance before the new one starts. None of this storage has been configured or verified for this project. [Persistent disk requirements](https://render.com/docs/disks)

Retain one process; adding workers would race reservations even on one disk. Before any paid enablement, verify retained counter state through actual restart/redeploy with synthetic reservations, review file-loss/backup recovery, and confirm writes are possible. Do not enable paid AI on ephemeral filesystem storage. For stronger durability or multiple instances, implement a durable transactional store (for example, a database transaction that atomically increments only below the cap), and fail closed on store errors. This alternative is not implemented; merely setting a database URL would do nothing.

Other limits remain:

- CORS is not authentication. Anonymous callers can exhaust shared request buckets and, if paid AI is enabled later, the entire finite allowance. Use an authenticated access layer before restricted paid judging. Do not place a shared secret in the browser.
- TRUST_PROXY_HOPS=0 remains conservative. Before changing it, verify the actual immediate peer and forwarded chain on the live service through controlled operator diagnostics, confirm which proxy overwrites/appends headers, and test two independent clients plus spoofed X-Forwarded-For input. Do not log tokens or document bodies. Neither Render's general edge description nor local one-hop tests establish the deployed hop count.
- In-memory request limits reset on restart and are per process. They are not a distributed quota. The allowance counts attempts, not exact dollars; two calls maximum, 2,500 output tokens, zero SDK retries and a 30-second abort bound remain. Cancellation can still incur provider charges.
- PDF parsing is not isolated in a worker with a hard CPU/memory deadline. In this zero-key mode extraction exits before parsing PDFs. Enabled-mode behavior uses synthetic local tests, not hostile-file fuzzing or live inference.
- Health can pass even if static assets or external RPCs are unavailable. Check both frontend and API after every deploy. Dependency PURE-comment warnings and the 1.4 MB frontend chunk remain; no performance or load test was done.
- Linux/Render native-module compatibility, public HTTPS, live proxy behavior, browser rendering and injected-wallet behavior are still unverified. No dependency vulnerability audit or historical Git-secret audit was claimed. Historical generated logs remain in earlier Git history.
- Compass/Arc Studio deployment tooling remains unverified because of the unavailable @circlefin/compass-chains dependency. It is outside the production app build and was preserved, not substituted or declared passed.

## Commands and evidence

All requested checks used **Bun 1.3.14**. Contract runner: **Forge 1.7.1**, existing Solidity 0.8.28 artifacts/configuration. Commands were launched with OPENAI_API_KEY empty and AI_MAX_CALLS=0; security tests use a nonfunctional placeholder and mocked provider calls. Logs and temporary local smoke/check scripts are ignored under `.runtime/`.

| Command | Actual result |
|---|---|
| `bun --version` | `1.3.14` |
| `bun install --frozen-lockfile` | Exit 0: `Checked 1028 installs across 1003 packages (no changes) [2.26s]` |
| `bun run test:all` | Exit 0: **91 pass, 0 fail, 205 expect() calls; Ran 91 tests across 3 files. [44.97s]** |
| `bun run contracts:test` | Exit 0: **61 tests passed, 0 failed, 0 skipped (61 total tests)**; suite 81.70ms; four fuzz cases with 256 runs each |
| `bun run lint:app` | Exit 0: `$ oxlint --type-aware src server vite.config.ts`; no diagnostics |
| `bun run typecheck:app` | Exit 0: `$ tsc --noEmit -p tsconfig.json`; no diagnostics |
| `bun run build` | Build subprocess exit 0: Vite 6.4.4, **built in 45.52s**; largest JS chunk 1,413.16 kB / gzip 425.04 kB; existing annotation and >500 kB warnings |
| `bun run start` | `$ NODE_ENV=production bun run server/index.ts`; `[ArcTradeProof API] Listening on port 10000` |
| Local HTTP/configuration smoke | **45 checks passed; 0 failed** using the production server and separate app/failed-start probes; no provider or chain calls |
| Production JS scan | Zero Studio capture markers, API-key label or test-placeholder matches; Studio provenance and v2 escrow marker retained |
| Source/config credential signature scan | No matches for provider/GitHub/AWS key signatures or PEM private-key headers in inspected app/tooling/docs; not an exhaustive secret audit |
| Git checks | `git diff --check` passes; index empty; only the three documentation paths above are changed/untracked |

The build itself passed. Its temporary Python log-printing wrapper subsequently returned 1 because Windows cp1252 could not print a box-drawing character from the already successful Vite output. The saved UTF-8 log was read directly and confirmed completion; this was not hidden as a successful wrapper execution. Build and Forge used sandbox escalation for local filesystem/tool access, with no deployment. No requested application/contract/lint/typecheck/build check failed.

HTTP evidence: `/`, emitted JS/CSS and a deep-link fallback returned 200; health returned disabled-AI JSON 200 with no-store/nosniff; both paid routes returned JSON 503 AI_NOT_CONFIGURED. Unknown `/api` paths returned JSON 404. Invalid/malformed comparisons returned 400, excessive body 413, unsupported/compressed bodies 415. Hostile Origin returned 403 without allow-origin; exact origin/preflight succeeded. Structured synthetic comparison returned 200 with an exact 0.000001 USDC discrepancy. Separate probes covered fallback/override/blank origin, spoofed forwarded headers at trust zero, health outside rate limits, and failed startup configurations.

**Browser testing was not performed.** HTTP serving does not prove rendering, wallet behavior or HTTPS hosting. Real AI inference was not performed and must not be described as working. No paid storage or other Render setting has been verified live.

## User-operated deployment checklist

- [ ] Review this report and the three documentation changes. Separately approve any commit/push and deployment; none are performed by this pre-flight.
- [ ] Confirm intended GitHub-connected repository, `main`, approved commit, runtime, frozen install/build, start command and health path. Do not invoke Compass, self-deploy or Foundry deployment scripts.
- [ ] Set the four explicit environment values above. Confirm no API key/private key/environment group enables inference, no local .env upload, no wildcard CORS and proxy trust remains zero.
- [ ] Review region, compute plan and billing limits. Keep one instance and Auto-Deploy Off. Click Create Web Service only when deployment is approved; that click launches deployment.
- [ ] Verify deploy logs show Bun 1.3.14, successful dependency install/build, detected PORT and a healthy service. Record the actual deployed SHA and HTTPS URL. Stop on errors; do not weaken CORS or proxy settings to clear them.
- [ ] Check HTTP redirects to HTTPS and the actual HTTPS root/assets load. Refresh a deep link; verify `/api/unknown` is JSON 404 rather than HTML. Inspect browser console/network without capturing documents or wallet data.
- [ ] Verify `/api/health` is 200 with aiReady false and model null; POST empty JSON to `/api/extract` and `/api/report` returns 503 AI_NOT_CONFIGURED. Verify the UI disables analysis. This is the expected successful zero-AI deployment state.
- [ ] From the real origin, verify POST `/api/compare` with `{}` returns JSON 400 (validation, not CORS rejection). From a test HTTP client, send an unrelated Origin and expect 403 without allow-origin. Keep within 20 POSTs/15 minutes; a 429 is not a reason to trust unverified proxies.
- [ ] Inspect wallet/network display without signing any transaction. Confirm Arc Testnet/v2 escrow context and do not repeat Deal #1 release. Do not present the fixed demo as a generalized fresh-deal workflow.
- [ ] Keep paid AI disabled after deployment. Storage, proxy verification, access controls and a separately approved real inference verification are future work. Mainnet remains pending.

Stop here for user review. No approval from an earlier stage authorizes the actions prohibited in this stage.
