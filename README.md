# ArcTradeProof AI

> Built with Arc Studio for the Arc Microgrants: Built with Arc Studio competition.

> AI-powered international trade escrow on Arc (USDC). Commercial documents → deterministic comparison → buyer-approved payment release.

## What It Does

Buyers and suppliers turn commercial agreements (POs, invoices) into verifiable USDC payment workflows. The AI layer (gpt-4o-mini) extracts and compares commercial terms and produces an advisory report. A deterministic comparison engine (BigInt arithmetic, zero floating-point) independently validates monetary fields. The buyer reviews both outputs, makes an explicit approval decision, and signs a single transaction that releases USDC from the escrow contract.

**Prototype, not an audited production trade-finance service. Mainnet deployment is not completed. Real AI inference has not yet been verified. AI cannot verify physical shipment or delivery.**

**The AI is advisory only. It cannot sign transactions, access private keys, or release funds.**

---

## Architecture

```
Browser SPA (Vite static output + React/wagmi/ConnectKit)
    └─ /api/*  ──→  Express Node Function (Vercel)
                        ├─ /api/extract   OpenAI gpt-4o-mini extraction
                        ├─ /api/compare   Deterministic BigInt comparison (no AI)
                        ├─ /api/report    OpenAI gpt-4o-mini advisory narrative
                        └─ /api/health    Liveness probe
    └─ wallet writes  → MetaMask → Arc Testnet (current escrow)
                            └─ ArcTradeProofEscrow.sol
```

In **development**: Vite serves the SPA on port 5173 and proxies `/api/*` to the Express backend on port 3001.

In **Vercel production**: the platform serves Vite's `dist/` assets; `api/index.ts` runs the Express API as a Node Function under the same HTTPS origin. No production Vite proxy or Express static asset serving. `bun run start` retains the standalone combined server for local checks. Origin-bearing API requests must match the exact configured origin or its documented platform fallback.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS |
| Web3 | wagmi v2, viem v2, ConnectKit |
| Smart contract | Solidity ^0.8.20, Foundry |
| Backend | Express 5; Vercel Node 24.x; local Bun 1.3.14 tooling |
| AI | OpenAI gpt-4o-mini via `@ai-sdk/openai` |
| Chain | Arc Testnet (5042002) / Arc Mainnet (5042) |
| Token | USDC ERC-20, 6 decimals |

---

