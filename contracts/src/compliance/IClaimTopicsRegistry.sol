// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IClaimTopicsRegistry
 * @notice Interface for managing required claim topics in ERC-3643
 * @dev Defines the claims that must be present for compliance
 */
interface IClaimTopicsRegistry {
    /**
     * @notice Adds a required claim topic
     * @param topic The topic ID to add
     */
    function addClaimTopic(uint256 topic) external;

    /**
     * @notice Removes a required claim topic
     * @param topic The topic ID to remove
     */
    function removeClaimTopic(uint256 topic) external;

    /**
     * @notice Returns all required claim topics
     * @return topics Array of required topic IDs
     */
    function getClaimTopics() external view returns (uint256[] memory topics);

    /**
     * @notice Checks if a topic is required
     * @param topic The topic ID to check
     * @return isRequired True if the topic is in the required list
     */
    function isTopicRequired(uint256 topic) external view returns (bool isRequired);
}
