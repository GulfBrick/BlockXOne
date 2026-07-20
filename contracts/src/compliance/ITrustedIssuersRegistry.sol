// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IClaimIssuer.sol";

/**
 * @title ITrustedIssuersRegistry
 * @notice Interface for managing trusted claim issuers in ERC-3643
 * @dev Tracks which claim issuers are trusted and for which topics
 */
interface ITrustedIssuersRegistry {
    /**
     * @notice Adds a trusted issuer
     * @param issuer The claim issuer to add
     * @param topics Array of claim topics this issuer can issue
     */
    function addTrustedIssuer(IClaimIssuer issuer, uint256[] calldata topics) external;

    /**
     * @notice Removes a trusted issuer
     * @param issuer The claim issuer to remove
     */
    function removeTrustedIssuer(IClaimIssuer issuer) external;

    /**
     * @notice Updates the topics that a trusted issuer can issue
     * @param issuer The claim issuer
     * @param topics New array of claim topics
     */
    function updateIssuerClaimTopics(IClaimIssuer issuer, uint256[] calldata topics) external;

    /**
     * @notice Returns all trusted issuers
     * @return issuers Array of trusted issuer addresses
     */
    function getTrustedIssuers() external view returns (address[] memory issuers);

    /**
     * @notice Checks if an address is a trusted issuer
     * @param issuer The address to check
     * @return isTrusted True if the address is a trusted issuer
     */
    function isTrustedIssuer(address issuer) external view returns (bool isTrusted);

    /**
     * @notice Gets the claim topics for a trusted issuer
     * @param issuer The claim issuer
     * @return topics Array of topics this issuer can issue
     */
    function getTrustedIssuerClaimTopics(IClaimIssuer issuer)
        external
        view
        returns (uint256[] memory topics);
}
