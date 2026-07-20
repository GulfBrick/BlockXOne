// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IModularCompliance.sol";

/**
 * @title ModularCompliance
 * @notice Modular compliance engine for composing transfer restrictions
 * @dev Allows plugging in multiple compliance modules that work together
 */
contract ModularCompliance is IModularCompliance, Ownable {
    // Modules mapping and list
    mapping(address => bool) private moduleExists;
    address[] private modulesList;

    // Events
    event ModuleAdded(address indexed module);
    event ModuleRemoved(address indexed module);

    // Errors
    error ModuleAlreadyExists(address module);
    error ModuleNotFound(address module);
    error InvalidModule();

    /**
     * @notice Initializes the ModularCompliance contract
     */
    constructor() Ownable(msg.sender) {}

    /**
     * @notice Adds a compliance module
     * @param module The module to add
     */
    function addModule(IComplianceModule module) external onlyOwner {
        if (address(module) == address(0)) revert InvalidModule();
        if (moduleExists[address(module)]) revert ModuleAlreadyExists(address(module));

        moduleExists[address(module)] = true;
        modulesList.push(address(module));

        emit ModuleAdded(address(module));
    }

    /**
     * @notice Removes a compliance module
     * @param moduleAddress The address of the module to remove
     */
    function removeModule(address moduleAddress) external onlyOwner {
        if (!moduleExists[moduleAddress]) revert ModuleNotFound(moduleAddress);

        moduleExists[moduleAddress] = false;

        // Remove from list
        for (uint256 i = 0; i < modulesList.length; i++) {
            if (modulesList[i] == moduleAddress) {
                modulesList[i] = modulesList[modulesList.length - 1];
                modulesList.pop();
                break;
            }
        }

        emit ModuleRemoved(moduleAddress);
    }

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
    ) external view returns (bool isAllowed) {
        for (uint256 i = 0; i < modulesList.length; i++) {
            IComplianceModule module = IComplianceModule(modulesList[i]);
            if (!module.canTransfer(from, to, amount)) {
                return false;
            }
        }
        return true;
    }

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
    ) external {
        for (uint256 i = 0; i < modulesList.length; i++) {
            IComplianceModule module = IComplianceModule(modulesList[i]);
            module.transferred(from, to, amount);
        }
    }

    /**
     * @notice Returns all compliance modules
     * @return modules Array of module addresses
     */
    function getModules() external view returns (address[] memory modules) {
        return modulesList;
    }
}
