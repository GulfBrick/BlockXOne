// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract WhitelistRegistry is AccessControl {
    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");

    mapping(address => bool) private _whitelisted;

    event Whitelisted(address indexed account, bool status);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(WHITELISTER_ROLE, admin);
    }

    function isWhitelisted(address account) external view returns (bool) {
        return _whitelisted[account];
    }

    function setWhitelisted(address account, bool status) external onlyRole(WHITELISTER_ROLE) {
        _whitelisted[account] = status;
        emit Whitelisted(account, status);
    }
}
