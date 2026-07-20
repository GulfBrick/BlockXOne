// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IWhitelistRegistry {
    function isWhitelisted(address account) external view returns (bool);
}

contract RestrictedSecurityToken is ERC20, AccessControl {
    bytes32 public constant MINT_ROLE = keccak256("MINT_ROLE");
    bytes32 public constant BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 public constant FREEZE_ROLE = keccak256("FREEZE_ROLE");
    bytes32 public constant FORCE_TRANSFER_ROLE = keccak256("FORCE_TRANSFER_ROLE");

    IWhitelistRegistry public immutable registry;

    mapping(address => bool) public frozen;

    event Frozen(address indexed account, bool status);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        address admin,
        address registry_
    ) ERC20(name_, symbol_) {
        registry = IWhitelistRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINT_ROLE, admin);
        _grantRole(BURN_ROLE, admin);
        _grantRole(FREEZE_ROLE, admin);
        _grantRole(FORCE_TRANSFER_ROLE, admin);
    }

    function setFrozen(address account, bool status) external onlyRole(FREEZE_ROLE) {
        frozen[account] = status;
        emit Frozen(account, status);
    }

    function mint(address to, uint256 amount) external onlyRole(MINT_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(BURN_ROLE) {
        _burn(from, amount);
    }

    function controllerTransfer(address from, address to, uint256 amount) external onlyRole(FORCE_TRANSFER_ROLE) {
        _transfer(from, to, amount);
        emit ForcedTransfer(from, to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        // Mint/burn bypass whitelist for the zero address
        if (from != address(0)) {
            require(!frozen[from], "SENDER_FROZEN");
            require(registry.isWhitelisted(from), "SENDER_NOT_WHITELISTED");
        }
        if (to != address(0)) {
            require(!frozen[to], "RECEIVER_FROZEN");
            require(registry.isWhitelisted(to), "RECEIVER_NOT_WHITELISTED");
        }

        super._update(from, to, amount);
    }
}
