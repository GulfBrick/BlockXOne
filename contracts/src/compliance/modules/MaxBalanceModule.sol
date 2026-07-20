// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../IComplianceModule.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaxBalanceModule
 * @notice Compliance module that enforces maximum token balance per holder
 * @dev Prevents transfers that would exceed the maximum balance limit
 */
contract MaxBalanceModule is IComplianceModule, Ownable {
    // Maximum balance limit
    uint256 public maxBalance;

    // Token reference (set during initialization)
    IERC20 public token;

    // Events
    event MaxBalanceUpdated(uint256 newMaxBalance);
    event TokenSet(address indexed token);

    // Errors
    error InvalidMaxBalance();
    error MaxBalanceExceeded(address to, uint256 balance, uint256 maxBalance);
    error TokenNotSet();

    /**
     * @notice Initializes the MaxBalanceModule
     * @param initialMaxBalance The initial maximum balance limit
     * @param token_ Address of the token being restricted
     */
    constructor(uint256 initialMaxBalance, address token_) Ownable(msg.sender) {
        require(initialMaxBalance > 0, "Invalid initial max balance");
        require(token_ != address(0), "Invalid token");

        maxBalance = initialMaxBalance;
        token = IERC20(token_);
    }

    /**
     * @notice Sets the maximum balance limit
     * @param newMaxBalance The new maximum balance
     */
    function setMaxBalance(uint256 newMaxBalance) external onlyOwner {
        if (newMaxBalance == 0) revert InvalidMaxBalance();

        maxBalance = newMaxBalance;
        emit MaxBalanceUpdated(newMaxBalance);
    }

    /**
     * @notice Sets the token address
     * @param token_ Address of the token
     */
    function setToken(address token_) external onlyOwner {
        require(token_ != address(0), "Invalid token");
        token = IERC20(token_);
        emit TokenSet(token_);
    }

    /**
     * @notice Checks if a transfer is allowed based on max balance constraints
     * @param from The sender address (unused)
     * @param to The recipient address
     * @param amount The transfer amount
     * @return isAllowed True if transfer would not exceed max balance
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view override returns (bool isAllowed) {
        if (address(token) == address(0)) revert TokenNotSet();

        // Get recipient's current balance
        uint256 currentBalance = token.balanceOf(to);
        uint256 newBalance = currentBalance + amount;

        // Check if new balance would exceed limit
        if (newBalance > maxBalance) {
            return false;
        }

        return true;
    }

    /**
     * @notice Called after a successful transfer (no-op for this module)
     * @param from The sender address (unused)
     * @param to The recipient address (unused)
     * @param amount The transfer amount (unused)
     */
    function transferred(
        address from,
        address to,
        uint256 amount
    ) external override {
        // No state changes needed after transfer
    }

    /**
     * @notice Returns the name of this compliance module
     * @return name The module name
     */
    function name() external pure override returns (string memory name) {
        return "MaxBalanceModule";
    }

    /**
     * @notice Gets the current maximum balance limit
     * @return limit The maximum balance
     */
    function getMaxBalance() external view returns (uint256 limit) {
        return maxBalance;
    }
}
