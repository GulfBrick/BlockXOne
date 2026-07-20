// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../compliance/IClaimIssuer.sol";

/**
 * @title MockClaimIssuer
 * @notice Mock implementation of a claim issuer for testing
 * @dev Used in tests to simulate claim verification without actual cryptography
 */
contract MockClaimIssuer is IClaimIssuer {
    address private issuerAddress;

    /**
     * @notice Initializes the mock claim issuer
     * @param _issuerAddress The address of the issuer
     */
    constructor(address _issuerAddress) {
        require(_issuerAddress != address(0), "Invalid issuer address");
        issuerAddress = _issuerAddress;
    }

    /**
     * @notice Mock verification of a claim signature
     * @param identity The identity contract address (unused in mock)
     * @param claimTopic The claim topic (unused in mock)
     * @param signature The signature to verify (unused in mock)
     * @param data The signed data (unused in mock)
     * @return isValid Always returns true for mock purposes
     */
    function isClaimValid(
        address identity,
        uint256 claimTopic,
        bytes memory signature,
        bytes memory data
    ) external pure override returns (bool isValid) {
        // Mock always returns true - real implementation would verify signature
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
