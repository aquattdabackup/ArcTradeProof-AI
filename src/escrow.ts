/**
 * ArcTradeProofEscrow — contract constants and ABI.
 * Arc Testnet ONLY. Do not modify contract addresses without redeployment.
 */

export const ARC_TESTNET_CHAIN_ID = 5042002 as const

export const ESCROW_ADDRESS = '0x7f1af92df34d8e58dba70688404de57276a42bc7' as const
export const USDC_ADDRESS   = '0x3600000000000000000000000000000000000000' as const

export const DEMO_SELLER   = '0x03aa5C68d92Afca1a624009D7380bA0Ad0BC8522' as const
export const DEMO_BUYER    = '0x2b270B135667f38bB58Fc9376F29c95173641D31' as const
export const DEMO_AMOUNT   = 250_000n   // 0.25 USDC in 6-decimal ERC-20 base units
export const DEMO_DEAL_ID  = 1n

// Aliases used across step components
export const BUYER_ADDRESS  = DEMO_BUYER
export const SELLER_ADDRESS = DEMO_SELLER

export const ARC_TESTNET_EXPLORER = 'https://explorer.testnet.arc.io' as const

export function buildExplorerTxUrl(hash: string): string {
  return `${ARC_TESTNET_EXPLORER}/tx/${hash}`
}

export function buildExplorerAddressUrl(address: string): string {
  return `${ARC_TESTNET_EXPLORER}/address/${address}`
}

/** Alias for backwards compat with components that import STATUS_LABELS. */
export const STATUS_LABELS: Record<number, string> = {
  0: 'CREATED',
  1: 'ACCEPTED',
  2: 'FUNDED',
  3: 'EVIDENCE_SUBMITTED',
  4: 'RELEASED',
  5: 'REFUNDED',
}

/**
 * termsHash for the synthetic demo deal.
 * keccak256 of the canonical UTF-8 string:
 * "[SYNTHETIC TEST DATA] ArcTradeProof-Demo | PO-2026-001 | Buyer:0x2b270B135667f38bB58Fc9376F29c95173641D31 |
 *  Seller:0x03aa5C68d92Afca1a624009D7380bA0Ad0BC8522 | Qty:100 units Widget-A | Price:0.25 USDC |
 *  Payment:escrow-release-on-delivery | Warning:This is synthetic demo data only. No real goods or delivery."
 */
export const DEMO_TERMS_HASH =
  '0x9d72dc10180d81474a401ca4acd69f3d3b2443957a730f838fc68d3031720dfb' as `0x${string}`

export const ESCROW_ABI = [
  // ── state-changing ────────────────────────────────────────────────────────
  {
    name: 'createDeal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'seller',    type: 'address' },
      { name: 'amount',    type: 'uint256' },
      { name: 'termsHash', type: 'bytes32' },
      { name: 'deadline',  type: 'uint256' },
    ],
    outputs: [{ name: 'dealId', type: 'uint256' }],
  },
  {
    name: 'acceptDeal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'fundDeal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'submitEvidence',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId',       type: 'uint256' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'approveAndRelease',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId',     type: 'uint256' },
      { name: 'reviewHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'refundExpired',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
  },
  // ── views ─────────────────────────────────────────────────────────────────
  {
    name: 'getDeal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'dealId',       type: 'uint256' },
          { name: 'buyer',        type: 'address' },
          { name: 'seller',       type: 'address' },
          { name: 'amount',       type: 'uint256' },
          { name: 'termsHash',    type: 'bytes32' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'reviewHash',   type: 'bytes32' },
          { name: 'expiration',   type: 'uint256' },
          { name: 'status',       type: 'uint8'   },
        ],
      },
    ],
  },
  {
    name: 'getDealStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'totalDeals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalEscrowLocked',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_AMOUNT_PER_DEAL',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_TOTAL_ESCROW',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // ── events ────────────────────────────────────────────────────────────────
  {
    name: 'DealCreated',
    type: 'event',
    inputs: [
      { name: 'dealId',     type: 'uint256', indexed: true  },
      { name: 'buyer',      type: 'address', indexed: true  },
      { name: 'seller',     type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
      { name: 'termsHash',  type: 'bytes32', indexed: false },
      { name: 'expiration', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'DealFunded',
    type: 'event',
    inputs: [{ name: 'dealId', type: 'uint256', indexed: true }],
  },
  {
    name: 'DealReleased',
    type: 'event',
    inputs: [
      { name: 'dealId',     type: 'uint256', indexed: true  },
      { name: 'seller',     type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
      { name: 'reviewHash', type: 'bytes32', indexed: false },
    ],
  },
] as const

/** Human-readable deal status labels. */
export const DEAL_STATUS_LABELS: Record<number, string> = {
  0: 'Created',
  1: 'Accepted',
  2: 'Funded',
  3: 'Evidence Submitted',
  4: 'Released',
  5: 'Refunded',
}

export const DEAL_STATUS_COLORS: Record<number, string> = {
  0: 'text-slate-400',
  1: 'text-blue-400',
  2: 'text-amber-400',
  3: 'text-violet-400',
  4: 'text-emerald-400',
  5: 'text-rose-400',
}
