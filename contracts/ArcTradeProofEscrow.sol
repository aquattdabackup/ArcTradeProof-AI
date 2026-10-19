// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcTradeProofEscrow
/// @notice Buyer-approval USDC escrow for ArcTradeProof AI international trade demos.
///
/// @dev TRUST ASSUMPTIONS AND LIMITATIONS
/// ─────────────────────────────────────────────────────────────────────────────
/// (1) AI IS ADVISORY ONLY.
///     Off-chain AI analysis of purchase orders and invoices produces a review
///     hash that the buyer records onchain via approveAndRelease(). The AI has
///     no contract address, no signing key, and no permission to authorize,
///     redirect, or execute any payment. Final release authority belongs
///     exclusively to the named buyer.
///
/// (2) BUYER CONTROLS RELEASE.
///     Only the buyer address recorded at deal creation may call
///     approveAndRelease() or refundExpired(). No third party, oracle, or
///     automated agent can release or redirect escrowed funds.
///
/// (3) REAL-WORLD DELIVERY NOT VERIFIED.
///     The contract stores document hashes (termsHash, evidenceHash,
///     reviewHash) as opaque bytes32 values. It does not interpret document
///     contents, verify carrier data, or guarantee physical shipment or
///     delivery of any goods.
///
/// (4) 20 USDC AGGREGATE CAP.
///     MAX_TOTAL_ESCROW is a hardcoded constant (20 USDC / 20_000_000 base
///     units). When the cap is fully utilized across concurrent deals,
///     fundDeal() will revert with EscrowLimitExceeded until a deal is
///     settled or refunded. Callers should check remaining headroom before
///     requesting token approval.
///
/// (5) DIRECT TRANSFERS ARE PERMANENTLY UNRECOVERABLE.
///     Any USDC transferred directly to this contract address — bypassing
///     fundDeal() — is NOT assigned to any deal and CANNOT be recovered.
///     This contract has no administrative withdrawal, no rescue function,
///     and no owner. There is no path to recover accidentally sent tokens.
///     Use fundDeal() exclusively for all escrow deposits.
///
/// (6) TOKEN TRANSFER FAILURES.
///     If the USDC token contract rejects a transfer (e.g., due to
///     restrictions, blacklisting, or unexpected token behaviour), the
///     entire transaction reverts. This may prevent settlement via
///     approveAndRelease() or recovery via refundExpired(). Parties should
///     ensure their addresses are not subject to token-level restrictions
///     before creating a deal.
/// ─────────────────────────────────────────────────────────────────────────────

