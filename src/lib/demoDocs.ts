/**
 * Synthetic demo document pairs for ArcTradeProof AI.
 *
 * These are CLEARLY LABELED as synthetic test data.
 * They are used to demonstrate the AI extraction and comparison pipeline
 * without requiring real commercial documents.
 *
 * Both cases run through the ACTUAL AI extraction pipeline
 * (server-side via /api/extract). Results are NOT hardcoded.
 */

export const DEMO_DOCS = {
  /** Case A — matching documents. Expected AI result: MATCH. */
  caseA: {
    label: 'Case A — Matching Documents',
    description: 'Purchase order and invoice with consistent details. Expected: MATCH.',
    po: {
      filename: '[SYNTHETIC] PO-2026-DEMO-A.txt',
      mimeType: 'text/plain',
      content: `[SYNTHETIC TEST DATA — NOT A REAL COMMERCIAL DOCUMENT]

PURCHASE ORDER
==============
PO Number:       PO-2026-DEMO-A
Date:            2026-10-18
Buyer:           ArcTradeProof Demo Buyer Corp
Buyer Address:   100 Circle Way, San Francisco, CA 94105
Seller:          ArcTradeProof Demo Seller Ltd
Seller Address:  200 Commerce Street, New York, NY 10001

Items:
  1. Widget-A (Standard)    Qty: 100    Unit Price: 10.00 USDC    Line Total: 1,000.00 USDC

Subtotal:        1,000.00 USDC
Shipping:           0.00 USDC
Total Amount:    1,000.00 USDC
Currency:        USDC

Payment Terms:   Net 30, Escrow Release on Delivery Confirmation
Delivery:        DAP — Delivered at Place (Buyer's warehouse)
Expected Delivery: 2026-11-01

Authorised By:   [SYNTHETIC SIGNATURE]
Warning: This document is entirely synthetic. No real goods, parties, or transactions exist.`,
    },
    invoice: {
      filename: '[SYNTHETIC] INV-2026-DEMO-A.txt',
      mimeType: 'text/plain',
      content: `[SYNTHETIC TEST DATA — NOT A REAL COMMERCIAL DOCUMENT]

COMMERCIAL INVOICE
==================
Invoice Number:  INV-2026-DEMO-A
Invoice Date:    2026-10-19
Due Date:        2026-11-18

Seller (Exporter): ArcTradeProof Demo Seller Ltd
Seller Address:    200 Commerce Street, New York, NY 10001
Buyer (Importer):  ArcTradeProof Demo Buyer Corp
Buyer Address:     100 Circle Way, San Francisco, CA 94105

Referenced PO:   PO-2026-DEMO-A

Items:
  1. Widget-A (Standard)    Qty: 100    Unit Price: 10.00 USDC    Line Total: 1,000.00 USDC

Subtotal:        1,000.00 USDC
Shipping:           0.00 USDC
Total Amount:    1,000.00 USDC
Currency:        USDC

Payment Terms:   Net 30, Escrow Release on Delivery Confirmation
Delivery:        DAP — Delivered at Place

Authorised By:   [SYNTHETIC SIGNATURE]
Warning: This document is entirely synthetic. No real goods, parties, or transactions exist.`,
    },
  },

  /** Case B — discrepancy. PO total 1,000 USDC vs Invoice total 1,250 USDC.
   *  Expected: MISMATCH — invoice exceeds PO by 250 USDC. */
  caseB: {
    label: 'Case B — Discrepancy (250 USDC over-invoice)',
    description: 'PO total: 1,000 USDC. Invoice total: 1,250 USDC. Expected: MISMATCH — 250 USDC discrepancy.',
    po: {
      filename: '[SYNTHETIC] PO-2026-DEMO-B.txt',
      mimeType: 'text/plain',
      content: `[SYNTHETIC TEST DATA — NOT A REAL COMMERCIAL DOCUMENT]

PURCHASE ORDER
==============
PO Number:       PO-2026-DEMO-B
Date:            2026-10-18
Buyer:           ArcTradeProof Demo Buyer Corp
Buyer Address:   100 Circle Way, San Francisco, CA 94105
Seller:          ArcTradeProof Demo Seller Ltd
Seller Address:  200 Commerce Street, New York, NY 10001

Items:
  1. Widget-B (Premium)     Qty: 100    Unit Price: 10.00 USDC    Line Total: 1,000.00 USDC

Subtotal:        1,000.00 USDC
Shipping:           0.00 USDC
Total Amount:    1,000.00 USDC
Currency:        USDC

Payment Terms:   Net 30, Escrow Release on Delivery Confirmation
Delivery:        DAP — Delivered at Place
Expected Delivery: 2026-11-01

Authorised By:   [SYNTHETIC SIGNATURE]
Warning: This document is entirely synthetic. No real goods, parties, or transactions exist.`,
    },
    invoice: {
      filename: '[SYNTHETIC] INV-2026-DEMO-B.txt',
      mimeType: 'text/plain',
      content: `[SYNTHETIC TEST DATA — NOT A REAL COMMERCIAL DOCUMENT]

COMMERCIAL INVOICE
==================
Invoice Number:  INV-2026-DEMO-B
Invoice Date:    2026-10-19
Due Date:        2026-11-18

Seller (Exporter): ArcTradeProof Demo Seller Ltd
Seller Address:    200 Commerce Street, New York, NY 10001
Buyer (Importer):  ArcTradeProof Demo Buyer Corp
Buyer Address:     100 Circle Way, San Francisco, CA 94105

Referenced PO:   PO-2026-DEMO-B

Items:
  1. Widget-B (Premium)       Qty: 100    Unit Price: 10.00 USDC    Line Total: 1,000.00 USDC
  2. Rush Handling Surcharge   Qty:   1    Unit Price: 250.00 USDC   Line Total:   250.00 USDC

Subtotal:        1,250.00 USDC
Shipping:           0.00 USDC
Total Amount:    1,250.00 USDC
Currency:        USDC

Payment Terms:   Net 30, Escrow Release on Delivery Confirmation
Delivery:        DAP — Delivered at Place

Note: Rush Handling Surcharge applied per verbal agreement (NOT reflected in PO-2026-DEMO-B).
Authorised By:   [SYNTHETIC SIGNATURE]
Warning: This document is entirely synthetic. No real goods, parties, or transactions exist.`,
    },
  },
} as const
