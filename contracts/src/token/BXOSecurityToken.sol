// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "../compliance/IModularCompliance.sol";
import "../identity/IdentityRegistry.sol";

/// @title BXOSecurityToken
/// @notice ERC-3643-style restricted token with agent controls and modular compliance hooks.
contract BXOSecurityToken is ERC20, AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    uint8 private immutable _tokenDecimals;

    IdentityRegistry public identityRegistry;
    IModularCompliance public compliance;

    mapping(address => bool) private _frozen;

    event AddressFrozen(address indexed account);
    event AddressUnfrozen(address indexed account);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent);
    event RecoverySuccess(address indexed lostWallet, address indexed newWallet, uint256 amount);
    event IdentityRegistryUpdated(address indexed identityRegistry);
    event ComplianceUpdated(address indexed compliance);

    error AccessDenied();
    error AccountFrozen(address account);
    error ComplianceCheckFailed();
    error InvalidIdentityRegistry();
    error InvalidCompliance();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin,
        address identityRegistry_,
        address compliance_
    ) ERC20(name_, symbol_) {
        if (admin == address(0)) revert AccessDenied();
        if (identityRegistry_ == address(0)) revert InvalidIdentityRegistry();
        if (compliance_ == address(0)) revert InvalidCompliance();

        _tokenDecimals = decimals_;
        identityRegistry = IdentityRegistry(identityRegistry_);
        compliance = IModularCompliance(compliance_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _burn(from, amount);
    }

    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        require(recipients.length == amounts.length, "Array length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }

    function batchBurn(address[] calldata holders, uint256[] calldata amounts) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        require(holders.length == amounts.length, "Array length mismatch");

        for (uint256 i = 0; i < holders.length; i++) {
            _burn(holders[i], amounts[i]);
        }
    }

    function freezeAddress(address account) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _frozen[account] = true;
        emit AddressFrozen(account);
    }

    function unfreezeAddress(address account) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _frozen[account] = false;
        emit AddressUnfrozen(account);
    }

    function batchFreezeAddress(address[] calldata accounts) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        for (uint256 i = 0; i < accounts.length; i++) {
            _frozen[accounts[i]] = true;
            emit AddressFrozen(accounts[i]);
        }
    }

    function batchUnfreezeAddress(address[] calldata accounts) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        for (uint256 i = 0; i < accounts.length; i++) {
            _frozen[accounts[i]] = false;
            emit AddressUnfrozen(accounts[i]);
        }
    }

    function isFrozen(address account) external view returns (bool) {
        return _frozen[account];
    }

    function pause() external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _pause();
    }

    function unpause() external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _unpause();
    }

    function forcedTransfer(address from, address to, uint256 amount) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _transferIgnoringRestrictions(from, to, amount);
        emit ForcedTransfer(from, to, amount, msg.sender);
    }

    function recoveryAddress(address lostWallet, address newWallet, uint256 amount) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _transferIgnoringRestrictions(lostWallet, newWallet, amount);
        emit RecoverySuccess(lostWallet, newWallet, amount);
    }

    function setIdentityRegistry(address identityRegistry_) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        if (identityRegistry_ == address(0)) revert InvalidIdentityRegistry();
        identityRegistry = IdentityRegistry(identityRegistry_);
        emit IdentityRegistryUpdated(identityRegistry_);
    }

    function setCompliance(address compliance_) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        if (compliance_ == address(0)) revert InvalidCompliance();
        compliance = IModularCompliance(compliance_);
        emit ComplianceUpdated(compliance_);
    }

    function _update(address from, address to, uint256 amount) internal override {
        _requireNotPaused();

        if (from != address(0) && to != address(0)) {
            if (_frozen[from]) revert AccountFrozen(from);
            if (_frozen[to]) revert AccountFrozen(to);
            if (!compliance.canTransfer(from, to, amount)) revert ComplianceCheckFailed();
        }

        super._update(from, to, amount);

        if (from != address(0) && to != address(0)) {
            compliance.transferred(from, to, amount);
        }
    }

    function _transferIgnoringRestrictions(address from, address to, uint256 amount) private {
        ERC20._update(from, to, amount);
    }
}