contract ArcTradeProofEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    /// @notice Maximum USDC amount per individual deal (5 USDC, 6-decimal base units).
    uint256 public constant MAX_AMOUNT_PER_DEAL = 5_000_000;

    /// @notice Maximum aggregate USDC held in escrow at any time (20 USDC, 6-decimal base units).
    uint256 public constant MAX_TOTAL_ESCROW = 20_000_000;

    /// @notice Maximum allowable deal deadline window from block of creation.
    /// @dev Reduced to 7 days for demonstration safety.
    uint256 private constant MAX_DEADLINE_WINDOW = 7 days;

    /// @notice Expected decimals for the Arc USDC ERC-20 interface.
    uint8 private constant EXPECTED_DECIMALS = 6;

    /// @notice Official Arc USDC ERC-20 address (same on testnet and mainnet).
    /// @dev 0x3600000000000000000000000000000000000000
    address private constant ARC_USDC_ADDRESS = 0x3600000000000000000000000000000000000000;

    // ─── No administrative or recovery withdrawal path ────────────────────────
    // This contract intentionally has no admin, no owner, and no function that
    // can withdraw USDC from the contract outside of the normal deal lifecycle
    // (approveAndRelease / refundExpired). USDC sent directly to this address
    // without going through fundDeal() is permanently unrecoverable.

    /// @notice Arc Mainnet chain ID.
    uint256 private constant ARC_MAINNET_CHAIN_ID = 5042;

    /// @notice Arc Testnet chain ID.
    uint256 private constant ARC_TESTNET_CHAIN_ID = 5042002;

    // ─── Immutables ──────────────────────────────────────────────────────────

    /// @notice The USDC ERC-20 token this contract escrows.
    IERC20 public immutable usdc;

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @notice Lifecycle states for a trade deal.
    enum DealStatus {
        CREATED,           // Buyer created; awaiting seller acceptance.
        ACCEPTED,          // Seller accepted terms; awaiting buyer funding.
        FUNDED,            // Buyer deposited USDC; awaiting seller evidence.
        EVIDENCE_SUBMITTED,// Seller submitted evidence; awaiting buyer release.
        RELEASED,          // Buyer approved; USDC transferred to seller. Terminal.
        REFUNDED           // Buyer reclaimed USDC after expiration. Terminal.
    }

    struct Deal {
        uint256 dealId;
        address buyer;
        address seller;
        uint256 amount;         // 6-decimal USDC base units
        bytes32 termsHash;      // keccak256 of canonicalised commercial terms
        bytes32 evidenceHash;   // keccak256 of delivery evidence (set on submitEvidence)
        bytes32 reviewHash;     // keccak256 of AI review report (set on approveAndRelease)
        uint256 expiration;     // unix timestamp after which buyer may refund
        DealStatus status;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    mapping(uint256 => Deal) public deals;

    /// @notice Total number of deals ever created (also the latest deal ID).
    uint256 public totalDeals;

    /// @notice Running total of USDC currently locked in funded deals.
    uint256 public totalEscrowLocked;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidTokenAddress();
    error WrongUsdcAddress(address provided, address required);
    error WrongUsdcDecimals(uint8 reported, uint8 required);
    error WrongChain(uint256 chainId);
    error InvalidSeller();
    error BuyerSellerSame();
    error InvalidAmount();
    error InvalidTermsHash();
    error InvalidDeadline();
    error Unauthorized();
    error InvalidState();
    error DealExpired();
    error DealNotExpired();
    error InvalidHash();
    error EscrowLimitExceeded();
    error DealNotFound();
    error DepositMismatch(uint256 expected, uint256 actual);

    // ─── Events ──────────────────────────────────────────────────────────────

    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        bytes32 termsHash,
        uint256 expiration
    );
    event DealAccepted(uint256 indexed dealId);
    event DealFunded(uint256 indexed dealId);
    event EvidenceSubmitted(uint256 indexed dealId, bytes32 evidenceHash);
    event DealReleased(
        uint256 indexed dealId,
        address indexed seller,
        uint256 amount,
        bytes32 reviewHash
    );
    event DealRefunded(uint256 indexed dealId, address indexed buyer, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @notice Deploy the escrow contract.
    /// @dev Validates (1) that the chain is Arc Mainnet or Arc Testnet, (2) that
    ///      the supplied address is exactly the canonical Arc USDC address, and
    ///      (3) that the token reports 6 decimals. All three checks together prevent
    ///      accidental deployment on a non-Arc chain where a different contract might
    ///      coincidentally live at the same address and report 6 decimals.
    /// @param usdcAddress Must equal 0x3600000000000000000000000000000000000000.
    constructor(address usdcAddress) {
        // (1) Chain guard: only Arc Mainnet and Arc Testnet are permitted.
        if (block.chainid != ARC_MAINNET_CHAIN_ID && block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }

        // (2) Token address must match the canonical Arc USDC ERC-20 interface.
        if (usdcAddress == address(0)) revert InvalidTokenAddress();
        if (usdcAddress != ARC_USDC_ADDRESS) {
            revert WrongUsdcAddress(usdcAddress, ARC_USDC_ADDRESS);
        }

        // (3) Verify the token reports 6 decimals via IERC20Metadata.
        // Arc USDC's ERC-20 interface uses 6 decimals regardless of native gas decimals.
        uint8 reportedDecimals = IERC20Metadata(usdcAddress).decimals();
        if (reportedDecimals != EXPECTED_DECIMALS) {
            revert WrongUsdcDecimals(reportedDecimals, EXPECTED_DECIMALS);
        }

        usdc = IERC20(usdcAddress);
    }

    // ─── External functions ──────────────────────────────────────────────────

    /// @notice Buyer creates a new trade deal.
    /// @param seller  Address of the counterparty seller. Must differ from caller.
    /// @param amount  USDC amount in 6-decimal base units (max 5_000_000).
    /// @param termsHash  keccak256 of canonicalised commercial terms document.
    /// @param deadline  Unix timestamp after which the deal expires (max 7 days out).
    /// @return dealId  Monotonically increasing deal identifier starting at 1.
    function createDeal(
        address seller,
        uint256 amount,
        bytes32 termsHash,
        uint256 deadline
    ) external returns (uint256 dealId) {
        address buyer = msg.sender;

        if (seller == address(0)) revert InvalidSeller();
        if (buyer == seller) revert BuyerSellerSame();
        if (amount == 0 || amount > MAX_AMOUNT_PER_DEAL) revert InvalidAmount();
        if (termsHash == bytes32(0)) revert InvalidTermsHash();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert InvalidDeadline();
        }

        dealId = ++totalDeals;

        deals[dealId] = Deal({
            dealId: dealId,
            buyer: buyer,
            seller: seller,
            amount: amount,
            termsHash: termsHash,
            evidenceHash: bytes32(0),
            reviewHash: bytes32(0),
            expiration: deadline,
            status: DealStatus.CREATED
        });

        emit DealCreated(dealId, buyer, seller, amount, termsHash, deadline);
    }

    /// @notice Seller accepts the deal, committing to the recorded termsHash.
    /// @dev Only the designated seller may call this. Must precede expiration.
    function acceptDeal(uint256 dealId) external {
        Deal storage deal = _getExistingDeal(dealId);

        if (msg.sender != deal.seller) revert Unauthorized();
        if (deal.status != DealStatus.CREATED) revert InvalidState();
        if (block.timestamp >= deal.expiration) revert DealExpired();

        deal.status = DealStatus.ACCEPTED;

        emit DealAccepted(dealId);
    }

    /// @notice Buyer deposits exact USDC amount into escrow.
    /// @dev Uses a balance-delta check to guard against fee-on-transfer tokens
    ///      and any other transfer discrepancy. Reverts if received != deal.amount.
    ///      Caller must have pre-approved this contract for at least deal.amount.
    function fundDeal(uint256 dealId) external nonReentrant {
        Deal storage deal = _getExistingDeal(dealId);

        if (msg.sender != deal.buyer) revert Unauthorized();
        if (deal.status != DealStatus.ACCEPTED) revert InvalidState();
        if (block.timestamp >= deal.expiration) revert DealExpired();
        if (totalEscrowLocked + deal.amount > MAX_TOTAL_ESCROW) revert EscrowLimitExceeded();

        // ── Checks-Effects-Interactions ───────────────────────────────────
        // Effects first: update state before the external call.
        uint256 expectedAmount = deal.amount;
        totalEscrowLocked += expectedAmount;
        deal.status = DealStatus.FUNDED;

        // Interaction: record balance before and after to verify exact receipt.
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), expectedAmount);
        uint256 balanceAfter = usdc.balanceOf(address(this));

        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != expectedAmount) {
            revert DepositMismatch(expectedAmount, actualReceived);
        }

        emit DealFunded(dealId);
    }

    /// @notice Seller submits delivery evidence hash.
    /// @param evidenceHash  keccak256 of the delivery evidence document. Must not be zero.
    function submitEvidence(uint256 dealId, bytes32 evidenceHash) external {
        Deal storage deal = _getExistingDeal(dealId);

        if (msg.sender != deal.seller) revert Unauthorized();
        if (deal.status != DealStatus.FUNDED) revert InvalidState();
        if (block.timestamp >= deal.expiration) revert DealExpired();
        if (evidenceHash == bytes32(0)) revert InvalidHash();

        deal.evidenceHash = evidenceHash;
        deal.status = DealStatus.EVIDENCE_SUBMITTED;

        emit EvidenceSubmitted(dealId, evidenceHash);
    }

    /// @notice Buyer reviews evidence (with optional AI review hash) and releases USDC to seller.
    /// @dev State is set to RELEASED and escrow accounting updated BEFORE the
    ///      safeTransfer call (strict CEI). nonReentrant as an additional guard.
    /// @param reviewHash  keccak256 of the AI review report or buyer review record. Must not be zero.
    function approveAndRelease(uint256 dealId, bytes32 reviewHash) external nonReentrant {
        Deal storage deal = _getExistingDeal(dealId);

        if (msg.sender != deal.buyer) revert Unauthorized();
        if (deal.status != DealStatus.EVIDENCE_SUBMITTED) revert InvalidState();
        if (block.timestamp >= deal.expiration) revert DealExpired();
        if (reviewHash == bytes32(0)) revert InvalidHash();

        // ── Checks-Effects-Interactions ───────────────────────────────────
        deal.reviewHash = reviewHash;
        deal.status = DealStatus.RELEASED;
        uint256 amount = deal.amount;
        address seller = deal.seller;
        totalEscrowLocked -= amount;

        usdc.safeTransfer(seller, amount);

        emit DealReleased(dealId, seller, amount, reviewHash);
    }

    /// @notice Buyer reclaims escrowed USDC after the deal has expired without settlement.
    /// @dev Covers both FUNDED (seller never submitted evidence) and EVIDENCE_SUBMITTED
    ///      (seller submitted but buyer did not approve before expiry). State is set to
    ///      REFUNDED and accounting updated BEFORE the safeTransfer call (strict CEI).
    function refundExpired(uint256 dealId) external nonReentrant {
        Deal storage deal = _getExistingDeal(dealId);

        if (msg.sender != deal.buyer) revert Unauthorized();
        if (deal.status != DealStatus.FUNDED && deal.status != DealStatus.EVIDENCE_SUBMITTED) {
            revert InvalidState();
        }
        if (block.timestamp < deal.expiration) revert DealNotExpired();

        // ── Checks-Effects-Interactions ───────────────────────────────────
        address buyer = deal.buyer;
        uint256 amount = deal.amount;
        deal.status = DealStatus.REFUNDED;
        totalEscrowLocked -= amount;

        usdc.safeTransfer(buyer, amount);

        emit DealRefunded(dealId, buyer, amount);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /// @notice Returns the full deal record for the given ID.
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _getExistingDeal(dealId);
    }

    /// @notice Returns the current status of the given deal.
    function getDealStatus(uint256 dealId) external view returns (DealStatus) {
        return _getExistingDeal(dealId).status;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    /// @dev Reverts with DealNotFound for ID 0 or any ID beyond totalDeals.
    function _getExistingDeal(uint256 dealId) internal view returns (Deal storage deal) {
        if (dealId == 0 || dealId > totalDeals) revert DealNotFound();
        deal = deals[dealId];
    }
}
