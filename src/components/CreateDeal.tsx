import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt,
         useSimulateContract, useSwitchChain } from 'wagmi'
import { decodeEventLog, type Log } from 'viem'
import { ShieldCheck, AlertTriangle, ExternalLink, Loader2, CheckCircle2, Info } from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID, ESCROW_ADDRESS,
  DEMO_SELLER, DEMO_BUYER, DEMO_AMOUNT, DEMO_TERMS_HASH,
  ESCROW_ABI, DEAL_STATUS_LABELS,
} from '@/escrow'
import { buildTxExplorerUrl } from '@/onchain-facts'

// ── helpers ────────────────────────────────────────────────────────────────

function truncate(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function nowPlus24h(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 86_400)
}

function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001'))
    return 'Transaction cancelled — no funds moved.'
  if (msg.includes('invaliddeadline'))
    return 'Deadline expired. Reload the page to generate a fresh 24-hour window.'
  if (msg.includes('invalidstate'))
    return 'Deal is in the wrong state for this action.'
  if (msg.includes('escrowlimitexceeded'))
    return 'Demo aggregate escrow limit reached (20 USDC). Try again after an existing deal expires.'
  if (msg.includes('insufficient'))
    return 'Insufficient USDC balance or allowance.'
  if (msg.includes('reverted'))
    return 'Transaction reverted. Check that you are using the correct signer.'
  return 'Transaction failed — check the browser console for details.'
}

// ── status chip ────────────────────────────────────────────────────────────

function StatusStep({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-xs transition-colors ${
      done ? 'text-emerald-400' : active ? 'text-white' : 'text-white/30'
    }`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 ${
        done
          ? 'bg-emerald-500/20 border-emerald-500/50'
          : active
          ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
          : 'border-white/10'
      }`}>
        {done ? <CheckCircle2 size={10} /> : n}
      </div>
      <span>{label}</span>
    </div>
  )
}

// ── field row ──────────────────────────────────────────────────────────────

