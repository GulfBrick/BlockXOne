// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IClaimIssuer
 * @notice Interface for trusted claim issuers in the ERC-3643 identity system
 * @dev Defines methods to verify claims issued by trusted parties
 */
interface IClaimIssuer {
    /**
     * @notice Verifies a claim signature
     * @param identity The identity contract address
     * @param claimTopic The claim topic
     * @param signature The signature to verify
     * @param data The signed data
     * @return isValid True if the signature is valid and issued by this issuer
     */
    function isClaimValid(
        address identity,
        uint256 claimTopic,
        bytes memory signature,
        bytes memory data
    ) external view returns (bool isValid);

    /**
     * @notice Returns the issuer's address
     * @return issuerAddress The address of this claim issuer
     */
    function getIssuerAddress() external view returns (address issuerAddress);
}
