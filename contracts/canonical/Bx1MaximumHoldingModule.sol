// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@erc3643org/erc-3643/contracts/compliance/modular/modules/AbstractModule.sol";
import "@erc3643org/erc-3643/contracts/compliance/modular/IModularCompliance.sol";
import "@erc3643org/erc-3643/contracts/token/IToken.sol";

/**
 * SOURCE CANDIDATE, NOT ADMITTED; no legal or eligibility decision is implied.
 * Immutable product-selected base-unit cap, enforced before and after movement.
 * Binding follows the pinned upstream interface; no configurable administrator,
 * proxy, limit setter or exceptional bypass is introduced.
 */
contract Bx1MaximumHoldingModule is AbstractModule {
    uint256 public immutable maximumHolding;

    constructor(uint256 maximumHoldingBaseUnits) {
        require(maximumHoldingBaseUnits > 0, "positive holding limit required");
        maximumHolding = maximumHoldingBaseUnits;
    }

    function moduleCheck(address from, address to, uint256 value, address compliance)
        external view override onlyBoundCompliance(compliance) returns (bool)
    {
        require(msg.sender == compliance, "only selected compliance can check");
        address token = _boundToken(compliance);
        if (value == 0) return false;
        if (to == address(0)) return from != address(0); // burn, never mint to zero
        uint256 balance = IToken(token).balanceOf(to);
        if (balance > maximumHolding) return false;
        // A self-transfer does not increase the recipient's final balance.
        return from == to || value <= maximumHolding - balance;
    }

    function moduleTransferAction(address from, address to, uint256 value)
        external view override onlyComplianceCall
    {
        require(from != address(0) && to != address(0) && value > 0, "invalid transfer");
        _requirePostBalance(to);
    }

    function moduleMintAction(address to, uint256 value)
        external view override onlyComplianceCall
    {
        require(to != address(0) && value > 0, "invalid mint");
        _requirePostBalance(to);
    }

    function moduleBurnAction(address from, uint256 value)
        external view override onlyComplianceCall
    {
        require(from != address(0) && value > 0, "invalid burn");
        _boundToken(msg.sender);
        // A burn must remain possible even if a pre-existing holding exceeds cap.
    }

    function canComplianceBind(address compliance) external pure override returns (bool) {
        return compliance != address(0);
    }

    function isPlugAndPlay() external pure override returns (bool) { return true; }
    function name() external pure override returns (string memory) { return "Bx1MaximumHoldingModule"; }

    function _boundToken(address compliance) private view returns (address token) {
        token = IModularCompliance(compliance).getTokenBound();
        require(token != address(0) && token.code.length > 0, "token not bound");
        require(IModularCompliance(compliance).isModuleBound(address(this)), "module not attached");
        require(address(IToken(token).compliance()) == compliance, "token/compliance mismatch");
    }

    function _requirePostBalance(address recipient) private view {
        address token = _boundToken(msg.sender);
        // Upstream forced transfer/recovery can skip canTransfer, but still call
        // transferred after changing balances. A failing hook rolls it all back.
        require(IToken(token).balanceOf(recipient) <= maximumHolding, "maximum holding exceeded");
    }
}
