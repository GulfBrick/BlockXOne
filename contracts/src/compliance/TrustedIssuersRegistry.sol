// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ITrustedIssuersRegistry.sol";

/**
 * @title TrustedIssuersRegistry
 * @notice Registry managing trusted claim issuers
 * @dev Tracks which claim issuers are trusted and for which topics
 */
contract TrustedIssuersRegistry is ITrustedIssuersRegistry, Ownable {
    // Issuer information
    mapping(address => bool) private trustedIssuers;
    mapping(address => uint256[]) private issuerTopics;
    address[] private issuersList;

    // Events
    event TrustedIssuerAdded(address indexed issuer);
    event TrustedIssuerRemoved(address indexed issuer);
    event IssuerClaimTopicsUpdated(address indexed issuer, uint256[] topics);

    // Errors
    error IssuerAlreadyTrusted(address issuer);
    error IssuerNotTrusted(address issuer);
    error InvalidIssuer();
    error InvalidTopics();

    /**
     * @notice Initializes the TrustedIssuersRegistry
     */
    constructor() Ownable(msg.sender) {}

    /**
     * @notice Adds a trusted issuer
     * @param issuer The claim issuer to add
     * @param topics Array of claim topics this issuer can issue
     */
    function addTrustedIssuer(IClaimIssuer issuer, uint256[] calldata topics) external onlyOwner {
        if (address(issuer) == address(0)) revert InvalidIssuer();
        if (topics.length == 0) revert InvalidTopics();
        if (trustedIssuers[address(issuer)]) revert IssuerAlreadyTrusted(address(issuer));

        trustedIssuers[address(issuer)] = true;
        issuersList.push(address(issuer));

        // Store topics for this issuer
        for (uint256 i = 0; i < topics.length; i++) {
            issuerTopics[address(issuer)].push(topics[i]);
        }

        emit TrustedIssuerAdded(address(issuer));
    }

    /**
     * @notice Removes a trusted issuer
     * @param issuer The claim issuer to remove
     */
    function removeTrustedIssuer(IClaimIssuer issuer) external onlyOwner {
        if (!trustedIssuers[address(issuer)]) revert IssuerNotTrusted(address(issuer));

        trustedIssuers[address(issuer)] = false;

        // Remove from list
        for (uint256 i = 0; i < issuersList.length; i++) {
            if (issuersList[i] == address(issuer)) {
                issuersList[i] = issuersList[issuersList.length - 1];
                issuersList.pop();
                break;
            }
        }

        // Clear topics for this issuer
        delete issuerTopics[address(issuer)];

        emit TrustedIssuerRemoved(address(issuer));
    }

    /**
     * @notice Updates the topics that a trusted issuer can issue
     * @param issuer The claim issuer
     * @param topics New array of claim topics
     */
    function updateIssuerClaimTopics(IClaimIssuer issuer, uint256[] calldata topics)
        external
        onlyOwner
    {
        if (!trustedIssuers[address(issuer)]) revert IssuerNotTrusted(address(issuer));
        if (topics.length == 0) revert InvalidTopics();

        // Clear old topics
        delete issuerTopics[address(issuer)];

        // Add new topics
        for (uint256 i = 0; i < topics.length; i++) {
            issuerTopics[address(issuer)].push(topics[i]);
        }

        emit IssuerClaimTopicsUpdated(address(issuer), topics);
    }

    /**
     * @notice Returns all trusted issuers
     * @return issuers Array of trusted issuer addresses
     */
    function getTrustedIssuers() external view returns (address[] memory issuers) {
        return issuersList;
    }

    /**
     * @notice Checks if an address is a trusted issuer
     * @param issuer The address to check
     * @return isTrusted True if the address is a trusted issuer
     */
    function isTrustedIssuer(address issuer) external view returns (bool isTrusted) {
        return trustedIssuers[issuer];
    }

    /**
     * @notice Gets the claim topics for a trusted issuer
     * @param issuer The claim issuer
     * @return topics Array of topics this issuer can issue
     */
    function getTrustedIssuerClaimTopics(IClaimIssuer issuer)
        external
        view
        returns (uint256[] memory topics)
    {
        if (!trustedIssuers[address(issuer)]) revert IssuerNotTrusted(address(issuer));
        return issuerTopics[address(issuer)];
    }
}
