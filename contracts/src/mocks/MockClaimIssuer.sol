// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../compliance/IClaimIssuer.sol";

/**
 * @title MockClaimIssuer
 * @notice Mock implementation of a claim issuer for testing
 * @dev Used in tests to simulate claim verification without actual cryptography
 */
contract MockClaimIssuer is IClaimIssuer {
    enum ValidationMode {
        Valid,
        Invalid,
        RevertCall,
        ShortReturn,
        InvalidBool,
        OversizedReturn
    }

    address private issuerAddress;
    ValidationMode public validationMode;

    bool public exactArgumentsRequired;
    address public expectedIdentity;
    uint256 public expectedClaimTopic;
    bytes32 public expectedSignatureHash;
    bytes32 public expectedDataHash;

    error MockValidationReverted();

    /**
     * @notice Initializes the mock claim issuer
     * @param _issuerAddress The address of the issuer
     */
    constructor(address _issuerAddress) {
        require(_issuerAddress != address(0), "Invalid issuer address");
        issuerAddress = _issuerAddress;
    }

    function setValidationMode(ValidationMode mode) external {
        validationMode = mode;
    }

    function setExpectedArguments(
        bool required,
        address identity,
        uint256 claimTopic,
        bytes calldata signature,
        bytes calldata data
    ) external {
        exactArgumentsRequired = required;
        expectedIdentity = identity;
        expectedClaimTopic = claimTopic;
        expectedSignatureHash = keccak256(signature);
        expectedDataHash = keccak256(data);
    }

    /**
     * @notice Returns the configured validation outcome for test claims.
     * @dev Defaults to true for legacy fixtures. Optional argument matching binds all inputs.
     * @param identity The identity contract address to match when matching is enabled
     * @param claimTopic The claim topic to match when matching is enabled
     * @param signature The signature whose hash is matched when matching is enabled
     * @param data The claim data whose hash is matched when matching is enabled
     * @return isValid The configured result, provided any exact-argument check passes
     */
    function isClaimValid(
        address identity,
        uint256 claimTopic,
        bytes memory signature,
        bytes memory data
    ) external view override returns (bool isValid) {
        if (
            exactArgumentsRequired &&
            (
                identity != expectedIdentity ||
                claimTopic != expectedClaimTopic ||
                keccak256(signature) != expectedSignatureHash ||
                keccak256(data) != expectedDataHash
            )
        ) {
            return false;
        }

        ValidationMode mode = validationMode;
        if (mode == ValidationMode.Invalid) return false;
        if (mode == ValidationMode.RevertCall) revert MockValidationReverted();
        if (mode == ValidationMode.ShortReturn) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        if (mode == ValidationMode.InvalidBool) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        if (mode == ValidationMode.OversizedReturn) {
            assembly ("memory-safe") {
                mstore(0, 1)
                mstore(32, 0)
                return(0, 64)
            }
        }
        return true;
    }

    /**
     * @notice Returns the issuer's address
     * @return The address of this claim issuer
     */
    function getIssuerAddress() external view override returns (address) {
        return issuerAddress;
    }
}
