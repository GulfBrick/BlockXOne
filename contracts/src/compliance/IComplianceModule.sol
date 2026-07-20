// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IComplianceModule
 * @notice Interface for pluggable compliance modules in ERC-3643
 * @dev Modules implement specific transfer restrictions that can be composed
 */
interface IComplianceModule {
    /**
     * @notice Checks if a transfer is allowed under this module's rules
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     * @return isAllowed True if the transfer is compliant
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool isAllowed);

    /**
     * @notice Called after a successful transfer to update module state if needed
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     */
    function transferred(
        address from,
        address to,
        uint256 amount
    ) external;

    /**
     * @notice Returns the name/description of this compliance module
     * @return name The module's name
     */
    function name() external pure returns (string memory name);
}
