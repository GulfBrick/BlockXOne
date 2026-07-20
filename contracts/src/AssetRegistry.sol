// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AssetRegistry
/// @notice Stores metadata and ownership references for asset-backed tokens.
contract AssetRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Asset {
        string name;
        string assetType;
        string metadataURI; // IPFS or off-chain reference
        address issuer;
        address token;
        uint256 createdAt;
        bool active;
    }

    mapping(bytes32 => Asset) private _assets;
    mapping(address => bytes32) private _assetByToken;

    event AssetRegistered(bytes32 indexed assetId, address indexed token, address indexed issuer);
    event AssetMetadataUpdated(bytes32 indexed assetId, string metadataURI);
    event AssetStatusUpdated(bytes32 indexed assetId, bool active);

    error AccessDenied();
    error AssetExists();
    error AssetNotFound();
    error InvalidAddress();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    function registerAsset(
        bytes32 assetId,
        string calldata name,
        string calldata assetType,
        string calldata metadataURI,
        address issuer,
        address token
    ) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (issuer == address(0) || token == address(0)) revert InvalidAddress();
        if (_assets[assetId].token != address(0)) revert AssetExists();

        _assets[assetId] = Asset({
            name: name,
            assetType: assetType,
            metadataURI: metadataURI,
            issuer: issuer,
            token: token,
            createdAt: block.timestamp,
            active: true
        });
        _assetByToken[token] = assetId;
        emit AssetRegistered(assetId, token, issuer);
    }

    function updateMetadata(bytes32 assetId, string calldata metadataURI) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (_assets[assetId].token == address(0)) revert AssetNotFound();
        _assets[assetId].metadataURI = metadataURI;
        emit AssetMetadataUpdated(assetId, metadataURI);
    }

    function setActive(bytes32 assetId, bool active) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (_assets[assetId].token == address(0)) revert AssetNotFound();
        _assets[assetId].active = active;
        emit AssetStatusUpdated(assetId, active);
    }

    function getAsset(bytes32 assetId) external view returns (Asset memory) {
        if (_assets[assetId].token == address(0)) revert AssetNotFound();
        return _assets[assetId];
    }

    function assetIdForToken(address token) external view returns (bytes32) {
        return _assetByToken[token];
    }
}
