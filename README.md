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
Browser SPA (React + wagmi + ConnectKit)
    └─ /api/*  ──→  Express server (Bun)
                        ├─ /api/extract   OpenAI gpt-4o-mini extraction
                        ├─ /api/compare   Deterministic BigInt comparison (no AI)
                        ├─ /api/report    OpenAI gpt-4o-mini advisory narrative
                        └─ /api/health    Liveness probe
    └─ wallet writes  → MetaMask → Arc Testnet / Arc Mainnet
                            └─ ArcTradeProofEscrow.sol
```

In **development**: Vite serves the SPA on port 5173 and proxies `/api/*` to the Express backend on port 3001.

In **production**: Express serves the compiled SPA from `dist/` AND handles `/api/*` on the same port and origin. No Vite proxy. Requests carrying an Origin header must match PUBLIC_ORIGIN (or Render's RENDER_EXTERNAL_URL), or the explicitly configured ALLOWED_ORIGIN. With no origin configured, such requests are denied.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS |
| Web3 | wagmi v2, viem v2, ConnectKit |
| Smart contract | Solidity ^0.8.20, Foundry |
| Backend | Express 5, Bun 1.3.14 |
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

Copy `.env.example` to `.env` and fill in your `OPENAI_API_KEY`:

```bash
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY
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
bun run lint:app        # type-aware lint: src/, server/, vite.config.ts
bun run typecheck:app   # strict TypeScript check of the same application scope
bun run lint           # alias for lint:app
bun run typecheck      # alias for typecheck:app
```

`tsconfig.json` retains `strict: true` and all previous compiler safety settings. It checks the production frontend/backend, their tests, and Vite configuration. Studio deployment scripts have a separate `scripts/tsconfig.json` with the same strict settings and explicit Node/Bun types:

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

## Deployment: Render (recommended)

Render runs the Express backend and serves the compiled SPA from a single Web Service. One URL, no cross-origin issues, no separate static host.

### Step 1 - Review the existing repository

Use the existing [ArcTradeProof-AI repository](https://github.com/aquattdabackup/ArcTradeProof-AI). Review changes and verification results before committing or pushing. Do not reinitialize Git.

The ignore rules exclude `.env`, `dist/`, `node_modules/`, `.circle/`, local runtime files, `console.jsonl` and `traces.jsonl`. Removing tracked logs in a new commit **does not remove earlier history**.

### Step 2 — Create a Render Web Service

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repository
3. Configure:

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Region** | Oregon (US West) or nearest |
| **Build Command** | `bun install && bun run build` |
| **Start Command** | `bun run start` |
| **Health Check Path** | `/api/health` |

> Ensure Bun is available during build/start; the project pins 1.3.14 in `.bun-version`. Verify the hosting runtime during deployment.

### Step 3 — Set Environment Variables

In the Render dashboard → your service → **Environment** tab, add:

| Key | Value | Notes |
|---|---|---|
| `OPENAI_API_KEY` | _(server secret)_ | Required for AI features. Never use a VITE_ prefix. |
| `NODE_ENV` | `production` | Required. Enables `express.static(dist/)` and SPA fallback routing. |
| `PORT` | _(leave blank)_ | Render sets this automatically. The server reads `process.env.PORT`. |
| `PUBLIC_ORIGIN` | `https://your-app.onrender.com` | Exact origin, no trailing slash. Defaults to RENDER_EXTERNAL_URL on Render. Set explicitly for a custom domain. |
| `ALLOWED_ORIGIN` | _(leave blank)_ | Optional one additional exact HTTPS frontend origin. Never `*`. |
| `TRUST_PROXY_HOPS` | `1` | For one trusted reverse proxy hop only; verify actual Render topology before enabling AI. Never set trust proxy to true. |
| `AI_MAX_CALLS` | `60` | Explicit opt-in total allowance, 1-300. Default 0 disables AI. Two extractions and one report normally cost 3 attempts. |
| `AI_BUDGET_FILE` | `/var/data/arctradeproof/ai-calls.json` | Absolute path on a Render persistent disk. One instance/process only. Keep outside dist/. |

> **Never** paste your `OPENAI_API_KEY` in chat, source code, comments, or commit messages.

### Step 4 — Deploy

Click **Deploy** (or push to `main` — Render auto-deploys on push by default).

Build log will show:
```
==> Running build command: bun install && bun run build
==> Build succeeded
==> Starting service: bun run start
[ArcTradeProof API] Listening on port 10000
```

### Step 5 — Verify

```bash
curl https://your-app.onrender.com/api/health
# {"status":"ok","aiReady":true,"model":"gpt-4o-mini",...}
# aiReady means configured with remaining allowance; it does not verify real inference.
```

Open `https://your-app.onrender.com` in the browser — the full SPA loads.

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

- AI is disabled by default (`AI_MAX_CALLS=0`), even if a server key exists. Configure an allowance and a persistent budget path to enable the judging demo.
- One shared, finite allowance covers extraction and report calls across visitors. Each attempt is persisted **before** calling OpenAI, including failures. Normal process restarts using the same file preserve usage (verified with separate local processes). No automatic reset. Increasing AI_MAX_CALLS increases the lifetime allowance (maximum 300); deleting the budget file resets it and must be treated as an explicit operator action.
- **Render persistence is not configured or verified by this repository or this review.** Before enabling paid AI, attach a persistent disk and point AI_BUDGET_FILE inside its mount. The example path alone does not provision storage.
- Run exactly **one process and one instance**. Atomic file replacement protects against partial writes, not competing processes. Multiple replicas require a shared transactional store before enabling paid AI. Ephemeral storage loses the limit on redeploy; use a persistent disk. The zero-key demo can run without a disk.
- At most 2 concurrent AI calls, 2,500 output tokens each, no automatic retries, and a 30-second abort signal. A canceled or failed call may still be billed by the provider.
- Public POST routes share 20 requests per 15 minutes per client IP (including IPv6 subnet grouping), before JSON parsing. This limits requests, not just successful inference. Test the configured reverse proxy hop count against the live host; a local simulation cannot prove provider topology.
- JSON body limit 1.5 MB; compressed bodies rejected. Files limited to 1,000,000 decoded bytes; base64 syntax and file types validated. PDFs must have at most 10 pages. Text and report prompts are limited to 12,000 characters; oversized content is rejected rather than silently truncated.
- All document inputs and model outputs pass bounded Zod schemas. Report comparisons are recomputed from validated documents; client-supplied comparison results are ignored. Monetary parsing uses BigInt and rejects malformed, negative or overly precise amounts.
- Errors return generic JSON without raw provider/parser errors or document contents. No raw exceptions are logged. Health reports configuration status only.
- CORS fails closed. CORS is a browser policy, **not authentication**: anonymous command-line callers can spend the bounded allowance. They can exhaust it and deny access to judges. For restricted judging, place an authenticated gateway in front of AI routes or the service; never embed a shared secret in the SPA.
- Studio capture is opt-in in development with `VITE_STUDIO_DEBUG=true`; both import paths are removed by Vite in production. Use only synthetic documents when enabling capture.

For judging: open the SPA, load the provided synthetic PO/invoice files, run analysis, and inspect the advisory results. No login is needed with the allowance enabled. Without a server key the UI remains accessible, AI routes return JSON 503, and deterministic `/api/compare` remains available. A real inference session must still be verified by the owner.

Proxy guidance: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html), [Render edge protection and client IP guidance](https://render.com/articles/how-render-handles-ddos-attacks). PDF API: [pdf-parse v2](https://github.com/mehmet-kozan/pdf-parse).

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
