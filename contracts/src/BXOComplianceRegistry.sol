// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title BXOComplianceRegistry
/// @notice Maintains whitelist/blacklist for transfer-restricted assets.
contract BXOComplianceRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    mapping(address => bool) private _whitelisted;
    mapping(address => bool) private _blacklisted;

    event WhitelistUpdated(address indexed account, bool status);
    event BlacklistUpdated(address indexed account, bool status);

    error AccessDenied();
    error InvalidAccount();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    function isWhitelisted(address account) external view returns (bool) {
        return _whitelisted[account];
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function setWhitelisted(address account, bool status) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (account == address(0)) revert InvalidAccount();
        _whitelisted[account] = status;
        emit WhitelistUpdated(account, status);
    }

    function setBlacklisted(address account, bool status) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (account == address(0)) revert InvalidAccount();
        _blacklisted[account] = status;
        emit BlacklistUpdated(account, status);
    }
}
