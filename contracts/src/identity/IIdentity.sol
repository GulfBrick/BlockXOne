// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIdentity
 * @notice Interface for on-chain identity management based on ERC-734/735 key management
 * @dev Defines methods for managing identity claims issued by trusted parties
 */
interface IIdentity {
    /**
     * @notice Returns a claim by its ID
     * @param claimId The unique identifier of the claim
     * @return topic The topic of the claim
     * @return scheme The verification scheme (e.g., 1 for ECDSA, 2 for RSA)
     * @return issuer The address of the claim issuer
     * @return signature The cryptographic signature verifying the claim
     * @return data Additional claim data (encoded in bytes)
     * @return uri Optional URI pointing to off-chain claim details
     */
    function getClaim(uint256 claimId)
        external
        view
        returns (
            uint256 topic,
            uint256 scheme,
            address issuer,
            bytes memory signature,
            bytes memory data,
            string memory uri
        );

    /**
     * @notice Adds a new claim to the identity
     * @param topic The claim topic
     * @param scheme The verification scheme
     * @param issuer The address of the trusted issuer
     * @param signature The cryptographic signature
     * @param data Additional claim data
     * @param uri Optional URI for off-chain details
     * @return claimId The unique ID of the newly created claim
     */
    function addClaim(
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes memory signature,
        bytes memory data,
        string memory uri
    ) external returns (uint256 claimId);

    /**
     * @notice Removes a claim from the identity
     * @param claimId The ID of the claim to remove
     * @return success Returns true if the claim was successfully removed
     */
    function removeClaim(uint256 claimId) external returns (bool success);

    /**
     * @notice Returns all claim IDs for a specific topic
     * @param topic The claim topic to filter by
     * @return claimIds Array of claim IDs matching the topic
     */
    function getClaimIdsByTopic(uint256 topic) external view returns (uint256[] memory claimIds);

    /**
     * @notice Gets the total number of claims in the identity
     * @return count The total number of claims
     */
    function getClaimCount() external view returns (uint256 count);
}