function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">{label}</span>
      <span className={`text-xs text-white/70 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────

type Step = 'idle' | 'awaiting-wallet' | 'confirming' | 'done' | 'error'

export function CreateDeal() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const onArcTestnet = chainId === ARC_TESTNET_CHAIN_ID
  const isBuyer = address?.toLowerCase() === DEMO_BUYER.toLowerCase()
  const deadline = nowPlus24h()

  // ── local state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [dealId, setDealId] = useState<bigint | undefined>()

  // ── simulate ───────────────────────────────────────────────────────────
  const { data: simResult, error: simError, isLoading: isSimulating } = useSimulateContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'createDeal',
    args: [DEMO_SELLER, DEMO_AMOUNT, DEMO_TERMS_HASH, deadline],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: {
      enabled: isConnected && onArcTestnet && isBuyer,
      retry: false,
    },
  })

  const isIdle = step === 'idle'
  const canSubmit = !!simResult && !simError && isConnected && onArcTestnet && isBuyer && isIdle

  // ── write ──────────────────────────────────────────────────────────────
  const { writeContract, isPending: isWalletPending } = useWriteContract({
    mutation: {
      onMutate: () => setStep('awaiting-wallet'),
      onSuccess: (hash) => {
        setTxHash(hash)
        setStep('confirming')
      },
      onError: (err) => {
        setErrorMsg(parseOnchainError(err))
        setStep('error')
      },
    },
  })

  // ── receipt ────────────────────────────────────────────────────────────
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: {
      // When receipt lands, decode the DealCreated event and advance step
      select: (r) => {
        if (!r) return null
        let foundDealId: bigint | undefined
        for (const log of r.logs as Log[]) {
          try {
            const decoded = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
            if (decoded.eventName === 'DealCreated') {
              foundDealId = (decoded.args as { dealId: bigint }).dealId
              break
            }
          } catch { /* not a DealCreated log */ }
        }
        return { txHash: r.transactionHash, dealId: foundDealId }
      },
    },
  })

  // Advance to done once receipt is decoded (avoids setState-in-effect)
  const resolvedDealId = receipt?.dealId ?? dealId
  const resolvedTxHash = receipt?.txHash ?? txHash
  const isDone = step === 'confirming' && !!receipt

  // Sync step to 'done' when receipt arrives — use a ref-like flag to avoid double-set
  if (isDone && step === 'confirming') {
    if (receipt.dealId !== undefined && dealId === undefined) setDealId(receipt.dealId)
    // Use queueMicrotask to avoid calling setState during render
    queueMicrotask(() => setStep('done'))
  }

  function handleSubmit() {
    if (!simResult) return
    setErrorMsg('')
    writeContract(simResult.request)
  }

  function handleReset() {
    setStep('idle')
    setErrorMsg('')
    setTxHash(undefined)
    setDealId(undefined)
  }

  // ── button label ───────────────────────────────────────────────────────
  function ctaLabel(): string {
    switch (step) {
      case 'awaiting-wallet': return 'Waiting for MetaMask…'
      case 'confirming':      return 'Confirming on-chain…'
      default:                return 'Submit TX1 — createDeal'
    }
  }
  const ctaBusy = step === 'awaiting-wallet' || step === 'confirming' || isWalletPending

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-lg mx-auto px-4 pb-12 pt-6 flex flex-col gap-4">

      {/* Header */}
      <div className="text-center mb-2">
        <h1 className="font-display text-2xl font-bold text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
          Create Trade Deal
        </h1>
        <p className="text-sm text-white/40 mt-1 text-pretty">
          Lock 0.25 testnet USDC in escrow with the synthetic demo terms.
        </p>
      </div>

      {/* AI advisory notice */}
      <div className="flex items-start gap-2.5 rounded-xl bg-violet-500/8 border border-violet-500/20 px-3.5 py-3 text-xs text-violet-300">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-violet-400" />
        <p className="text-pretty leading-relaxed">
          <strong className="text-violet-200">AI is advisory only.</strong>{' '}
          No AI model controls this transaction. You retain full release authority.
          No real goods or delivery are involved — this is synthetic testnet data.
        </p>
      </div>

      {/* Deal parameters card */}
      <div className="rounded-2xl bg-white/5 border border-white/10 divide-y divide-white/8">
        <div className="px-4 py-3 grid grid-cols-2 gap-3">
          <FieldRow label="Network" value="Arc Testnet · Chain 5042002" />
          <FieldRow label="Amount" value="0.25 USDC (250,000 base units)" />
          <FieldRow label="Buyer (you)" value={truncate(DEMO_BUYER)} mono />
          <FieldRow label="Seller" value={truncate(DEMO_SELLER)} mono />
        </div>
        <div className="px-4 py-3 flex flex-col gap-2">
          <FieldRow label="Contract" value={truncate(ESCROW_ADDRESS)} mono />
          <FieldRow label="Terms hash" value={DEMO_TERMS_HASH} mono />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Deadline</span>
            <span className="text-xs text-white/70 font-mono tabular-nums">
              {new Date(Number(deadline) * 1000).toUTCString()}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-white/30 leading-relaxed text-pretty">
            <strong className="text-white/40">SYNTHETIC TEST DATA.</strong> The terms hash commits to a mock purchase
            order (PO-2026-001). No real goods, no real delivery, no real DHL shipment.
            Evidence and review hashes are provided at their respective stages.
          </p>
        </div>
      </div>

      {/* Signer guard */}
      {isConnected && !isBuyer && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/8 border border-amber-500/20 px-3.5 py-3 text-xs text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-amber-200">Wrong signer connected.</p>
            <p className="mt-0.5 font-mono break-all text-amber-400/80">Expected: {DEMO_BUYER}</p>
            <p className="mt-0.5 text-amber-300/70">
              Switch MetaMask to the Buyer account to enable this transaction.
            </p>
          </div>
        </div>
      )}

      {/* Simulation result */}
      {isConnected && onArcTestnet && isBuyer && (
        <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs border ${
          simError
            ? 'bg-rose-500/8 border-rose-500/20 text-rose-300'
            : isSimulating
            ? 'bg-white/5 border-white/10 text-white/40'
            : simResult
            ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-300'
            : 'bg-white/5 border-white/10 text-white/30'
        }`}>
          {isSimulating
            ? <><Loader2 size={12} className="animate-spin shrink-0" /> Simulating call…</>
            : simError
            ? <><AlertTriangle size={12} className="shrink-0" /> Simulation failed: {parseOnchainError(simError)}</>
            : simResult
            ? <><CheckCircle2 size={12} className="shrink-0" /> Simulation passed — ready to submit.</>
            : <><Info size={12} className="shrink-0" /> Simulation pending…</>
          }
        </div>
      )}

      {/* Progress steps */}
      {step !== 'idle' && step !== 'error' && (
        <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Progress</p>
          <div className="flex flex-col gap-2">
            <StatusStep n={1} label="Simulation passed" done active={false} />
            <StatusStep n={2} label="Confirm in MetaMask"
              done={step === 'confirming' || step === 'done'}
              active={step === 'awaiting-wallet'} />
            <StatusStep n={3} label="Waiting for block confirmation"
              done={step === 'done'}
              active={step === 'confirming'} />
            <StatusStep n={4} label="Deal created on-chain"
              done={step === 'done'}
              active={false} />
          </div>
        </div>
      )}

      {/* Error state */}
      {step === 'error' && (
        <div className="rounded-xl bg-rose-500/8 border border-rose-500/20 px-3.5 py-3 text-xs text-rose-300">
          <p className="font-semibold text-rose-200">Transaction failed</p>
          <p className="mt-1">{errorMsg}</p>
          <button
            onClick={handleReset}
            className="mt-2 text-rose-300 hover:text-rose-200 underline underline-offset-2"
          >
            Reset
          </button>
        </div>
      )}

      {/* Success receipt */}
      {step === 'done' && resolvedTxHash && (
        <div className="rounded-2xl bg-emerald-500/8 border border-emerald-500/20 px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 size={16} className="shrink-0" />
            <span className="font-semibold">Deal created successfully</span>
          </div>
          <div className="grid gap-2">
            {resolvedDealId !== undefined && (
              <FieldRow label="Deal ID" value={resolvedDealId.toString()} />
            )}
            <FieldRow label="Status" value={DEAL_STATUS_LABELS[0]} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Transaction hash</span>
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, resolvedTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-mono text-sky-400 hover:text-sky-300 break-all transition-colors"
              >
                {resolvedTxHash}
                <ExternalLink size={10} className="shrink-0" />
              </a>
            </div>
          </div>
          <p className="text-xs text-white/40 text-pretty">
            Next: switch MetaMask to Wallet B (Seller) and call{' '}
            <span className="font-mono text-white/60">
              acceptDeal({resolvedDealId?.toString() ?? '?'})
            </span>.
            Return here and confirm before proceeding.
          </p>
        </div>
      )}

      {/* Primary CTA */}
      {step !== 'done' && (
        <>
          {!isConnected ? (
            <p className="text-center text-sm text-white/40">Connect your wallet to continue.</p>
          ) : !onArcTestnet ? (
            <button
              onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              disabled={isSwitching}
              className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || ctaBusy}
              className={`
                w-full py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2
                ${canSubmit && !ctaBusy
                  ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 active:scale-[0.98]'
                  : 'bg-white/8 text-white/30 cursor-not-allowed'
                }
              `}
            >
              {ctaBusy && <Loader2 size={15} className="animate-spin" />}
              {ctaLabel()}
            </button>
          )}
        </>
      )}

      {/* Testnet disclaimer */}
      <p className="text-center text-[11px] text-white/20 text-pretty">
        Arc Testnet only · No real USDC · No mainnet interaction ·
        Buyer retains sole release authority · AI is advisory only
      </p>
    </div>
  )
}
