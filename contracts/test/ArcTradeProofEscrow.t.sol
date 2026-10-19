// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcTradeProofEscrow} from "../ArcTradeProofEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─── Mock ERC-20 ────────────────────────────────────────────────────────────

/// @dev Minimal ERC-20 mock with controllable failure modes and a reentrancy
///      callback used to exercise the escrow's nonReentrant guards.
contract MockERC20 {
    // ── ERC-20 core state ─────────────────────────────────────────────────
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    // NOTE: name/symbol are unused by the escrow — omit them to avoid
    // storage-layout concerns after vm.etch (which copies bytecode only).
    // decimals() MUST be a pure function so it works on the etched address
    // without any storage reads (vm.etch does not copy storage).
    function name()   external pure returns (string memory) { return "Mock USDC"; }
    function symbol() external pure returns (string memory) { return "mUSDC"; }
    function decimals() external pure returns (uint8) { return 6; }

    // ── Configurable failure modes ────────────────────────────────────────
    uint256 private _feeBps;        // nonzero → fee-on-transfer simulation
    bool    private _failTransfers; // true  → all transfer/transferFrom revert

    // ── Reentrancy callback ───────────────────────────────────────────────
    address private _reentrantEscrow;
    bytes   private _reentrantData;
    bool    private _reentrantFired;

    // ── Events ───────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ── ERC-20 standard ──────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) { return _totalSupply; }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (_failTransfers) revert("TRANSFER_FAIL");
        _balances[msg.sender] -= amount;
        _balances[to]         += amount;
        emit Transfer(msg.sender, to, amount);

        // Reentrancy callback: also fires on transfer (used by refundExpired /
        // approveAndRelease which call safeTransfer → transfer).
        _fireReentrantCallback();

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_failTransfers) revert("TRANSFER_FAIL");

        _allowances[from][msg.sender] -= amount;

        uint256 delivered = amount;
        if (_feeBps != 0) {
            delivered = (amount * (10_000 - _feeBps)) / 10_000;
        }

        _balances[from] -= amount;
        _balances[to]   += delivered;
        emit Transfer(from, to, delivered);

        // Reentrancy callback: fires once, then clears itself.
        _fireReentrantCallback();

        return true;
    }

    /// @dev Internal helper: fires the one-shot reentrancy callback if armed.
    function _fireReentrantCallback() private {
        if (_reentrantEscrow != address(0) && !_reentrantFired) {
            _reentrantFired = true;
            address target  = _reentrantEscrow;
            bytes memory d  = _reentrantData;
            // Clear before the call to avoid double-fire confusion.
            _reentrantEscrow = address(0);
            _reentrantData   = "";
            (bool ok,) = target.call(d);
            // We intentionally ignore `ok` — the caller (the escrow) decides
            // whether the outer transaction should revert.
            (ok); // silence unused-variable warning
        }
    }

    // ── Mock helpers ──────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external {
        _balances[to]  += amount;
        _totalSupply   += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @dev Set a fee-on-transfer percentage in basis points (e.g. 1000 = 10%).
    function setFeePercent(uint256 feeBps) external {
        _feeBps = feeBps;
    }

    /// @dev When true, all transfer/transferFrom calls revert.
    function setFailTransfers(bool fail) external {
        _failTransfers = fail;
    }

    /// @dev Arm a one-shot reentrancy callback: during the NEXT transferFrom
    ///      the mock will call `escrow` with `data` once, then clear the hook.
    function setReentrantCall(address escrow, bytes calldata data) external {
        _reentrantEscrow = escrow;
        _reentrantData   = data;
        _reentrantFired  = false;
    }
}

/// @dev Separate mock that reports 18 decimals — used for WrongUsdcDecimals test.
///      decimals() is pure so the value is embedded in bytecode and survives vm.etch.
contract BadDecimalsMock {
    // decimals() is pure — value comes from bytecode, not storage.
    function name()     external pure returns (string memory) { return "Bad USDC"; }
    function symbol()   external pure returns (string memory) { return "bUSDC"; }
    function decimals() external pure returns (uint8)         { return 18; }

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() external pure returns (uint256) { return 0; }
    function balanceOf(address a) external view returns (uint256) { return _balances[a]; }
    function allowance(address o, address s) external view returns (uint256) { return _allowances[o][s]; }
    function approve(address s, uint256 a) external returns (bool) {
        _allowances[msg.sender][s] = a;
        emit Approval(msg.sender, s, a);
        return true;
    }
    function transfer(address t, uint256 a) external returns (bool) {
        _balances[msg.sender] -= a;
        _balances[t] += a;
        emit Transfer(msg.sender, t, a);
        return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        _allowances[f][msg.sender] -= a;
        _balances[f] -= a;
        _balances[t] += a;
        emit Transfer(f, t, a);
        return true;
    }
}

