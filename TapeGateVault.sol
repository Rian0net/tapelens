// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal TapeOut processor interface (TAP-02): evaluates a taped-out
///         circuit by id against packed input bytes and returns packed output
///         bytes. Bit 0 of byte 0 of the output is the circuit's single output.
///         (Matches ITapeOutProcessor.eval in ViperX's ITapeOut.sol; on chain the
///         real function is `view`, and calling it through this non-view
///         signature is compatible.)
interface ITapeOutProcessor {
    function eval(uint256 circuitId, bytes calldata input) external returns (bytes memory output);
}

/**
 * @title TapeGateVault
 * @notice Demo vault on X Layer whose withdrawals ("spends") are gated by two
 *         TapeOut NAND circuits instead of Solidity comparisons:
 *
 *           1. circuitIdLimit      - "amount_le_limit16" (32 in / 1 out, 113 NAND)
 *              Output 1 iff amount <= limit.
 *           2. circuitIdApprovals  - "majority_2of3" (3 in / 1 out, 6 NAND)
 *              Output 1 iff at least 2 of the 3 approval bits are set.
 *
 *         A spend runs only when BOTH circuits output 1. A rejection is a
 *         revert with a custom error (LimitExceeded / InsufficientApprovals);
 *         an approval moves the funds and emits SpendApproved. There is no
 *         SpendRejected event: rejected spends revert, so they never land.
 *
 *         Input bit mapping (TAP-02 section 5, LSB-first packing - identical to
 *         circuits/gen_tapegate.py, see circuits/TEST-REPORT.md):
 *
 *         Comparator input, 4 bytes:
 *           bits  0..15 = amount, bit i = circuit input i     (16-bit little-endian)
 *           bits 16..31 = limit,  bit i = circuit input 16+i  (16-bit little-endian)
 *           packed bytes = [amount_lo, amount_hi, limit_lo, limit_hi]
 *           `amount` and `limit` are SATURATED to 65535 before packing, never
 *           truncated: truncating would let 65537 reach the circuit as 1 and
 *           slip past the limit (the failure mode ViperX's TapeOutSignal
 *           library exists to prevent). Saturation keeps the comparison exact
 *           whenever amount and limit are both <= 65535, and fails closed
 *           (amount saturates to 65535 > any smaller limit) above that.
 *
 *         Majority input, 1 byte:
 *           bits 0..2 = approvalsMask bits (bit i = approval i); the circuit
 *           reads exactly 3 inputs, higher bits are ignored by the evaluator.
 *
 *         Funds: plain demo ledger. Native OKB sent to receive() (or deposit())
 *         is credited to the sender's internal balance; spend() debits it and
 *         sends the OKB back out. This is hackathon demo accounting, not a
 *         production vault (no reentrancy guard beyond checks-effects-
 *         interactions ordering, no ERC-20 support).
 */
