# ArcTradeProof AI

> Built with Arc Studio — From commercial documents to programmable USDC settlement.

## What This App Does

AI-powered trade settlement app. Buyers and suppliers turn commercial agreements into verifiable USDC payment workflows. AI extracts and compares commercial terms (advisory only). The smart contract enforces escrow, state transitions, and payment authorization — only the buyer can release funds.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity ^0.8.20 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002) / Arc Mainnet (Chain ID: 5042)
- Token: USDC ERC-20, 6 decimals (Address: 0x3600000000000000000000000000000000000000)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)
- `contracts/ArcTradeProofEscrow.sol` - Core escrow contract

## Smart Contract: ArcTradeProofEscrow

### State Machine
CREATED -> ACCEPTED -> FUNDED -> EVIDENCE_SUBMITTED -> RELEASED
FUNDED | EVIDENCE_SUBMITTED -> REFUNDED (after expiration)

### Demo Safety Limits (hardcoded constants, not admin-settable)
- MAX_AMOUNT_PER_DEAL: 5_000_000 (5 USDC)
- MAX_TOTAL_ESCROW: 20_000_000 (20 USDC)

### Constructor Argument
- `usdcAddress`: 0x3600000000000000000000000000000000000000

### Deployments
| Network | Address | Tx Hash |
|---------|---------|---------|
| Arc Testnet (v1 — superseded) | 0xc97f09fbb33ee61442145aec710818e79aab8c7c | 0x551feb06ad5d4e2c1fade7910b99e14beaca44bdd320a1fe8c0de95950c261e9 |
| Arc Testnet (v2 — FINAL, use this) | 0x7f1af92df34d8e58dba70688404de57276a42bc7 | 0x6c4769659da5d75656718d69bff8ab4f986c013339f8f5182dfd100624a2a740 |
| Arc Mainnet | (not yet deployed) | — |

## Build Stages
- [x] Stage 1: Smart contract — COMPLETE (compiled clean, security review clean, hardening pass complete)
- [x] Stage 2: Tests and security review — COMPLETE (61/61 tests pass, Slither clean, max review clean, deployed to Arc Testnet)
- [x] Stage 3: Frontend and wallet integration — COMPLETE (TX1–TX5 executed on Arc Testnet)
- [x] Stage 4: AI document verification — COMPLETE (63/63 tests pass, Stage 4.2 dynamic reviewHash flow complete)
- [x] Stage 5: Production deployment preparation — COMPLETE (see docs/stage5-report.md)
- [ ] Stage 6: Real USDC demo — TX6 (approveAndRelease) + live AI extraction on testnet

## Stage 5 — Production Readiness (completed)
- Fixed critical /api prefix bug: Express routes now at /api/* (not /) to match apiClient.ts
- Removed Vite proxy path rewrite (no longer needed)
- Added `build` and `start` scripts to package.json
  - build: vite build
  - start: NODE_ENV=production bun run server/index.ts
- Created .gitignore (was missing)
- Created .env.example with all required variable names
- Written production README with exact Render deployment instructions
- Deployment: Render Web Service, single origin, bun install && bun run build / bun run start
- Health check path: /api/health
- Required env var at runtime: OPENAI_API_KEY (set in Render dashboard as Secret)
- 63/63 tests pass, 0 lint warnings, 0 TS errors, production build succeeded

## To Run

```bash
bun install
bun run dev
```
