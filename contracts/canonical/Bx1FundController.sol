// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@erc3643org/erc-3643/contracts/factory/ITREXFactory.sol";
import "@erc3643org/erc-3643/contracts/token/IToken.sol";

interface IBx1OwnedContract { function owner() external view returns (address); }

/**
 * SOURCE CANDIDATE ONLY: not compiled, audited, admitted or deployed.
 * A separately admitted Safe owns the official suite; this controller is its only ROUTINE token agent.
 * It does not issue identity claims or give a browser/off-chain worker minting authority.
 * Suite-owner upgrades/role changes remain separate governed powers requiring release re-admission.
 */
contract Bx1FundController {
    address public immutable institutionalAuthority;
    ITREXFactory public immutable factory;
    bytes32 public constant releaseConfigurationHash =
        keccak256("b6c5fabf86e733ede017fef754d59eeb8f80e3f4:BX1_FUND_CONTROLLER_V1");

    uint256 public authorityEpoch = 1;
    bool public paused;
    bool private entered;
    mapping(bytes32 => bool) public executedOperations;
    mapping(bytes32 => bool) public revokedOperations;
    mapping(address => bytes32) public fundBindings;
    mapping(address => uint256) public maximumSupply;
    mapping(address => uint256) public maximumOperationUnits;

    event FundDeployed(bytes32 indexed operationId, bytes32 indexed bindingHash, address indexed token,
        address identityRegistry, uint256 maximumSupply, uint256 maximumOperationUnits);
    event FundIssued(bytes32 indexed operationId, bytes32 indexed bindingHash, address indexed token,
        address recipient, uint256 units, uint256 supplyAfter, uint256 balanceAfter);
    event AuthorityEpochAdvanced(uint256 previousEpoch, uint256 currentEpoch, bytes32 reasonHash);
    event OperationRevoked(bytes32 indexed operationId, bytes32 indexed reasonHash);
    event OperationalPauseChanged(bool paused, bytes32 indexed reasonHash);
    event FundPauseChanged(address indexed token, bool paused, bytes32 indexed reasonHash);

    modifier onlyInstitution() {
        require(msg.sender == institutionalAuthority, "institutional authority only");
        _;
    }
    modifier nonReentrant() {
        require(!entered, "reentrant operation");
        entered = true;
        _;
        entered = false;
    }

    constructor(address authority, address officialFactory) {
        require(authority.code.length > 0 && officialFactory.code.length > 0, "contract authority/factory required");
        require(authority != officialFactory, "separate authority and factory");
        institutionalAuthority = authority;
        factory = ITREXFactory(officialFactory);
        // Safe owner/threshold/modules, bytecode and governed factory ownership are VERIFIED BY ADMISSION.
        // A contract address alone is deliberately not claimed to prove an institutional signing policy.
    }

    function deployFund(
        bytes32 operationId,
        bytes32 bindingHash,
        bytes32 productBindingHash,
        uint256 epoch,
        uint256 expiresAt,
        string calldata salt,
        ITREXFactory.TokenDetails calldata tokenDetails,
        ITREXFactory.ClaimDetails calldata claimDetails,
        uint256 supplyLimit,
        uint256 operationLimit
    ) external onlyInstitution nonReentrant {
        _consume(operationId, bindingHash, epoch, expiresAt);
        require(!paused && productBindingHash != bytes32(0), "operations/product unavailable");
        require(bytes(salt).length > 0 && bytes(salt).length <= 160, "invalid product salt");
        require(tokenDetails.owner == institutionalAuthority, "governed suite owner required");
        require(tokenDetails.irs == address(0), "isolated identity storage required");
        require(tokenDetails.ONCHAINID.code.length > 0, "token ONCHAINID required");
        require(tokenDetails.tokenAgents.length == 1 && tokenDetails.tokenAgents[0] == address(this), "sole routine token agent required");
        require(tokenDetails.irAgents.length > 0 && tokenDetails.irAgents.length <= 5, "identity agents required");
        require(tokenDetails.complianceModules.length > 0 && tokenDetails.complianceModules.length <= 30, "compliance modules required");
        require(tokenDetails.complianceSettings.length <= tokenDetails.complianceModules.length, "module/settings mismatch");
        require(claimDetails.claimTopics.length > 0 && claimDetails.claimTopics.length <= 5, "required identity topics missing");
        require(claimDetails.issuers.length > 0 && claimDetails.issuers.length <= 5
            && claimDetails.issuerClaims.length == claimDetails.issuers.length, "trusted identity issuers missing");
        require(supplyLimit > 0 && operationLimit > 0 && operationLimit <= supplyLimit, "invalid issuance limits");
        require(factory.getToken(salt) == address(0), "salt already deployed");
        for (uint256 i = 0; i < tokenDetails.irAgents.length; i++) {
            require(tokenDetails.irAgents[i] != address(0) && tokenDetails.irAgents[i] != address(this), "separate identity authority required");
            for (uint256 j = 0; j < i; j++) require(tokenDetails.irAgents[i] != tokenDetails.irAgents[j], "duplicate identity agent");
        }
        for (uint256 i = 0; i < tokenDetails.complianceModules.length; i++) {
            require(tokenDetails.complianceModules[i].code.length > 0, "compliance module not deployed");
        }
        for (uint256 i = 0; i < claimDetails.issuers.length; i++) {
            require(claimDetails.issuers[i].code.length > 0 && claimDetails.issuerClaims[i].length > 0, "invalid claim issuer");
        }
        for (uint256 i = 0; i < claimDetails.claimTopics.length; i++) {
            require(claimDetails.claimTopics[i] > 0, "invalid claim topic");
            bool covered;
            for (uint256 j = 0; j < claimDetails.issuerClaims.length; j++) {
                for (uint256 k = 0; k < claimDetails.issuerClaims[j].length; k++) {
                    if (claimDetails.issuerClaims[j][k] == claimDetails.claimTopics[i]) covered = true;
                }
            }
            require(covered, "required topic has no trusted issuer");
        }

        // The admitted factory must first be owned by THIS controller. No public gateway fallback.
        factory.deployTREXSuite(salt, tokenDetails, claimDetails);
        _finaliseFundDeployment(operationId, bindingHash, productBindingHash, salt, supplyLimit, operationLimit);
    }

    function issueFund(
        bytes32 operationId,
        bytes32 bindingHash,
        bytes32 productBindingHash,
        uint256 epoch,
        uint256 expiresAt,
        address token,
        address recipient,
        uint256 units,
        uint256 expectedSupply,
        uint256 expectedBalance
    ) external onlyInstitution nonReentrant {
        _consume(operationId, bindingHash, epoch, expiresAt);
        require(!paused && token != address(0) && recipient != address(0), "issuance unavailable");
        require(productBindingHash != bytes32(0) && fundBindings[token] == productBindingHash, "product/terms binding mismatch");
        require(units > 0 && units <= maximumOperationUnits[token], "operation exceeds approved limit");
        IToken security = IToken(token);
        // Upstream mint checks identity/compliance, but not its paused flag. Enforce it here too.
        require(!security.paused(), "fund paused");
        require(security.totalSupply() == expectedSupply && security.balanceOf(recipient) == expectedBalance, "reconciliation snapshot stale");
        require(expectedSupply + units <= maximumSupply[token], "fund supply limit exceeded");
        require(security.identityRegistry().isVerified(recipient), "recipient identity not verified");
        require(security.compliance().canTransfer(address(0), recipient, units), "recipient allocation prohibited");
        security.mint(recipient, units);
        uint256 supplyAfter = security.totalSupply();
        uint256 balanceAfter = security.balanceOf(recipient);
        require(supplyAfter == expectedSupply + units && balanceAfter == expectedBalance + units, "mint effects mismatch");
        emit FundIssued(operationId, bindingHash, token, recipient, units, supplyAfter, balanceAfter);
    }

    /** A signed operation is revoked ON CHAIN only after this governed transaction is final. */
    function revokeOperation(bytes32 operationId, bytes32 reasonHash) external onlyInstitution {
        require(operationId != bytes32(0) && reasonHash != bytes32(0) && !executedOperations[operationId], "invalid revocation");
        revokedOperations[operationId] = true;
        emit OperationRevoked(operationId, reasonHash);
    }

    /** Invalidates outstanding prepared signatures when governance or appointments change. */
    function advanceAuthorityEpoch(uint256 nextEpoch, bytes32 reasonHash) external onlyInstitution {
        require(nextEpoch == authorityEpoch + 1 && reasonHash != bytes32(0), "invalid authority epoch");
        uint256 previous = authorityEpoch;
        authorityEpoch = nextEpoch;
        emit AuthorityEpochAdvanced(previous, nextEpoch, reasonHash);
    }

    function setOperationalPause(bool state, bytes32 reasonHash) external onlyInstitution {
        require(reasonHash != bytes32(0), "reason required");
        paused = state;
        emit OperationalPauseChanged(state, reasonHash);
    }

    function setFundPause(address token, bool state, bytes32 reasonHash) external onlyInstitution nonReentrant {
        require(fundBindings[token] != bytes32(0) && reasonHash != bytes32(0), "known fund/reason required");
        if (state) IToken(token).pause(); else IToken(token).unpause();
        emit FundPauseChanged(token, state, reasonHash);
    }

    // Keep finalisation locals off deployFund's calldata-heavy stack. This is
    // an internal call under the original nonReentrant/onlyInstitution guards.
    function _finaliseFundDeployment(
        bytes32 operationId,
        bytes32 bindingHash,
        bytes32 productBindingHash,
        string calldata salt,
        uint256 supplyLimit,
        uint256 operationLimit
    ) private {
        address token = factory.getToken(salt);
        require(token != address(0) && fundBindings[token] == bytes32(0), "invalid deployed token");
        IToken security = IToken(token);
        address identityRegistry = address(security.identityRegistry());
        address identityStorage = address(security.identityRegistry().identityStorage());
        // Official factory 4.1.3 retains new IRS ownership; transfer it atomically before success.
        factory.recoverContractOwnership(identityStorage, institutionalAuthority);
        require(IBx1OwnedContract(token).owner() == institutionalAuthority
            && IBx1OwnedContract(identityRegistry).owner() == institutionalAuthority
            && IBx1OwnedContract(identityStorage).owner() == institutionalAuthority, "suite owner handoff failed");
        require(security.totalSupply() == 0, "deployment must not manufacture ownership");
        fundBindings[token] = productBindingHash;
        maximumSupply[token] = supplyLimit;
        maximumOperationUnits[token] = operationLimit;
        // Official token initialises paused. Activation is part of this approved deployment operation;
        // it does not publish an offering or accept money. The platform verifies readiness separately.
        security.unpause();
        emit FundDeployed(operationId, bindingHash, token, identityRegistry, supplyLimit, operationLimit);
    }

    function _consume(bytes32 operationId, bytes32 bindingHash, uint256 epoch, uint256 expiresAt) private {
        require(operationId != bytes32(0) && bindingHash != bytes32(0), "operation/binding required");
        require(epoch == authorityEpoch && block.timestamp <= expiresAt, "authority changed or expired");
        require(!executedOperations[operationId] && !revokedOperations[operationId], "operation executed/revoked");
        executedOperations[operationId] = true;
    }
}
