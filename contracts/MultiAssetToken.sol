// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title MultiAssetToken
 * @dev ERC1155 token contract for multi-asset tokenization platform
 * Supports tokenization of various asset types (real estate, commodities, art, etc.)
 */
contract MultiAssetToken is ERC1155, AccessControl, Pausable {
    using Counters for Counters.Counter;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER_ROLE");

    Counters.Counter private _tokenIdCounter;

    // Asset metadata structure
    struct AssetMetadata {
        string name;
        string assetType; // real_estate, commodity, art, security, etc.
        string description;
        uint256 totalSupply;
        uint256 valuePerToken; // in wei
        bool isActive;
        address creator;
        uint256 createdAt;
    }

    // Mapping from token ID to asset metadata
    mapping(uint256 => AssetMetadata) public assets;

    // Events
    event AssetCreated(
        uint256 indexed tokenId,
        string name,
        string assetType,
        uint256 totalSupply,
        address creator
    );
    
    event AssetUpdated(uint256 indexed tokenId, string name, string description);
    event AssetDeactivated(uint256 indexed tokenId);

    constructor(string memory uri) ERC1155(uri) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(ASSET_MANAGER_ROLE, msg.sender);
    }

    /**
     * @dev Creates a new tokenized asset
     * @param name Asset name
     * @param assetType Type of asset
     * @param description Asset description
     * @param totalSupply Total number of tokens to mint
     * @param valuePerToken Value per token in wei
     * @param to Address to receive the initial tokens
     */
    function createAsset(
        string memory name,
        string memory assetType,
        string memory description,
        uint256 totalSupply,
        uint256 valuePerToken,
        address to
    ) public onlyRole(ASSET_MANAGER_ROLE) returns (uint256) {
        require(totalSupply > 0, "Total supply must be greater than 0");
        require(to != address(0), "Invalid recipient address");

        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();

        assets[tokenId] = AssetMetadata({
            name: name,
            assetType: assetType,
            description: description,
            totalSupply: totalSupply,
            valuePerToken: valuePerToken,
            isActive: true,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        _mint(to, tokenId, totalSupply, "");

        emit AssetCreated(tokenId, name, assetType, totalSupply, msg.sender);

        return tokenId;
    }

    /**
     * @dev Mints additional tokens for an existing asset
     */
    function mintAsset(
        address to,
        uint256 tokenId,
        uint256 amount
    ) public onlyRole(MINTER_ROLE) {
        require(assets[tokenId].isActive, "Asset is not active");
        assets[tokenId].totalSupply += amount;
        _mint(to, tokenId, amount, "");
    }

    /**
     * @dev Burns tokens
     */
    function burnAsset(
        address from,
        uint256 tokenId,
        uint256 amount
    ) public {
        require(
            from == msg.sender || isApprovedForAll(from, msg.sender),
            "Not authorized to burn"
        );
        assets[tokenId].totalSupply -= amount;
        _burn(from, tokenId, amount);
    }

    /**
     * @dev Updates asset metadata
     */
    function updateAsset(
        uint256 tokenId,
        string memory name,
        string memory description
    ) public onlyRole(ASSET_MANAGER_ROLE) {
        require(assets[tokenId].isActive, "Asset does not exist");
        assets[tokenId].name = name;
        assets[tokenId].description = description;
        emit AssetUpdated(tokenId, name, description);
    }

    /**
     * @dev Deactivates an asset
     */
    function deactivateAsset(uint256 tokenId) public onlyRole(ASSET_MANAGER_ROLE) {
        require(assets[tokenId].isActive, "Asset already inactive");
        assets[tokenId].isActive = false;
        emit AssetDeactivated(tokenId);
    }

    /**
     * @dev Gets asset metadata
     */
    function getAsset(uint256 tokenId) public view returns (AssetMetadata memory) {
        return assets[tokenId];
    }

    /**
     * @dev Pauses all token transfers
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Hook that is called before any token transfer
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override whenNotPaused {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }

    /**
     * @dev See {IERC165-supportsInterface}
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
