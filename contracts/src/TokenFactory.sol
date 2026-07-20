// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

import "./AssetRegistry.sol";
import "./BXOAssetToken.sol";
import "./BXOComplianceRegistry.sol";

/// @title TokenFactory
/// @notice Deploys new asset tokens and registers them with AssetRegistry.
contract TokenFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    AssetRegistry public immutable assetRegistry;

    event AssetTokenDeployed(
        bytes32 indexed assetId,
        address indexed token,
        address indexed complianceRegistry,
        address issuer
    );

    error AccessDenied();
    error InvalidAddress();

    constructor(address admin, address assetRegistry_) {
        if (admin == address(0) || assetRegistry_ == address(0)) revert InvalidAddress();
        assetRegistry = AssetRegistry(assetRegistry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEPLOYER_ROLE, admin);
    }

    function createAssetToken(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        string calldata assetType,
        string calldata metadataURI,
        address issuer
    ) external returns (address token, address complianceRegistry) {
        if (!hasRole(DEPLOYER_ROLE, msg.sender)) revert AccessDenied();
        if (issuer == address(0)) revert InvalidAddress();

        BXOComplianceRegistry registry = new BXOComplianceRegistry(msg.sender);
        BXOAssetToken assetToken = new BXOAssetToken(name, symbol, msg.sender, issuer, address(registry));

        assetRegistry.registerAsset(assetId, name, assetType, metadataURI, issuer, address(assetToken));

        emit AssetTokenDeployed(assetId, address(assetToken), address(registry), issuer);
        return (address(assetToken), address(registry));
    }
}