contract TapeGateVault {
    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    ITapeOutProcessor public immutable processor;

    /// @notice Circuit id (on `processor`) of the amount <= limit comparator.
    uint256 public circuitIdLimit;
    /// @notice Circuit id (on `processor`) of the 2-of-3 majority circuit.
    uint256 public circuitIdApprovals;
    /// @notice Current spend limit, in the same unit as `amount` (wei of OKB).
    /// @dev Compared inside the circuit at 16-bit width: see saturation note above.
    uint256 public limit;

    address public owner;

    /// @notice Internal demo ledger: OKB credited per account.
    mapping(address => uint256) public balanceOf;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event Deposited(address indexed account, uint256 amount);
    event SpendApproved(address indexed account, uint256 amount, uint8 approvalsMask);
    event LimitUpdated(uint256 newLimit);
    event CircuitsUpdated(uint256 circuitIdLimit, uint256 circuitIdApprovals);

    // ------------------------------------------------------------------
    // Errors (a rejected spend reverts with one of these)
    // ------------------------------------------------------------------

    error NotOwner();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 required);
    /// @dev The comparator circuit output 0: amount exceeds limit.
    error LimitExceeded(uint256 amount, uint256 limit);
    /// @dev The majority circuit output 0: fewer than 2 approval bits set.
    error InsufficientApprovals(uint8 approvalsMask);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address processor_, uint256 circuitIdLimit_, uint256 circuitIdApprovals_, uint256 limit_) {
        processor = ITapeOutProcessor(processor_);
        circuitIdLimit = circuitIdLimit_;
        circuitIdApprovals = circuitIdApprovals_;
        limit = limit_;
        owner = msg.sender;
    }

    // ------------------------------------------------------------------
    // Funding (demo ledger)
    // ------------------------------------------------------------------

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------
    // Owner configuration
    // ------------------------------------------------------------------

    function setLimit(uint256 newLimit) external onlyOwner {
        limit = newLimit;
        emit LimitUpdated(newLimit);
    }

    function setCircuits(uint256 circuitIdLimit_, uint256 circuitIdApprovals_) external onlyOwner {
        circuitIdLimit = circuitIdLimit_;
        circuitIdApprovals = circuitIdApprovals_;
        emit CircuitsUpdated(circuitIdLimit_, circuitIdApprovals_);
    }

    // ------------------------------------------------------------------
    // Spend: gated by the two TapeOut circuits
    // ------------------------------------------------------------------

    /**
     * @notice Withdraw `amount` of the caller's credited OKB if the TapeOut
     *         circuits approve: amount <= limit AND >= 2 of 3 approvals.
     * @param amount       Amount to spend (wei of OKB).
     * @param approvalsMask Approval bits; bit i counts as approval i.
     */
    function spend(uint256 amount, uint8 approvalsMask) external {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (available < amount) revert InsufficientBalance(available, amount);

        // Gate 1: comparator circuit - amount <= limit.
        if (!_evalBit(circuitIdLimit, _packComparator(amount, limit))) {
            revert LimitExceeded(amount, limit);
        }
        // Gate 2: majority circuit - at least 2 of 3 approval bits.
        if (!_evalBit(circuitIdApprovals, _packMajority(approvalsMask))) {
            revert InsufficientApprovals(approvalsMask);
        }

        balanceOf[msg.sender] = available - amount;
        (bool ok,) = msg.sender.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit SpendApproved(msg.sender, amount, approvalsMask);
    }

    // ------------------------------------------------------------------
    // Circuit plumbing
    // ------------------------------------------------------------------

    /// @dev Runs one circuit and returns its single output bit. An empty or
    ///      zero output is a rejection (fail closed).
    function _evalBit(uint256 circuitId, bytes memory input) internal returns (bool) {
        bytes memory out = processor.eval(circuitId, input);
        return out.length != 0 && (uint8(out[0]) & 1) == 1;
    }

    /// @dev Packs (amount, limit) as the comparator's 32 input bits, LSB-first:
    ///      bytes [amount_lo, amount_hi, limit_lo, limit_hi]. Both values are
    ///      saturated to 16 bits (see contract-level note).
    function _packComparator(uint256 amount, uint256 limit_) internal pure returns (bytes memory input) {
        uint256 a = amount > 0xffff ? 0xffff : amount;
        uint256 l = limit_ > 0xffff ? 0xffff : limit_;
        input = new bytes(4);
        input[0] = bytes1(uint8(a));
        input[1] = bytes1(uint8(a >> 8));
        input[2] = bytes1(uint8(l));
        input[3] = bytes1(uint8(l >> 8));
    }

    /// @dev Packs the approval mask as the majority circuit's 3 input bits:
    ///      one byte, bit i = approval i.
    function _packMajority(uint8 approvalsMask) internal pure returns (bytes memory input) {
        input = new bytes(1);
        input[0] = bytes1(approvalsMask & 0x07);
    }
}
