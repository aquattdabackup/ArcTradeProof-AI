/**
 * Deterministic keccak256 hashing for ArcTradeProof AI review packages.
 *
 * The canonical JSON representation is:
 *   - Keys sorted alphabetically (deep)
 *   - No whitespace
 *   - UTF-8 encoded
 *
 * This produces a stable hash regardless of insertion order.
 * The hash is computed client-side using viem so there is no server round-trip.
 *
 * IMPORTANT: The hash is NOT "on-chain" until a confirmed transaction
 * commits it to the escrow contract. This module only produces and displays
 * the prepared hash.
 */

import { keccak256, toBytes } from 'viem'
import type { ExtractedDocument, ComparisonResult, AdvisoryReport } from '../../server/types.js'

export interface ReviewPackageForHash {
  po: ExtractedDocument
  invoice: ExtractedDocument
  comparison: ComparisonResult
  report: AdvisoryReport
  hashTimestamp: string
}

/** Deeply sort object keys alphabetically for canonical serialisation. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

export function canonicalise(pkg: ReviewPackageForHash): string {
  return JSON.stringify(sortKeys(pkg))
}

export function hashReviewPackage(pkg: ReviewPackageForHash): {
  canonical: string
  hash: `0x${string}`
  method: string
  model: string
  timestamp: string
} {
  const canonical = canonicalise(pkg)
  const hash = keccak256(toBytes(canonical))
  return {
    canonical,
    hash,
    method: 'keccak256(UTF-8(canonicalJSON(sortedKeys(reviewPackage))))',
    model: pkg.report.model,
    timestamp: pkg.hashTimestamp,
  }
}
