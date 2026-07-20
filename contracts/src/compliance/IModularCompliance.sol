// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IComplianceModule.sol";

/**
 * @title IModularCompliance
 * @notice Interface for the modular compliance engine in ERC-3643
 * @dev Allows composition of multiple compliance modules
 */
interface IModularCompliance {
    /**
     * @notice Adds a compliance module
     * @param module The module to add
     */
    function addModule(IComplianceModule module) external;

    /**
     * @notice Removes a compliance module
     * @param moduleAddress The address of the module to remove
     */
    function removeModule(address moduleAddress) external;

    /**
     * @notice Checks if a transfer is allowed by all modules
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     * @return isAllowed True if all modules approve the transfer
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool isAllowed);

    /**
     * @notice Called after a successful transfer
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
     * @notice Returns all compliance modules
     * @return modules Array of module addresses
     */
    function getModules() external view returns (address[] memory modules);
}
