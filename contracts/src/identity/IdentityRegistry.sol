// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./IIdentity.sol";
import "../compliance/ITrustedIssuersRegistry.sol";
import "../compliance/IClaimTopicsRegistry.sol";

/**
 * @title IdentityRegistry
 * @notice On-chain registry mapping wallet addresses to identity contracts
 * @dev Implements ERC-3643 identity registry with country tracking and claim verification
 */
contract IdentityRegistry is AccessControl, Initializable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // Identity mapping: address => IIdentity
    mapping(address => IIdentity) public identities;
    mapping(address => bool) public contains;
    mapping(address => uint16) public investorCountries;

    // Links to registry contracts
    ITrustedIssuersRegistry public trustedIssuersRegistry;
    IClaimTopicsRegistry public claimTopicsRegistry;

    // Events
    event IdentityRegistered(address indexed investor, address indexed identity, uint16 country);
    event IdentityDeleted(address indexed investor);
    event CountryUpdated(address indexed investor, uint16 country);
    event RegistriesUpdated(
        address indexed trustedIssuersRegistry,
        address indexed claimTopicsRegistry
    );

    // Errors
    error AccessDenied();
    error IdentityNotFound(address investor);
    error AlreadyRegistered(address investor);
    error InvalidIdentity();
    error InvalidRegistry();

    /**
     * @notice Initializes the IdentityRegistry
     * @param admin The address to grant DEFAULT_ADMIN_ROLE
     * @param registrar The address to grant REGISTRAR_ROLE
     * @param trustedIssuersRegistry_ Address of the TrustedIssuersRegistry
     * @param claimTopicsRegistry_ Address of the ClaimTopicsRegistry
     */
    function initialize(
        address admin,
        address registrar,
        address trustedIssuersRegistry_,
        address claimTopicsRegistry_
    ) public initializer {
        require(admin != address(0), "Invalid admin");
        require(trustedIssuersRegistry_ != address(0), "Invalid trusted issuers registry");
        require(claimTopicsRegistry_ != address(0), "Invalid claim topics registry");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);

        trustedIssuersRegistry = ITrustedIssuersRegistry(trustedIssuersRegistry_);
        claimTopicsRegistry = IClaimTopicsRegistry(claimTopicsRegistry_);
    }

    /**
     * @notice Registers an identity for an investor wallet
     * @param investor The investor's wallet address
     * @param identity The identity contract address
     * @param country The investor's country code (ISO 3166-1 alpha-2)
     */
    function registerIdentity(address investor, IIdentity identity, uint16 country) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (contains[investor]) revert AlreadyRegistered(investor);
        if (address(identity) == address(0)) revert InvalidIdentity();

        identities[investor] = identity;
        contains[investor] = true;
        investorCountries[investor] = country;

        emit IdentityRegistered(investor, address(identity), country);
    }

    /**
     * @notice Deletes an identity from the registry
     * @param investor The investor's wallet address
     */
    function deleteIdentity(address investor) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (!contains[investor]) revert IdentityNotFound(investor);

        delete identities[investor];
        delete contains[investor];
        delete investorCountries[investor];

        emit IdentityDeleted(investor);
    }

    /**
     * @notice Updates the country for an investor
     * @param investor The investor's wallet address
     * @param country The new country code
     */
    function updateCountry(address investor, uint16 country) external {
        if (!hasRole(REGISTRAR_ROLE, msg.sender)) revert AccessDenied();
        if (!contains[investor]) revert IdentityNotFound(investor);

        investorCountries[investor] = country;
        emit CountryUpdated(investor, country);
    }

    /**
     * @notice Sets the registries linked to this IdentityRegistry
     * @param trustedIssuersRegistry_ Address of the TrustedIssuersRegistry
     * @param claimTopicsRegistry_ Address of the ClaimTopicsRegistry
     */
    function setRegistries(
        address trustedIssuersRegistry_,
        address claimTopicsRegistry_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (trustedIssuersRegistry_ == address(0) || claimTopicsRegistry_ == address(0)) {
            revert InvalidRegistry();
        }

        trustedIssuersRegistry = ITrustedIssuersRegistry(trustedIssuersRegistry_);
        claimTopicsRegistry = IClaimTopicsRegistry(claimTopicsRegistry_);

        emit RegistriesUpdated(trustedIssuersRegistry_, claimTopicsRegistry_);
    }

    /**
     * @notice Checks if an investor's identity is verified
     * @dev Verifies that all required claim topics are present and issued by trusted parties
     * @param investor The investor's wallet address
     * @return isVerified True if the investor has all required claims from trusted issuers
     */
    function isVerified(address investor) external view returns (bool isVerified) {
        if (!contains[investor]) return false;

        IIdentity identity = identities[investor];
        uint256[] memory requiredTopics = claimTopicsRegistry.getClaimTopics();

        for (uint256 i = 0; i < requiredTopics.length; i++) {
            uint256 topic = requiredTopics[i];
            uint256[] memory claimIds = identity.getClaimIdsByTopic(topic);

            if (claimIds.length == 0) return false;

            bool foundValidClaim = false;
            for (uint256 j = 0; j < claimIds.length; j++) {
                (uint256 claimTopic, uint256 scheme, address issuer, bytes memory signature, bytes memory data, ) =
                    identity.getClaim(claimIds[j]);

                if (claimTopic == topic && trustedIssuersRegistry.isTrustedIssuer(issuer)) {
                    foundValidClaim = true;
                    break;
                }
            }

            if (!foundValidClaim) return false;
        }

        return true;
    }

    /**
     * @notice Gets the identity contract for an investor
     * @param investor The investor's wallet address
     * @return identity The identity contract address
     */
    function getIdentity(address investor) external view returns (IIdentity identity) {
        if (!contains[investor]) revert IdentityNotFound(investor);
        return identities[investor];
    }

    /**
     * @notice Gets the country code for an investor
     * @param investor The investor's wallet address
     * @return country The country code
     */
    function getCountry(address investor) external view returns (uint16 country) {
        if (!contains[investor]) revert IdentityNotFound(investor);
        return investorCountries[investor];
    }
}