// ─── Test contract ───────────────────────────────────────────────────────────

contract ArcTradeProofEscrowTest is Test {

    // ── Constants ─────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    uint256 internal constant AMT_025   = 250_000;
    uint256 internal constant AMT_100   = 1_000_000;
    uint256 internal constant AMT_500   = 5_000_000;   // MAX_AMOUNT_PER_DEAL
    uint256 internal constant MAX_ESCROW = 20_000_000;

    bytes32 internal constant TERMS    = keccak256("terms");
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    bytes32 internal constant REVIEW   = keccak256("review");

    // ── Test addresses ────────────────────────────────────────────────────
    address internal buyer    = makeAddr("buyer");
    address internal seller   = makeAddr("seller");
    address internal attacker = makeAddr("attacker");
    address internal buyer2   = makeAddr("buyer2");
    address internal seller2  = makeAddr("seller2");

    // ── Contracts under test ──────────────────────────────────────────────
    MockERC20            internal usdc;
    ArcTradeProofEscrow  internal escrow;

    // ─────────────────────────────────────────────────────────────────────
    // setUp — runs before EVERY test
    // ─────────────────────────────────────────────────────────────────────

    function setUp() public {
        // 0. Set chain ID to Arc Testnet so the constructor chain guard passes.
        vm.chainId(5042002);

        // 1. Deploy MockERC20 to a throwaway address, etch bytecode to canonical USDC slot.
        MockERC20 temp = new MockERC20();
        vm.etch(USDC_ADDR, address(temp).code);
        usdc = MockERC20(USDC_ADDR);

        // 2. Deploy the escrow — constructor validates chain ID, address & decimals().
        escrow = new ArcTradeProofEscrow(USDC_ADDR);

        // 3. Seed balances.
        usdc.mint(buyer,    10_000_000);
        usdc.mint(buyer2,   10_000_000);
        usdc.mint(attacker, 10_000_000);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 days;
    }

    /// @dev Drives a deal all the way to EVIDENCE_SUBMITTED.
    function _reachEvidenceSubmitted(address b, address s, uint256 amount)
        internal returns (uint256 dealId)
    {
        vm.prank(b);
        dealId = escrow.createDeal(s, amount, TERMS, _deadline());
        vm.prank(s);
        escrow.acceptDeal(dealId);
        vm.prank(b);
        usdc.approve(address(escrow), amount);
        vm.prank(b);
        escrow.fundDeal(dealId);
        vm.prank(s);
        escrow.submitEvidence(dealId, EVIDENCE);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── Happy path ────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function test_Happy_FullLifecycle_025() public {
        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(seller);

        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_025);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        assertEq(usdc.balanceOf(seller), sellerBefore + AMT_025, "seller balance");
        assertEq(usdc.balanceOf(buyer),  buyerBefore  - AMT_025, "buyer balance");
        assertEq(escrow.totalEscrowLocked(), 0, "escrow locked");

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.status), uint8(ArcTradeProofEscrow.DealStatus.RELEASED), "status");
    }

    function test_Happy_FullLifecycle_100() public {
        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(seller);

        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        assertEq(usdc.balanceOf(seller), sellerBefore + AMT_100, "seller balance");
        assertEq(usdc.balanceOf(buyer),  buyerBefore  - AMT_100, "buyer balance");
        assertEq(escrow.totalEscrowLocked(), 0, "escrow locked");

        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.RELEASED),
            "status"
        );
    }

    function test_Happy_FullLifecycle_MaxAmount() public {
        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(seller);

        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_500);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        assertEq(usdc.balanceOf(seller), sellerBefore + AMT_500, "seller balance");
        assertEq(usdc.balanceOf(buyer),  buyerBefore  - AMT_500, "buyer balance");
        assertEq(escrow.totalEscrowLocked(), 0, "escrow locked");

        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.RELEASED),
            "status"
        );
    }

    function test_Happy_Refund_FromFunded() public {
        // Create, accept, fund — stop before evidence.
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        // Warp past expiry.
        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id);

        assertEq(usdc.balanceOf(buyer), buyerBefore + AMT_100, "buyer refunded");
        assertEq(escrow.totalEscrowLocked(), 0, "escrow locked");
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.REFUNDED),
            "status REFUNDED"
        );
    }

    function test_Happy_Refund_FromEvidenceSubmitted() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id);

        assertEq(usdc.balanceOf(buyer), buyerBefore + AMT_100, "buyer refunded");
        assertEq(escrow.totalEscrowLocked(), 0, "escrow locked");
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.REFUNDED),
            "status REFUNDED"
        );
    }

    function test_Happy_TwoIndependentDeals() public {
        uint256 id1 = _reachEvidenceSubmitted(buyer,  seller,  AMT_100);
        uint256 id2 = _reachEvidenceSubmitted(buyer2, seller2, AMT_500);

        vm.prank(buyer);
        escrow.approveAndRelease(id1, REVIEW);
        vm.prank(buyer2);
        escrow.approveAndRelease(id2, REVIEW);

        assertEq(escrow.totalEscrowLocked(), 0, "all cleared");
        assertEq(
            uint8(escrow.getDealStatus(id1)),
            uint8(ArcTradeProofEscrow.DealStatus.RELEASED)
        );
        assertEq(
            uint8(escrow.getDealStatus(id2)),
            uint8(ArcTradeProofEscrow.DealStatus.RELEASED)
        );
    }

    function test_Happy_Events_DealCreated() public {
        uint256 expectedDeadline = _deadline();

        vm.expectEmit(true, true, true, true, address(escrow));
        emit ArcTradeProofEscrow.DealCreated(
            1,        // first deal
            buyer,
            seller,
            AMT_100,
            TERMS,
            expectedDeadline
        );

        vm.prank(buyer);
        escrow.createDeal(seller, AMT_100, TERMS, expectedDeadline);
    }

    function test_Happy_Events_DealFunded() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);

        vm.expectEmit(true, false, false, false, address(escrow));
        emit ArcTradeProofEscrow.DealFunded(id);

        vm.prank(buyer);
        escrow.fundDeal(id);
    }

    function test_Happy_Events_DealReleased() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit ArcTradeProofEscrow.DealReleased(id, seller, AMT_100, REVIEW);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── Authorization ─────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function test_Auth_SellerCannotFund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);

        vm.prank(seller);
        usdc.approve(address(escrow), AMT_100);   // give allowance (shouldn't matter)

        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.fundDeal(id);
    }

    function test_Auth_AttackerCannotAccept() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());

        vm.prank(attacker);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.acceptDeal(id);
    }

    function test_Auth_AttackerCannotFund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);

        vm.prank(attacker);
        usdc.approve(address(escrow), AMT_100);

        vm.prank(attacker);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.fundDeal(id);
    }

    function test_Auth_BuyerCannotSubmitEvidence() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.submitEvidence(id, EVIDENCE);
    }

    function test_Auth_AttackerCannotSubmitEvidence() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        vm.prank(attacker);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.submitEvidence(id, EVIDENCE);
    }

    function test_Auth_SellerCannotRelease() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_Auth_AttackerCannotRelease() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.prank(attacker);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_Auth_SellerCannotRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.refundExpired(id);
    }

    function test_Auth_AttackerCannotRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(attacker);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.refundExpired(id);
    }

    function test_Auth_Buyer2CannotControlBuyer1Deal() public {
        // Buyer creates & seller accepts a deal.
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);

        // buyer2 tries to fund.
        vm.prank(buyer2);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer2);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.fundDeal(id);

        // Legitimate buyer funds.
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);
        vm.prank(seller);
        escrow.submitEvidence(id, EVIDENCE);

        // buyer2 tries to release.
        vm.prank(buyer2);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.approveAndRelease(id, REVIEW);

        // buyer2 tries to refund (won't pass expiry check but auth check comes first).
        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer2);
        vm.expectRevert(ArcTradeProofEscrow.Unauthorized.selector);
        escrow.refundExpired(id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── State machine ─────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function test_State_CannotFundBeforeAccept() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());

        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.fundDeal(id);
    }

    function test_State_CannotSubmitEvidenceBeforeFunding() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        // Still ACCEPTED — not funded.
        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.submitEvidence(id, EVIDENCE);
    }

    function test_State_CannotReleaseBeforeEvidence() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);
        // FUNDED but no evidence yet.
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_State_CannotFundTwice() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100 * 2);
        vm.prank(buyer);
        escrow.fundDeal(id);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.fundDeal(id);
    }

    function test_State_CannotReleaseTwice() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_State_CannotRefundTwice() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.refundExpired(id);
    }

    function test_State_CannotReleaseAfterRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);
        vm.prank(seller);
        escrow.submitEvidence(id, EVIDENCE);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id);

        // Now try to release — state is REFUNDED, not EVIDENCE_SUBMITTED.
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_State_CannotRefundAfterRelease() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        // After release, refundExpired should see InvalidState (RELEASED, not FUNDED/EVIDENCE_SUBMITTED).
        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidState.selector);
        escrow.refundExpired(id);
    }

    function test_State_CannotAcceptExpired() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.DealExpired.selector);
        escrow.acceptDeal(id);
    }

    function test_State_CannotFundExpired() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.DealExpired.selector);
        escrow.fundDeal(id);
    }

    function test_State_CannotSubmitEvidenceExpired() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(seller);
        vm.expectRevert(ArcTradeProofEscrow.DealExpired.selector);
        escrow.submitEvidence(id, EVIDENCE);
    }

    function test_State_CannotReleaseExpired() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.DealExpired.selector);
        escrow.approveAndRelease(id, REVIEW);
    }

    function test_State_CannotRefundBeforeExpiry() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        // Do NOT warp — still before expiry.
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.DealNotExpired.selector);
        escrow.refundExpired(id);
    }

    function test_State_RefundSucceedsAtExactExpiry() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        // block.timestamp == expiration satisfies `block.timestamp < expiration == false`
        // so DealNotExpired is NOT reverted; the refund proceeds.
        vm.warp(d.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id); // must succeed
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.REFUNDED)
        );
    }

    function test_State_DealIdZeroReverts() public {
        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.acceptDeal(0);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.fundDeal(0);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.submitEvidence(0, EVIDENCE);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.approveAndRelease(0, REVIEW);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.refundExpired(0);
    }

    function test_State_DealIdBeyondTotalReverts() public {
        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.acceptDeal(9999);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.fundDeal(9999);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.submitEvidence(9999, EVIDENCE);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.approveAndRelease(9999, REVIEW);

        vm.expectRevert(ArcTradeProofEscrow.DealNotFound.selector);
        escrow.refundExpired(9999);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── Payment security ──────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function test_Pay_ZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidAmount.selector);
        escrow.createDeal(seller, 0, TERMS, _deadline());
    }

    function test_Pay_AboveMax() public {
        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidAmount.selector);
        escrow.createDeal(seller, AMT_500 + 1, TERMS, _deadline());
    }

    function test_Pay_InsufficientAllowance() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);

        // Approve 0 — no allowance.
        vm.prank(buyer);
        usdc.approve(address(escrow), 0);

        vm.prank(buyer);
        vm.expectRevert(); // SafeERC20 wraps the ERC-20 revert
        escrow.fundDeal(id);
    }

    function test_Pay_FeeOnTransfer() public {
        // Enable 10% fee so the escrow receives less than deal.amount → DepositMismatch.
        usdc.setFeePercent(1000);

        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);

        uint256 actualReceived = (AMT_100 * (10_000 - 1000)) / 10_000; // 900_000
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcTradeProofEscrow.DepositMismatch.selector,
                AMT_100,
                actualReceived
            )
        );
        escrow.fundDeal(id);
    }

    function test_Pay_TransferFailOnFund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);

        usdc.setFailTransfers(true);

        vm.prank(buyer);
        vm.expectRevert(); // SafeERC20 bubbles "TRANSFER_FAIL"
        escrow.fundDeal(id);
    }

    function test_Pay_TransferFailOnRelease() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        // Enable failure AFTER the fund step.
        usdc.setFailTransfers(true);

        uint256 lockedBefore = escrow.totalEscrowLocked();

        vm.prank(buyer);
        vm.expectRevert();
        escrow.approveAndRelease(id, REVIEW);

        // The entire transaction reverted → state is unchanged.
        assertEq(escrow.totalEscrowLocked(), lockedBefore, "locked unchanged");
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.EVIDENCE_SUBMITTED),
            "status unchanged"
        );
    }

    function test_Pay_TransferFailOnRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        uint256 lockedBefore = escrow.totalEscrowLocked();

        // Enable failure AFTER funding.
        usdc.setFailTransfers(true);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        vm.prank(buyer);
        vm.expectRevert();
        escrow.refundExpired(id);

        // Transaction reverted → state unchanged.
        assertEq(escrow.totalEscrowLocked(), lockedBefore, "locked unchanged");
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.FUNDED),
            "status unchanged"
        );
    }

    function test_Pay_WrongDecimals() public {
        // Etch a BadDecimalsMock (decimals()=18) to the canonical USDC address.
        BadDecimalsMock bad = new BadDecimalsMock();
        vm.etch(USDC_ADDR, address(bad).code);

        vm.expectRevert(
            abi.encodeWithSelector(
                ArcTradeProofEscrow.WrongUsdcDecimals.selector,
                uint8(18),
                uint8(6)
            )
        );
        new ArcTradeProofEscrow(USDC_ADDR);

        // Restore good mock so subsequent tests (if any) are unaffected.
        MockERC20 temp = new MockERC20();
        vm.etch(USDC_ADDR, address(temp).code);
    }

    // ── Reentrancy tests ─────────────────────────────────────────────────
    //
    // The escrow follows CEI (Checks-Effects-Interactions): state is updated
    // BEFORE the external token call.  When the mock's callback re-enters the
    // escrow, the nonReentrant guard fires (ReentrancyGuardReentrantCall) and
    // the inner call reverts.  The mock intentionally swallows that inner
    // revert (to simulate a malicious token that ignores sub-call failures) and
    // returns `true` to the outer call, which then completes normally.
    //
    // Therefore the correct property to test is NOT "the outer tx reverts" but
    // rather "the re-entry was rejected: state was only mutated once and is
    // self-consistent".  We verify:
    //   - The deal reached its expected terminal state exactly once.
    //   - totalEscrowLocked is consistent with that single state change.
    //   - The buyer/seller balances reflect exactly one transfer.

    function test_Pay_ReentrancyOnFund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        // Approve enough for two fund attempts — the second (re-entrant) one
        // should be rejected by nonReentrant, not by allowance.
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100 * 2);

        // Arm the hook: during transferFrom in fundDeal, re-enter fundDeal.
        bytes memory reentrantCall = abi.encodeWithSelector(
            ArcTradeProofEscrow.fundDeal.selector,
            id
        );
        usdc.setReentrantCall(address(escrow), reentrantCall);

        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        // Outer fundDeal should SUCCEED (CEI + nonReentrant: inner call was
        // blocked by the guard; mock swallows the inner revert).
        vm.prank(buyer);
        escrow.fundDeal(id);

        // State: funded exactly once.
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.FUNDED),
            "status FUNDED once"
        );
        assertEq(escrow.totalEscrowLocked(), AMT_100, "locked once");
        // Exactly one AMT_100 moved from buyer to escrow.
        assertEq(usdc.balanceOf(buyer),            buyerBefore  - AMT_100, "buyer debited once");
        assertEq(usdc.balanceOf(address(escrow)),  escrowBefore + AMT_100, "escrow credited once");
    }

    function test_Pay_ReentrancyOnRelease() public {
        uint256 id = _reachEvidenceSubmitted(buyer, seller, AMT_100);

        uint256 sellerBefore = usdc.balanceOf(seller);

        // Arm the hook: during safeTransfer(seller) in approveAndRelease,
        // re-enter approveAndRelease.  The deal is already RELEASED (CEI),
        // so the inner call would also hit InvalidState, but it hits
        // nonReentrant first.
        bytes memory reentrantCall = abi.encodeWithSelector(
            ArcTradeProofEscrow.approveAndRelease.selector,
            id,
            REVIEW
        );
        usdc.setReentrantCall(address(escrow), reentrantCall);

        // Outer approveAndRelease should SUCCEED.
        vm.prank(buyer);
        escrow.approveAndRelease(id, REVIEW);

        // State: released exactly once.
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.RELEASED),
            "status RELEASED once"
        );
        assertEq(escrow.totalEscrowLocked(), 0, "escrow fully drained");
        assertEq(usdc.balanceOf(seller), sellerBefore + AMT_100, "seller paid once");
    }

    function test_Pay_ReentrancyOnRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        vm.warp(d.expiration);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        // Arm the hook: during safeTransfer(buyer) in refundExpired,
        // re-enter refundExpired.  The deal is already REFUNDED (CEI),
        // so the inner call hits InvalidState (after nonReentrant).
        bytes memory reentrantCall = abi.encodeWithSelector(
            ArcTradeProofEscrow.refundExpired.selector,
            id
        );
        usdc.setReentrantCall(address(escrow), reentrantCall);

        // Outer refundExpired should SUCCEED.
        vm.prank(buyer);
        escrow.refundExpired(id);

        // State: refunded exactly once.
        assertEq(
            uint8(escrow.getDealStatus(id)),
            uint8(ArcTradeProofEscrow.DealStatus.REFUNDED),
            "status REFUNDED once"
        );
        assertEq(escrow.totalEscrowLocked(), 0, "escrow fully drained");
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMT_100, "buyer refunded once");
    }

    function test_Pay_DirectTransferNotTracked() public {
        // A direct ERC-20 transfer to the escrow address is NOT tracked in escrow liabilities.
        vm.prank(buyer);
        usdc.transfer(address(escrow), AMT_100);

        assertEq(escrow.totalEscrowLocked(), 0, "not tracked in liabilities");
    }

    // ── Constructor guard tests ───────────────────────────────────────────

    function test_Pay_WrongChainReverts() public {
        // Deploy on a non-Arc chain ID — should revert WrongChain.
        vm.chainId(1); // Ethereum mainnet — not an Arc chain
        vm.expectRevert(abi.encodeWithSelector(ArcTradeProofEscrow.WrongChain.selector, uint256(1)));
        new ArcTradeProofEscrow(USDC_ADDR);
        // Restore Arc Testnet chain ID for subsequent tests (setUp re-runs before each test).
    }

    function test_Pay_ArcMainnetChainIdAccepted() public {
        // Arc Mainnet chain ID 5042 should also be accepted by the constructor.
        vm.chainId(5042);
        ArcTradeProofEscrow mainnetEscrow = new ArcTradeProofEscrow(USDC_ADDR);
        assertEq(address(mainnetEscrow.usdc()), USDC_ADDR);
    }

    function test_Pay_WrongConstructorAddressReverts() public {
        // A non-canonical USDC address must revert WrongUsdcAddress.
        address fakeToken = address(0x1234);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcTradeProofEscrow.WrongUsdcAddress.selector,
                fakeToken,
                USDC_ADDR
            )
        );
        new ArcTradeProofEscrow(fakeToken);
    }

    function test_Pay_WrongDecimalsReverts() public {
        // Etch a mock that returns decimals()=18; constructor should revert WrongUsdcDecimals.
        BadDecimalsMock badMock = new BadDecimalsMock();
        vm.etch(USDC_ADDR, address(badMock).code);

        vm.expectRevert(
            abi.encodeWithSelector(
                ArcTradeProofEscrow.WrongUsdcDecimals.selector,
                uint8(18),
                uint8(6)
            )
        );
        new ArcTradeProofEscrow(USDC_ADDR);

        // Re-etch the good mock so the rest of the test teardown is clean.
        MockERC20 goodMock = new MockERC20();
        vm.etch(USDC_ADDR, address(goodMock).code);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── Accounting invariants ─────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function test_Acct_LockedEqualsSumOfFundedAmounts() public {
        // Three different buyers fund three deals with different amounts.
        address buyer3 = makeAddr("buyer3");
        usdc.mint(buyer3, 10_000_000);

        vm.prank(buyer);
        uint256 id1 = escrow.createDeal(seller,  AMT_025, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id1);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_025);
        vm.prank(buyer);
        escrow.fundDeal(id1);

        vm.prank(buyer2);
        uint256 id2 = escrow.createDeal(seller2, AMT_100, TERMS, _deadline());
        vm.prank(seller2);
        escrow.acceptDeal(id2);
        vm.prank(buyer2);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer2);
        escrow.fundDeal(id2);

        vm.prank(buyer3);
        uint256 id3 = escrow.createDeal(seller,  AMT_500, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id3);
        vm.prank(buyer3);
        usdc.approve(address(escrow), AMT_500);
        vm.prank(buyer3);
        escrow.fundDeal(id3);

        assertEq(
            escrow.totalEscrowLocked(),
            AMT_025 + AMT_100 + AMT_500,
            "sum of funded amounts"
        );
    }

    function test_Acct_ReleaseDecrementsExactlyOnce() public {
        uint256 id1 = _reachEvidenceSubmitted(buyer,  seller,  AMT_100);
        /* id2 stays locked — checked via totalEscrowLocked below */
        _reachEvidenceSubmitted(buyer2, seller2, AMT_500);

        vm.prank(buyer);
        escrow.approveAndRelease(id1, REVIEW);

        assertEq(escrow.totalEscrowLocked(), AMT_500, "only deal2 remains");
    }

    function test_Acct_RefundDecrementsExactlyOnce() public {
        // Fund both deals.
        vm.prank(buyer);
        uint256 id1 = escrow.createDeal(seller,  AMT_100, TERMS, _deadline());
        vm.prank(seller);
        escrow.acceptDeal(id1);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMT_100);
        vm.prank(buyer);
        escrow.fundDeal(id1);

        uint256 id2 = _reachEvidenceSubmitted(buyer2, seller2, AMT_500);
        // id2's expiry is ignored — we use id1's expiry for the warp.

        ArcTradeProofEscrow.Deal memory d1 = escrow.getDeal(id1);
        vm.warp(d1.expiration);

        vm.prank(buyer);
        escrow.refundExpired(id1);

        assertEq(escrow.totalEscrowLocked(), AMT_500, "only deal2 remains");
        // id2 is still in EVIDENCE_SUBMITTED and locked.
        assertEq(
            uint8(escrow.getDealStatus(id2)),
            uint8(ArcTradeProofEscrow.DealStatus.EVIDENCE_SUBMITTED)
        );
    }

    function test_Acct_FourMaxDeals_FifthReverts() public {
        // We need 4 different buyers each funding AMT_500 (5 USDC each = 20 USDC total).
        address[4] memory buyers;
        address[4] memory sellers;
        uint256[4] memory ids;

        for (uint256 i = 0; i < 4; i++) {
            buyers[i]  = makeAddr(string(abi.encodePacked("bigBuyer",  i)));
            sellers[i] = makeAddr(string(abi.encodePacked("bigSeller", i)));
            usdc.mint(buyers[i], AMT_500);

            vm.prank(buyers[i]);
            ids[i] = escrow.createDeal(sellers[i], AMT_500, TERMS, _deadline());
            vm.prank(sellers[i]);
            escrow.acceptDeal(ids[i]);
            vm.prank(buyers[i]);
            usdc.approve(address(escrow), AMT_500);
            vm.prank(buyers[i]);
            escrow.fundDeal(ids[i]);
        }

        assertEq(escrow.totalEscrowLocked(), MAX_ESCROW, "cap reached");

        // Fifth deal — escrow is at max cap.
        address buyer5  = makeAddr("bigBuyer5");
        address seller5 = makeAddr("bigSeller5");
        usdc.mint(buyer5, AMT_500);

        vm.prank(buyer5);
        uint256 id5 = escrow.createDeal(seller5, AMT_500, TERMS, _deadline());
        vm.prank(seller5);
        escrow.acceptDeal(id5);
        vm.prank(buyer5);
        usdc.approve(address(escrow), AMT_500);

        vm.prank(buyer5);
        vm.expectRevert(ArcTradeProofEscrow.EscrowLimitExceeded.selector);
        escrow.fundDeal(id5);
    }

    function test_Acct_FourMaxDeals_AfterReleaseCanFundFifth() public {
        address[4] memory buyers;
        address[4] memory sellers;
        uint256[4] memory ids;

        for (uint256 i = 0; i < 4; i++) {
            buyers[i]  = makeAddr(string(abi.encodePacked("relBuyer",  i)));
            sellers[i] = makeAddr(string(abi.encodePacked("relSeller", i)));
            usdc.mint(buyers[i], AMT_500);
            usdc.mint(sellers[i], 0); // ensure seller exists

            vm.prank(buyers[i]);
            ids[i] = escrow.createDeal(sellers[i], AMT_500, TERMS, _deadline());
            vm.prank(sellers[i]);
            escrow.acceptDeal(ids[i]);
            vm.prank(buyers[i]);
            usdc.approve(address(escrow), AMT_500);
            vm.prank(buyers[i]);
            escrow.fundDeal(ids[i]);
        }

        // Reach evidence on deal 0 and release it.
        vm.prank(sellers[0]);
        escrow.submitEvidence(ids[0], EVIDENCE);
        vm.prank(buyers[0]);
        escrow.approveAndRelease(ids[0], REVIEW);

        assertEq(escrow.totalEscrowLocked(), AMT_500 * 3, "one deal released");

        // Now fund the fifth deal.
        address buyer5  = makeAddr("relBuyer5");
        address seller5 = makeAddr("relSeller5");
        usdc.mint(buyer5, AMT_500);

        vm.prank(buyer5);
        uint256 id5 = escrow.createDeal(seller5, AMT_500, TERMS, _deadline());
        vm.prank(seller5);
        escrow.acceptDeal(id5);
        vm.prank(buyer5);
        usdc.approve(address(escrow), AMT_500);
        vm.prank(buyer5);
        escrow.fundDeal(id5);

        assertEq(escrow.totalEscrowLocked(), MAX_ESCROW, "back to cap");
    }

    function test_Acct_FourMaxDeals_AfterRefundCanFundFifth() public {
        address[4] memory buyers;
        address[4] memory sellers;
        uint256[4] memory ids;

        for (uint256 i = 0; i < 4; i++) {
            buyers[i]  = makeAddr(string(abi.encodePacked("rfBuyer",  i)));
            sellers[i] = makeAddr(string(abi.encodePacked("rfSeller", i)));
            usdc.mint(buyers[i], AMT_500);

            vm.prank(buyers[i]);
            ids[i] = escrow.createDeal(sellers[i], AMT_500, TERMS, _deadline());
            vm.prank(sellers[i]);
            escrow.acceptDeal(ids[i]);
            vm.prank(buyers[i]);
            usdc.approve(address(escrow), AMT_500);
            vm.prank(buyers[i]);
            escrow.fundDeal(ids[i]);
        }

        // Warp deal 0's expiry and refund it.
        ArcTradeProofEscrow.Deal memory d0 = escrow.getDeal(ids[0]);
        vm.warp(d0.expiration);

        vm.prank(buyers[0]);
        escrow.refundExpired(ids[0]);

        assertEq(escrow.totalEscrowLocked(), AMT_500 * 3, "one deal refunded");

        // Fund the fifth deal (create it with the current block.timestamp).
        address buyer5  = makeAddr("rfBuyer5");
        address seller5 = makeAddr("rfSeller5");
        usdc.mint(buyer5, AMT_500);

        vm.prank(buyer5);
        uint256 id5 = escrow.createDeal(seller5, AMT_500, TERMS, block.timestamp + 1 days);
        vm.prank(seller5);
        escrow.acceptDeal(id5);
        vm.prank(buyer5);
        usdc.approve(address(escrow), AMT_500);
        vm.prank(buyer5);
        escrow.fundDeal(id5);

        assertEq(escrow.totalEscrowLocked(), MAX_ESCROW, "back to cap");
    }

    // ─────────────────────────────────────────────────────────────────────
    // ── Fuzz tests ────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────

    function testFuzz_ValidAmounts(uint256 amount) public {
        amount = bound(amount, 1, AMT_500);

        usdc.mint(buyer, amount); // top up to be safe

        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, amount, TERMS, _deadline());

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.amount, amount);
        assertEq(uint8(d.status), uint8(ArcTradeProofEscrow.DealStatus.CREATED));
    }

    function testFuzz_InvalidAmounts(uint256 amount) public {
        amount = bound(amount, AMT_500 + 1, type(uint128).max);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidAmount.selector);
        escrow.createDeal(seller, amount, TERMS, _deadline());
    }

    function testFuzz_ValidDeadlines(uint256 offset) public {
        offset = bound(offset, 1, 7 days);

        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMT_100, TERMS, block.timestamp + offset);

        ArcTradeProofEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.expiration, block.timestamp + offset);
    }

    function testFuzz_InvalidDeadlines_TooFar(uint256 offset) public {
        offset = bound(offset, 7 days + 1, 365 days);

        vm.prank(buyer);
        vm.expectRevert(ArcTradeProofEscrow.InvalidDeadline.selector);
        escrow.createDeal(seller, AMT_100, TERMS, block.timestamp + offset);
    }
}
