// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../compliance/IClaimIssuer.sol";
import "../compliance/IComplianceModule.sol";
import "../compliance/IModularCompliance.sol";

interface ITestGovernedIssuanceToken {
    function grantRole(bytes32 role, address account) external;

    function mint(address recipient, uint256 amount) external;

    function forcedIssue(
        bytes32 operationId,
        address recipient,
        uint256 amount,
        bytes32 evidenceHash
    ) external;
}

/// @dev Test-only contract holder for exercising contract-gated token authorities.
contract MockGovernanceExecutor {
    function executeGrantRole(address token, bytes32 role, address account) external {
        ITestGovernedIssuanceToken(token).grantRole(role, account);
    }

    function executeMint(address token, address recipient, uint256 amount) external {
        ITestGovernedIssuanceToken(token).mint(recipient, amount);
    }

    function executeForcedIssue(
        address token,
        bytes32 operationId,
        address recipient,
        uint256 amount,
        bytes32 evidenceHash
    ) external {
        ITestGovernedIssuanceToken(token).forcedIssue(
            operationId,
            recipient,
            amount,
            evidenceHash
        );
    }
}

/// @dev Test-only claim issuer that accepts a claim only when a nested issuance attempt
///      fails with the exact shared OpenZeppelin ReentrancyGuard selector.
contract MockIssuanceReentryClaimIssuer is IClaimIssuer {
    enum ReentryMode {
        Disabled,
        ForcedIssueFromMint,
        MintFromForcedIssue
    }

    bytes4 public constant REENTRANCY_GUARD_SELECTOR = 0x3ee5aeb5;

    ReentryMode public reentryMode;
    address public token;
    address public nestedRecipient;
    uint256 public nestedAmount;
    bytes32 public nestedOperationId;
    bytes32 public nestedEvidenceHash;

    function configure(
        ReentryMode mode,
        address token_,
        address recipient_,
        uint256 amount_,
        bytes32 operationId_,
        bytes32 evidenceHash_
    ) external {
        reentryMode = mode;
        token = token_;
        nestedRecipient = recipient_;
        nestedAmount = amount_;
        nestedOperationId = operationId_;
        nestedEvidenceHash = evidenceHash_;
    }

    function isClaimValid(
        address,
        uint256,
        bytes memory,
        bytes memory
    ) external view override returns (bool isValid) {
        bytes memory nestedCall;
        if (reentryMode == ReentryMode.ForcedIssueFromMint) {
            nestedCall = abi.encodeCall(
                ITestGovernedIssuanceToken.forcedIssue,
                (nestedOperationId, nestedRecipient, nestedAmount, nestedEvidenceHash)
            );
        } else if (reentryMode == ReentryMode.MintFromForcedIssue) {
            nestedCall = abi.encodeCall(
                ITestGovernedIssuanceToken.mint,
                (nestedRecipient, nestedAmount)
            );
        } else {
            return false;
        }

        (bool succeeded, bytes memory returnData) = token.staticcall(nestedCall);
        return !succeeded && matchesExpectedReentrancyFailure(returnData);
    }

    function getIssuerAddress() external view override returns (address) {
        return address(this);
    }

    function matchesExpectedReentrancyFailure(
        bytes memory returnData
    ) public pure returns (bool) {
        if (returnData.length != 4) return false;
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(returnData, 0x20))
        }
        return selector == REENTRANCY_GUARD_SELECTOR;
    }
}

/// @dev Test-only compliance double for exact revert and returndata-shape tests.
contract MockIssuanceCompliance is IModularCompliance {
    enum ModulesMode {
        Configured,
        Empty,
        ZeroAddress,
        RevertCall,
        ShortReturn,
        WrongOffset,
        OversizedReturn,
        DirtyAddress
    }

    enum DecisionMode {
        Allow,
        Reject,
        RevertCall,
        ShortReturn,
        InvalidBool,
        OversizedReturn
    }

    ModulesMode public modulesMode;
    DecisionMode public decisionMode;
    bool public exactArgumentsRequired;
    address public expectedFrom;
    address public expectedRecipient;
    uint256 public expectedAmount;

    error MockComplianceReverted();

    function setModulesMode(ModulesMode mode) external {
        modulesMode = mode;
    }

    function setDecisionMode(DecisionMode mode) external {
        decisionMode = mode;
    }

    function setExpectedDecisionArguments(
        bool required,
        address from,
        address recipient,
        uint256 amount
    ) external {
        exactArgumentsRequired = required;
        expectedFrom = from;
        expectedRecipient = recipient;
        expectedAmount = amount;
    }

    function addModule(IComplianceModule) external override {}

    function removeModule(address) external override {}

    function canTransfer(
        address from,
        address recipient,
        uint256 amount
    ) external view override returns (bool isAllowed) {
        if (
            exactArgumentsRequired &&
            (from != expectedFrom || recipient != expectedRecipient || amount != expectedAmount)
        ) {
            return false;
        }
        DecisionMode mode = decisionMode;
        if (mode == DecisionMode.Reject) return false;
        if (mode == DecisionMode.RevertCall) revert MockComplianceReverted();
        if (mode == DecisionMode.ShortReturn) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        if (mode == DecisionMode.InvalidBool) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        if (mode == DecisionMode.OversizedReturn) {
            assembly ("memory-safe") {
                mstore(0, 1)
                mstore(32, 0)
                return(0, 64)
            }
        }
        return true;
    }

    function transferred(address, address, uint256) external override {}

    function getModules() external view override returns (address[] memory modules) {
        ModulesMode mode = modulesMode;
        if (mode == ModulesMode.Empty) return new address[](0);
        if (mode == ModulesMode.ZeroAddress) return new address[](1);
        if (mode == ModulesMode.RevertCall) revert MockComplianceReverted();
        if (mode == ModulesMode.ShortReturn) {
            assembly ("memory-safe") {
                mstore(0, 0x20)
                return(0, 32)
            }
        }
        if (mode == ModulesMode.WrongOffset) {
            assembly ("memory-safe") {
                mstore(0, 0x40)
                mstore(32, 0)
                return(0, 64)
            }
        }
        if (mode == ModulesMode.OversizedReturn) {
            assembly ("memory-safe") {
                mstore(0, 0x20)
                mstore(32, 1)
                mstore(64, address())
                mstore(96, 0)
                return(0, 128)
            }
        }
        if (mode == ModulesMode.DirtyAddress) {
            assembly ("memory-safe") {
                mstore(0, 0x20)
                mstore(32, 1)
                mstore(64, or(address(), shl(200, 1)))
                return(0, 96)
            }
        }

        modules = new address[](1);
        modules[0] = address(this);
    }
}