## Local Development

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.14 (version pinned in `.bun-version`)
- [Foundry](https://book.getfoundry.sh) (for contract work only)
- An OpenAI API key (for AI extraction; app runs without it — AI features show `AI ready: false`)

### Setup

```bash
git clone <your-repo>
cd arctradeproof-ai
bun install
```

Copy `.env.example` to `.env` for local configuration. Keep paid AI disabled for the first deployment:

```bash
cp .env.example .env
# Keep AI_MAX_CALLS=0 and OPENAI_API_KEY empty; never commit .env
```

### Run (two terminals)

Terminal 1 — Express backend:
```bash
bun run server
# Listening on port 3001
```

Terminal 2 — Vite frontend:
```bash
bun run dev
# http://localhost:5173
```

The Vite dev server proxies `/api/*` → `http://localhost:3001/api/*` automatically.

### Test

```bash
bun run test:all        # comparison, store/hash and security regression tests
bun run test:server     # comparison engine only (47 tests)
bun run test:store      # deal review store and hash tests (27 tests)
```

### Application and Studio tooling checks

```bash
bun run lint:app        # type-aware lint: src/, server/, api/, vite.config.ts
bun run typecheck:app   # strict TypeScript check of the same application scope
bun run lint           # alias for lint:app
bun run typecheck      # alias for typecheck:app
```

`tsconfig.json` retains `strict: true` and all previous compiler safety settings. It checks the production frontend/backend, the Vercel Function entry, their tests, and Vite configuration. Studio deployment scripts have a separate `scripts/tsconfig.json` with the same strict settings and explicit Node/Bun types:

```bash
bun run lint:studio
bun run typecheck:studio
bun run check:studio    # both, stops on the first failure
```

**Compass deployment tooling remains unverified outside Arc Studio.** `scripts/compass-deploy.ts` requires `@circlefin/compass-chains` (absent from this repository's dependencies; public npm lookup returned 404 during Stage 5.2), other dynamically loaded Compass packages, `/home/user/app` and Studio RPC settings. The related self-deploy helper also expects Studio-injected chain facts. This is evidence of a Studio-specific environment dependency, not a production app dependency. Neither the frontend/backend nor Vite imports these deployment helpers. No substitute package, declaration stub, compiler suppression or deployment-source deletion was introduced. The explicit Studio checks still fail on the unavailable package; application checks do not validate deployment tooling. See [Stage 5.3 verification](docs/stage5.3-report.md).

### Production Build (local verification)

```bash
bun run build           # vite build → dist/
NODE_ENV=production bun run start
# → http://localhost:3001 serves the full app
```

---

## Deployment: Vercel (selected platform)

**Initial mode: zero paid AI.** Keep `AI_MAX_CALLS=0`, leave `OPENAI_API_KEY` absent, and do not perform blockchain transactions for deployment verification. Implementation and local tests are complete; no Vercel deployment or public browser/wallet verification has been performed. See [the Stage 5.4B report](docs/stage5.4b-vercel-report.md) for exact evidence, limitations and the user-operated checklist.

### Hosting and routing

Use one GitHub-connected Vercel project with the **Vite** preset. `bun run build` produces `dist/`, which Vercel serves as static content. `api/index.ts` exports the existing Express API as a Node Function with static serving disabled; it does not open a listener. `vercel.json` routes `/api` and `/api/*` to that Function, while the SPA fallback explicitly excludes those paths. Existing static files take precedence over rewrites. Unknown API routes remain JSON 404 responses. Do not add a blanket SPA rewrite that swallows the API. [Vite deployment](https://vercel.com/docs/frameworks/frontend/vite), [routing configuration](https://vercel.com/docs/project-configuration/vercel-json)

Vercel's Express support does not serve assets through `express.static()`. We use Vite's output-directory hosting rather than the standalone Express preset/public-directory model. The standalone `bun run start` command is retained for local verification and is not the Vercel start command. [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

### Dashboard settings after separate deployment approval

| Setting | Value |
|---|---|
| Git repository | `aquattdabackup/ArcTradeProof-AI` via the GitHub integration |
| Production branch | `main`; verify the approved commit |
| Root Directory | Repository root |
| Framework Preset | **Vite**, not Express |
| Node.js Version | **24.x**, also specified in package.json |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output Directory | `dist` |
| Function | `api/index.ts`; maximum duration **60 seconds** in vercel.json |
| Start command / PORT | None; Vercel invokes the Function |

Node 24.x was selected and the transpiled API was exercised locally on Node 24.19.0. Vercel manages patch versions. Bun 1.3.14 remains the local test/install baseline; it is not a Vercel runtime pin. The current beta Bun runtime accepts `bunVersion: "1.x"` or `"1.4.x"`, not an exact patch. This project does not set bunVersion. [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Bun runtime](https://vercel.com/docs/functions/runtimes/bun)

### Environment reference

Configure Production and Preview deliberately; no secrets belong in VITE_ variables or source.

| Variable | Required action |
|---|---|
| `NODE_ENV` | `production` for deployed builds/runtime |
| `AI_MAX_CALLS` | `0` in both environments |
| `OPENAI_API_KEY` | **Absent**, including shared/integration-supplied variables |
| `AI_BUDGET_FILE` | **Absent** on Vercel; `/tmp` is not a budget store |
| `NODEJS_HELPERS` | **`0`**, at build and runtime, so Express owns body parsing and JSON errors |
| `PUBLIC_ORIGIN` | Production: exact stable HTTPS project/custom-domain origin, no trailing slash |
| `PUBLIC_ORIGIN` in Preview | Leave absent to accept only `https://VERCEL_URL`, or explicitly set the exact preview origin |
| `ALLOWED_ORIGIN` | Leave absent unless a second exact origin is deliberately needed |
| `TRUST_PROXY_HOPS` | `0`; live Vercel proxy behavior is not yet verified |
| `VERCEL`, `VERCEL_URL` | Platform-provided; enable automatic system environment variables, do not fabricate values in Dashboard |
| `VITE_STUDIO_DEBUG`, deployment private keys | Leave absent |

The generated deployment hostname in VERCEL_URL has no scheme. The API prepends HTTPS and validates the exact origin; it never trusts the request Host or forwarded-host header for CORS. Preview aliases are not automatically allowed. PUBLIC_ORIGIN overrides the fallback, and an explicit blank value denies Origin-bearing requests. Use the generated deployment URL for Preview, and set the stable production origin before promoting a deployment. [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

Set NODEJS_HELPERS=0 for both environments before building; environment changes require a new deployment to affect its build/runtime. No CLI login, environment pull, project linking or deployment was performed during this task. [Node helper configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration), [environment variables](https://vercel.com/docs/environment-variables)

### Verify the actual public HTTPS URL after approval

The operator must verify root/JS/CSS/deep-link loading, health JSON, structured comparison, unknown API JSON 404 and CORS on the deployed URL. Expect `/api/health` to return 200 with `aiReady: false`, `model: null`; POST empty JSON to `/api/extract` and `/api/report` should return 503 `AI_NOT_CONFIGURED`. The UI should display AI unavailable and disable analysis. A 200 health response is not proof of inference, browser rendering or wallet behavior. Review deployment protection/public access so judges can reach the intended URL without your account, while retaining deliberate access controls.

### Future paid AI is blocked pending a separate design

When `VERCEL=1`, server/ai.ts rejects the file-budget mechanism even if a key and positive allowance are configured. Do not remove that guard or put a budget in `/tmp`. Vercel Function filesystems and instance memory are not shared durable quotas. Current request and concurrency limits apply per instance only; they reset and multiply across instances. Future paid AI requires authenticated users, shared atomic budget reservations, distributed concurrency enforcement and failure/retry tests before separate enablement approval. [Function runtime/filesystem](https://vercel.com/docs/functions/runtimes), [concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling)

Render is **no longer the selected deployment path**. The [Stage 5.4A Render report](docs/stage5.4a-report.md) is preserved unchanged as historical evidence, not the current setup instructions.

---

## Smart Contract

### Deployed Addresses

| Network | Address | Tx Hash |
|---|---|---|
| Arc Testnet (v1 — superseded) | `0xc97f09fbb33ee61442145aec710818e79aab8c7c` | `0x551feb06ad5d4e2c1fade7910b99e14beaca44bdd320a1fe8c0de95950c261e9` |
| Arc Testnet (v2 — current demo) | `0x7f1af92df34d8e58dba70688404de57276a42bc7` | `0x6c4769659da5d75656718d69bff8ab4f986c013339f8f5182dfd100624a2a740` |
| Arc Mainnet | _(not yet deployed)_ | — |

### State Machine

```
CREATED(0) → ACCEPTED(1) → FUNDED(2) → EVIDENCE_SUBMITTED(3) → RELEASED(4)
FUNDED(2) or EVIDENCE_SUBMITTED(3) → REFUNDED(5) [after expiration]
```

### Demo Safety Limits (hardcoded constants, not admin-settable)

- `MAX_AMOUNT_PER_DEAL`: 5,000,000 base units (5 USDC)
- `MAX_TOTAL_ESCROW`: 20,000,000 base units (20 USDC)
- Maximum deadline: 7 days

### Build and Test

```bash
bun run contracts:build   # forge build
bun run contracts:test    # forge test — 61 tests
```

---

## Testnet Demo — Deal Status and Fresh Deal Procedure

### Completed Demo Deal (Deal #1)

Deal #1 is **RELEASED (4)**. TX6 succeeded and released **0.25 TESTNET USDC** to the seller, as confirmed by the project owner:

`0x1c538deb65c7333e29f7631788319729b326e5d20369a452f2f6d4fb1251ea64`

**Do not execute TX6 again for Deal #1.** The completed deal is not reusable. This is a testnet result, not a mainnet or real-money settlement. Real AI inference remains unverified.

To verify Deal #1 status live:
```
Contract: 0x7f1af92df34d8e58dba70688404de57276a42bc7
Function: getDealStatus(1)
```

### How to Create a Fresh Testnet Deal

The sequence below describes the intended testnet flow, not a verified general-purpose onboarding UI. The current frontend retains fixed demo participants, amounts and evidence guards in several transaction steps. The first public deployment also disables AI analysis. A fresh end-to-end workflow requires separate verification and approval; do not use it as a deployment smoke test.

1. **Get testnet USDC.** Use the "Get test USDC" button in Arc Studio sidebar, or the [Arc Testnet faucet](https://faucet.testnet.arc.io).

2. **Connect Wallet A (Buyer)** in MetaMask on Arc Testnet (Chain ID 5042002).

3. In the app's **Escrow Demo** tab → **Step 1 (Create)**, enter:
   - Seller address (Wallet B)
   - Amount in USDC (max 5 USDC for testnet demo)
   - A `termsHash` (keccak256 of your terms document or a synthetic test string)
   - Deadline (1–7 days from now)
   - Confirm in MetaMask → note the new `dealId` from the transaction receipt

4. Switch to **Wallet B (Seller)** → Step 2 (Accept) → confirm.

5. Switch back to **Wallet A** → Step 3 (Approve USDC) → Step 4 (Fund) → confirm.

6. Switch to **Wallet B** → Step 5 (Submit Evidence) → confirm.

7. Go to **AI Document Intelligence** tab → upload PO and invoice → run extraction → bind to your new `dealId`.

8. Go to **Buyer Review** tab → review AI output → click **Approve**.

9. Go to **Escrow Demo → Step 6 (Release)** → confirm the dynamic `reviewHash` matches what you approved → click **Approve & Release** → confirm in MetaMask.

---

## AI Endpoint Abuse Protection

- AI is disabled by default (`AI_MAX_CALLS=0`). On Vercel, file-based allowances are additionally rejected; no environment-only change can safely enable paid judging. The following retained file-budget details apply only to a standalone single-process server, not Vercel.
- One shared, finite allowance covers extraction and report calls across visitors. Each attempt is persisted **before** calling OpenAI, including failures. Normal process restarts using the same file preserve usage (verified with separate local processes). No automatic reset. Increasing AI_MAX_CALLS increases the lifetime allowance (maximum 300); deleting the budget file resets it and must be treated as an explicit operator action.
- **Historical standalone/Render option only:** retained storage was never configured or verified. A persistent mount would be required for that single-process file budget. This is not the selected Vercel design; follow the shared-store requirements above for Vercel.
- Run exactly **one process and one instance**. Atomic file replacement protects against partial writes, not competing processes. Multiple replicas require a shared transactional store before enabling paid AI. Ephemeral storage loses the limit on redeploy; use a persistent disk. The zero-key demo can run without a disk.
- At most 2 concurrent AI calls, 2,500 output tokens each, no automatic retries, and a 30-second abort signal. A canceled or failed call may still be billed by the provider.
- Public POST routes share 20 requests per 15 minutes per client IP (including IPv6 subnet grouping), before JSON parsing. This limits requests, not just successful inference. Test the configured reverse proxy hop count against the live host; a local simulation cannot prove provider topology.
- JSON body limit 1.5 MB; compressed bodies rejected. Files limited to 1,000,000 decoded bytes; base64 syntax and file types validated. PDFs must have at most 10 pages. Text and report prompts are limited to 12,000 characters; oversized content is rejected rather than silently truncated.
- All document inputs and model outputs pass bounded Zod schemas. Report comparisons are recomputed from validated documents; client-supplied comparison results are ignored. Monetary parsing uses BigInt and rejects malformed, negative or overly precise amounts.
- Errors return generic JSON without raw provider/parser errors or document contents. No raw exceptions are logged. Health reports configuration status only.
- CORS fails closed. CORS is a browser policy, **not authentication**: anonymous command-line callers can spend the bounded allowance. They can exhaust it and deny access to judges. For restricted judging, place an authenticated gateway in front of AI routes or the service; never embed a shared secret in the SPA.
- Studio capture is opt-in in development with `VITE_STUDIO_DEBUG=true`; both import paths are removed by Vite in production. Use only synthetic documents when enabling capture.

For the initial Vercel preview, the SPA remains accessible, AI routes return JSON 503, and deterministic `/api/compare` remains available for structured documents. Analysis is disabled. Future paid judging requires the durable-store/authentication work described in the report and an owner-verified real inference session.

Proxy guidance: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html). Host-specific verification remains pending. PDF API: [pdf-parse v2](https://github.com/mehmet-kozan/pdf-parse).

---

## Security Properties

- AI is strictly advisory. It cannot sign transactions, access private keys, or authorize payment.
- `buyerDecision` in the frontend store can only become `'approved'` by an explicit button click. A MATCH result from the AI never auto-approves.
- The `reviewHash` passed to `approveAndRelease` is computed client-side from the full review package JSON (keccak256 of canonical sorted-key serialisation). It is never hardcoded, never provided by the server.
- A belt-and-suspenders calldata check verifies that the hash shown to the buyer equals the hash encoded in the `useSimulateContract` request before the submit button is enabled.
- `OPENAI_API_KEY` is server-side only. It is never referenced in any `src/` file, never in `import.meta.env`, and never in the built `dist/` bundle.
- The Solidity contract enforces all state transitions on-chain: only the `deal.buyer` can call `approveAndRelease`, and only when `status === EVIDENCE_SUBMITTED`.

---

## Project Structure

```
contracts/
  ArcTradeProofEscrow.sol     Core escrow contract
  test/
    ArcTradeProofEscrow.t.sol 61 Foundry tests

server/
  index.ts                    Express server (PORT, CORS, rate limit, static SPA serving)
  ai.ts                       OpenAI provider (key from process.env only)
  types.ts                    Shared TypeScript types
  routes/
    extract.ts                POST /api/extract
    compare.ts                POST /api/compare
    report.ts                 POST /api/report
  lib/
    pdfExtract.ts             pdf-parse wrapper
    compare.ts                Deterministic BigInt comparison engine
    compare.test.ts           47 unit tests

api/
  index.ts                    Vercel Node Function, exports Express API only
vercel.json                   Vite output, API routing and SPA fallback

src/
  App.tsx                     Root — tab navigation + DealReviewProvider
  escrow.ts                   Contract constants, ABI, helpers
  config.ts                   wagmi config (Arc Testnet + mainnet)
  store/
    dealReviewStore.tsx       AI↔Escrow bridge context
    dealReviewStore.test.ts   27 integration tests
  lib/
    apiClient.ts              Frontend API client (/api/* relative paths)
    reviewHash.ts             keccak256 hash of canonical review package
    demoDocs.ts               Synthetic test documents
  components/
    WalletHeader.tsx          ConnectKit, USDC balance, chain pill
    AiDocIntelligence.tsx     Upload, extract, compare, report, bind to deal
    BuyerReview.tsx           Explicit approve/reject gate
    ApproveAndRelease.tsx     TX6 — dynamic hash from store
    CreateDeal.tsx            TX1
    AcceptDeal.tsx            TX2
    ApproveUsdc.tsx           TX3
    FundDeal.tsx              TX4
    SubmitEvidence.tsx        TX5
```

---

## Build Stages

- [x] Stage 1: Smart contract (compiled, hardened, security review)
- [x] Stage 2: Tests and security review (61/61 Foundry tests, Slither clean, deployed to Arc Testnet)
- [x] Stage 3: Frontend and wallet integration (TX1–TX5 executed on testnet)
- [x] Stage 4: AI document verification (63/63 tests, production build clean)
- [x] Stage 5: Production deployment preparation (this stage)
- [x] Stage 6 transaction: Deal #1 released 0.25 TESTNET USDC (TX6 complete; do not repeat)
- [ ] Stage 6 AI verification: real inference still unverified
- [ ] Mainnet deployment: not completed
