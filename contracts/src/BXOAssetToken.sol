// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IBXOComplianceRegistry {
    function isWhitelisted(address account) external view returns (bool);
    function isBlacklisted(address account) external view returns (bool);
}

/// @title BXOAssetToken
/// @notice Restricted ERC-20 issued for one registered asset.
contract BXOAssetToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    address public immutable issuer;
    IBXOComplianceRegistry public immutable complianceRegistry;

    error AccessDenied();
    error InvalidAddress();
    error ComplianceCheckFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        address admin,
        address issuer_,
        address complianceRegistry_
    ) ERC20(name_, symbol_) {
        if (admin == address(0) || issuer_ == address(0) || complianceRegistry_ == address(0)) {
            revert InvalidAddress();
        }

        issuer = issuer_;
        complianceRegistry = IBXOComplianceRegistry(complianceRegistry_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(MINTER_ROLE, issuer_);
        _grantRole(BURNER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external {
        if (!hasRole(MINTER_ROLE, msg.sender)) revert AccessDenied();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (!hasRole(BURNER_ROLE, msg.sender)) revert AccessDenied();
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) _requireCompliant(from);
        if (to != address(0)) _requireCompliant(to);
        super._update(from, to, amount);
    }

    function _requireCompliant(address account) private view {
        if (
            !complianceRegistry.isWhitelisted(account) ||
            complianceRegistry.isBlacklisted(account)
        ) {
            revert ComplianceCheckFailed();
        }
    }
}
