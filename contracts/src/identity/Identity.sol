// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IIdentity.sol";

/**
 * @title Identity
 * @notice Reference implementation of on-chain identity based on ERC-734/735
 * @dev Manages claims issued by trusted parties, supporting key management paradigm
 */
contract Identity is IIdentity {
    // Claim structure
    struct Claim {
        uint256 topic;
        uint256 scheme;
        address issuer;
        bytes signature;
        bytes data;
        string uri;
    }

    // State variables
    address public owner;
    mapping(uint256 => Claim) private claims;
    mapping(uint256 => uint256) private topicClaimIds; // topic => claimId
    mapping(uint256 => uint256[]) private claimIdsByTopic; // topic => claimIds[]
    uint256 private claimCount;
    uint256 private nextClaimId = 1;

    // Events
    event ClaimAdded(
        uint256 indexed claimId,
        uint256 indexed topic,
        address indexed issuer,
        uint256 scheme,
        string uri
    );
    event ClaimRemoved(uint256 indexed claimId, uint256 indexed topic);

    /**
     * @notice Initializes the identity contract
     * @param initialOwner The address that will own this identity
     */
    constructor(address initialOwner) {
        require(initialOwner != address(0), "Invalid owner address");
        owner = initialOwner;
    }

    /**
     * @notice Returns a claim by its ID
     * @param claimId The unique identifier of the claim
     * @return topic The topic of the claim
     * @return scheme The verification scheme
     * @return issuer The address of the claim issuer
     * @return signature The cryptographic signature
     * @return data Additional claim data
     * @return uri Optional URI pointing to off-chain details
     */
    function getClaim(uint256 claimId)
        external
        view
        override
        returns (
            uint256 topic,
            uint256 scheme,
            address issuer,
            bytes memory signature,
            bytes memory data,
            string memory uri
        )
    {
        require(claims[claimId].issuer != address(0), "Claim does not exist");
        Claim storage claim = claims[claimId];
        return (claim.topic, claim.scheme, claim.issuer, claim.signature, claim.data, claim.uri);
    }

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
    ) external override returns (uint256 claimId) {
        require(msg.sender == owner, "Only owner can add claims");
        require(issuer != address(0), "Invalid issuer");

        claimId = nextClaimId;
        nextClaimId++;

        claims[claimId] = Claim({
            topic: topic,
            scheme: scheme,
            issuer: issuer,
            signature: signature,
            data: data,
            uri: uri
        });

        claimIdsByTopic[topic].push(claimId);
        claimCount++;

        emit ClaimAdded(claimId, topic, issuer, scheme, uri);
    }

    /**
     * @notice Removes a claim from the identity
     * @param claimId The ID of the claim to remove
     * @return success Returns true if the claim was successfully removed
     */
    function removeClaim(uint256 claimId) external override returns (bool success) {
        require(msg.sender == owner, "Only owner can remove claims");
        require(claims[claimId].issuer != address(0), "Claim does not exist");

        uint256 topic = claims[claimId].topic;

        // Remove from claimIdsByTopic array
        uint256[] storage topicClaims = claimIdsByTopic[topic];
        for (uint256 i = 0; i < topicClaims.length; i++) {
            if (topicClaims[i] == claimId) {
                topicClaims[i] = topicClaims[topicClaims.length - 1];
                topicClaims.pop();
                break;
            }
        }

        delete claims[claimId];
        claimCount--;

        emit ClaimRemoved(claimId, topic);
        return true;
    }

    /**
     * @notice Returns all claim IDs for a specific topic
     * @param topic The claim topic to filter by
     * @return claimIds Array of claim IDs matching the topic
     */
    function getClaimIdsByTopic(uint256 topic)
        external
        view
        override
        returns (uint256[] memory claimIds)
    {
        return claimIdsByTopic[topic];
    }

    /**
     * @notice Gets the total number of claims in the identity
     * @return count The total number of claims
     */
    function getClaimCount() external view override returns (uint256 count) {
        return claimCount;
    }
}
