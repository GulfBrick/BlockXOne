// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IClaimTopicsRegistry.sol";

/**
 * @title ClaimTopicsRegistry
 * @notice Registry managing required claim topics for compliance
 * @dev Tracks which identity claims are required for token transfers
 */
contract ClaimTopicsRegistry is IClaimTopicsRegistry, Ownable {
    // Standard claim topics
    uint256 public constant TOPIC_KYC = 1;
    uint256 public constant TOPIC_AML = 2;
    uint256 public constant TOPIC_ACCREDITED = 3;
    uint256 public constant TOPIC_COUNTRY = 4;

    // Required topics mapping and array
    mapping(uint256 => bool) private requiredTopics;
    uint256[] private claimTopicsList;

    // Events
    event ClaimTopicAdded(uint256 indexed topic);
    event ClaimTopicRemoved(uint256 indexed topic);

    // Errors
    error TopicAlreadyAdded(uint256 topic);
    error TopicNotFound(uint256 topic);

    /**
     * @notice Initializes the ClaimTopicsRegistry with default topics
     */
    constructor() Ownable(msg.sender) {
        // Initialize with default required topics
        _addTopic(TOPIC_KYC);
        _addTopic(TOPIC_AML);
    }

    /**
     * @notice Adds a required claim topic
     * @param topic The topic ID to add
     */
    function addClaimTopic(uint256 topic) external onlyOwner {
        _addTopic(topic);
    }

    /**
     * @notice Removes a required claim topic
     * @param topic The topic ID to remove
     */
    function removeClaimTopic(uint256 topic) external onlyOwner {
        if (!requiredTopics[topic]) revert TopicNotFound(topic);

        requiredTopics[topic] = false;

        // Remove from array
        for (uint256 i = 0; i < claimTopicsList.length; i++) {
            if (claimTopicsList[i] == topic) {
                claimTopicsList[i] = claimTopicsList[claimTopicsList.length - 1];
                claimTopicsList.pop();
                break;
            }
        }

        emit ClaimTopicRemoved(topic);
    }

    /**
     * @notice Returns all required claim topics
     * @return topics Array of required topic IDs
     */
    function getClaimTopics() external view returns (uint256[] memory topics) {
        return claimTopicsList;
    }

    /**
     * @notice Checks if a topic is required
     * @param topic The topic ID to check
     * @return isRequired True if the topic is in the required list
     */
    function isTopicRequired(uint256 topic) external view returns (bool isRequired) {
        return requiredTopics[topic];
    }

    /**
     * @notice Internal function to add a topic
     * @param topic The topic ID to add
     */
    function _addTopic(uint256 topic) internal {
        if (requiredTopics[topic]) revert TopicAlreadyAdded(topic);

        requiredTopics[topic] = true;
        claimTopicsList.push(topic);

        emit ClaimTopicAdded(topic);
    }
}
