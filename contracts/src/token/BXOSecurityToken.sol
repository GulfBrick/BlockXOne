// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../compliance/IModularCompliance.sol";
import "../identity/IdentityRegistry.sol";

/// @title BXOSecurityToken
/// @notice Generation 3 prototype for restricted-token issuance controls.
/// @dev This contract is not asserted to conform to ERC-3643 or to be production ready.
contract BXOSecurityToken is ERC20, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant FORCED_ISSUER_ROLE = keccak256("FORCED_ISSUER_ROLE");

    uint256 public constant MAX_BATCH_MINT_SIZE = 100;

    uint8 private immutable _tokenDecimals;

    IdentityRegistry public identityRegistry;
    IModularCompliance public compliance;

    mapping(address => bool) private _frozen;
    mapping(bytes32 => bool) public usedForcedIssuanceOperationIds;

    event AddressFrozen(address indexed account);
    event AddressUnfrozen(address indexed account);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent);
    event RecoverySuccess(address indexed lostWallet, address indexed newWallet, uint256 amount);
    event IdentityRegistryUpdated(address indexed identityRegistry);
    event ComplianceUpdated(address indexed compliance);
    event MintExecuted(address indexed operator, address indexed recipient, uint256 amount);
    event ForcedIssuanceExecuted(
        bytes32 indexed operationId,
        address indexed operator,
        address indexed recipient,
        uint256 amount,
        bytes32 evidenceHash
    );

    error AccessDenied();
    error AccountFrozen(address account);
    error ComplianceCheckFailed();
    error ComplianceNotConfigured();
    error IdentityNotRegistered(address account);
    error IdentityNotVerified(address account);
    error InvalidBatch();
    error InvalidCompliance();
    error InvalidEvidenceHash();
    error InvalidForcedIssuer(address account);
    error InvalidForcedTransferEndpoint();
    error InvalidIdentityRegistry();
    error InvalidIssuanceAmount();
    error InvalidIssuanceRecipient();
    error InvalidOperationId();
    error OperationAlreadyUsed(bytes32 operationId);
    error TooManyBatchRecipients(uint256 supplied, uint256 maximum);

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
        _grantRole(MINTER_ROLE, admin);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Issues tokens through the standard minter authority.
    function mint(address recipient, uint256 amount) external nonReentrant whenNotPaused {
        if (!hasRole(MINTER_ROLE, msg.sender)) revert AccessDenied();
        _issue(recipient, amount);
    }

    function burn(address from, uint256 amount) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        _burn(from, amount);
    }

    /// @notice Issues a bounded batch; every item is checked sequentially and atomically.
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused {
        if (!hasRole(MINTER_ROLE, msg.sender)) revert AccessDenied();
        uint256 count = recipients.length;
        if (count == 0 || count != amounts.length) revert InvalidBatch();
        if (count > MAX_BATCH_MINT_SIZE) {
            revert TooManyBatchRecipients(count, MAX_BATCH_MINT_SIZE);
        }

        for (uint256 i = 0; i < count; i++) {
            _issue(recipients[i], amounts[i]);
        }
    }

    function batchBurn(address[] calldata holders, uint256[] calldata amounts) external {
        if (!hasRole(AGENT_ROLE, msg.sender)) revert AccessDenied();
        require(holders.length == amounts.length, "Array length mismatch");

        for (uint256 i = 0; i < holders.length; i++) {
            _burn(holders[i], amounts[i]);
        }
    }

    /// @notice Executes evidence-bound issuance under a separate contract-held authority.
    /// @dev This path deliberately has the same identity and compliance eligibility as mint.
    function forcedIssue(
        bytes32 operationId,
        address recipient,
        uint256 amount,
        bytes32 evidenceHash
    ) external nonReentrant whenNotPaused {
        if (!hasRole(FORCED_ISSUER_ROLE, msg.sender)) revert AccessDenied();
        if (operationId == bytes32(0)) revert InvalidOperationId();
        if (usedForcedIssuanceOperationIds[operationId]) {
            revert OperationAlreadyUsed(operationId);
        }
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();

        // Mark before external eligibility calls. Any failed issuance rolls this write back.
        usedForcedIssuanceOperationIds[operationId] = true;
        _requireIssuanceEligible(recipient, amount);
        _mint(recipient, amount);
        emit ForcedIssuanceExecuted(operationId, msg.sender, recipient, amount, evidenceHash);
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

    function _issue(address recipient, uint256 amount) internal {
        _requireIssuanceEligible(recipient, amount);
        _mint(recipient, amount);
        emit MintExecuted(msg.sender, recipient, amount);
    }

    /// @dev Authorization-free so every issuance entry point applies the identical predicate.
    function _requireIssuanceEligible(address recipient, uint256 amount) internal view {
        if (recipient == address(0)) revert InvalidIssuanceRecipient();
        if (amount == 0) revert InvalidIssuanceAmount();
        if (!identityRegistry.contains(recipient)) revert IdentityNotRegistered(recipient);
        if (!identityRegistry.isVerified(recipient)) revert IdentityNotVerified(recipient);

        (bool modulesSucceeded, bytes memory encodedModules) = address(compliance).staticcall(
            abi.encodeWithSelector(IModularCompliance.getModules.selector)
        );
        uint256 moduleCount = _decodeExactAddressArrayLength(modulesSucceeded, encodedModules);
        if (moduleCount == 0) revert ComplianceNotConfigured();

        (bool complianceSucceeded, bytes memory encodedDecision) = address(compliance).staticcall(
            abi.encodeWithSelector(
                IModularCompliance.canTransfer.selector,
                address(0),
                recipient,
                amount
            )
        );
        if (!complianceSucceeded || encodedDecision.length != 32) {
            revert ComplianceCheckFailed();
        }
        if (_wordAt(encodedDecision, 0) != 1) revert ComplianceCheckFailed();
    }

    function _decodeExactAddressArrayLength(
        bool callSucceeded,
        bytes memory encoded
    ) private pure returns (uint256 count) {
        if (!callSucceeded || encoded.length < 64) revert ComplianceCheckFailed();
        if (_wordAt(encoded, 0) != 32) revert ComplianceCheckFailed();

        count = _wordAt(encoded, 32);
        if (count > (type(uint256).max - 64) / 32) revert ComplianceCheckFailed();
        if (encoded.length != 64 + (count * 32)) revert ComplianceCheckFailed();

        for (uint256 i = 0; i < count; i++) {
            uint256 moduleWord = _wordAt(encoded, 64 + (i * 32));
            if (moduleWord >> 160 != 0 || address(uint160(moduleWord)) == address(0)) {
                revert ComplianceCheckFailed();
            }
        }
    }

    function _wordAt(bytes memory encoded, uint256 offset) private pure returns (uint256 word) {
        assembly ("memory-safe") {
            word := mload(add(add(encoded, 0x20), offset))
        }
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
        if (from == address(0) || to == address(0)) revert InvalidForcedTransferEndpoint();
        ERC20._update(from, to, amount);
    }

    /// @dev FORCED_ISSUER_ROLE can only be held by deployed code. This does not prove multisig quality.
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role == FORCED_ISSUER_ROLE && account.code.length == 0) {
            revert InvalidForcedIssuer(account);
        }
        return super._grantRole(role, account);
    }
}
