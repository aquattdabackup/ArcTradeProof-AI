# ArcTradeProof AI

> AI-powered international trade escrow on Arc (USDC). Commercial documents → deterministic comparison → buyer-approved payment release.

## What It Does

Buyers and suppliers turn commercial agreements (POs, invoices) into verifiable USDC payment workflows. The AI layer (gpt-4o-mini) extracts and compares commercial terms and produces an advisory report. A deterministic comparison engine (BigInt arithmetic, zero floating-point) independently validates monetary fields. The buyer reviews both outputs, makes an explicit approval decision, and signs a single transaction that releases USDC from the escrow contract.

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

In **production**: Express serves the compiled SPA from `dist/` AND handles `/api/*` on the same port and origin. No Vite proxy, no CORS required.

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
bun run test:all        # 63 tests: 36 comparison + 27 store/hash
bun run test:server     # comparison engine only (36 tests)
bun run test:store      # deal review store and hash tests (27 tests)
```

### Lint + Typecheck

```bash
bun run check           # oxlint + tsc --noEmit
```

### Production Build (local verification)

```bash
bun run build           # vite build → dist/
NODE_ENV=production bun run start
# → http://localhost:3001 serves the full app
```

---

## Deployment: Render (recommended)

Render runs the Express backend and serves the compiled SPA from a single Web Service. One URL, no cross-origin issues, no separate static host.

### Step 1 — Push to GitHub

```bash
git init          # if not already a git repo
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Make sure `.gitignore` excludes `.env`, `dist/`, `node_modules/`, and `.circle/` (it does by default in this project).

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

> Render auto-detects Bun from `.bun-version`. If it does not, set the environment variable `BUN_VERSION=1.3.14`.

### Step 3 — Set Environment Variables

In the Render dashboard → your service → **Environment** tab, add:

| Key | Value | Notes |
|---|---|---|
| `OPENAI_API_KEY` | `sk-…` | Required for AI features. Add as a **Secret** — Render will not expose it in logs. |
| `NODE_ENV` | `production` | Required. Enables `express.static(dist/)` and SPA fallback routing. |
| `PORT` | _(leave blank)_ | Render sets this automatically. The server reads `process.env.PORT`. |
| `ALLOWED_ORIGIN` | _(leave blank)_ | Not needed when SPA and API share the same Render URL. |

> **Never** paste your `OPENAI_API_KEY` in chat, source code, comments, or commit messages.

### Step 4 — Deploy

Click **Deploy** (or push to `main` — Render auto-deploys on push by default).

Build log will show:
```
==> Running build command: bun install && bun run build
==> Build succeeded
==> Starting service: bun run start
[ArcTradeProof API] Listening on port 10000
[ArcTradeProof API] AI ready: true
[ArcTradeProof API] Mode: production (serving dist/)
```

### Step 5 — Verify

```bash
curl https://your-app.onrender.com/api/health
# {"status":"ok","aiReady":true,"model":"gpt-4o-mini",...}
```

Open `https://your-app.onrender.com` in the browser — the full SPA loads.

---

## Smart Contract

### Deployed Addresses

| Network | Address | Tx Hash |
|---|---|---|
| Arc Testnet (v1 — superseded) | `0xc97f09fbb33ee61442145aec710818e79aab8c7c` | `0x551feb06ad5d4e2c1fade7910b99e14beaca44bdd320a1fe8c0de95950c261e9` |
| Arc Testnet (v2 — production) | `0x7f1af92df34d8e58dba70688404de57276a42bc7` | `0x6c4769659da5d75656718d69bff8ab4f986c013339f8f5182dfd100624a2a740` |
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

Deal #1 on Arc Testnet is in **`EVIDENCE_SUBMITTED` (status 3)** — TX5 (submitEvidence) was executed; TX6 (approveAndRelease) has not yet been signed.

**The deal has NOT been released and is NOT reusable** once released (status moves to `RELEASED` permanently).

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

| Control | Implementation |
|---|---|
| Rate limiting | 20 requests / 15 minutes / IP (`express-rate-limit`) |
| Body size cap | 1.5 MB per request |
| Document text cap | 12,000 characters per LLM call |
| File type allowlist | PDF, plain text, CSV only |
| Timeout | 30 seconds per AI call |
| API key absent | HTTP 503 with `AI_NOT_CONFIGURED` — no fallback, no mock |
| Error responses | Never expose stack traces, API errors, or key fragments |
| Key in response | Never — health endpoint returns boolean `aiReady` only |
| Key in frontend bundle | Never — all AI calls are server-side |

**Additional spend controls to add before high-traffic production use:**
- Set a monthly spend cap in your OpenAI account dashboard.
- Add `x-forwarded-for` trust configuration if behind a load balancer (so rate limiting applies to real client IPs, not the proxy IP).
- Consider a Cloudflare WAF rule or API gateway for DDoS protection.

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
    compare.test.ts           36 unit tests

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
- [ ] Stage 6: Real USDC demo with live AI extraction on testnet
