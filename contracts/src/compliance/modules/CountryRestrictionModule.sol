// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../IComplianceModule.sol";
import "../../identity/IdentityRegistry.sol";

/**
 * @title CountryRestrictionModule
 * @notice Compliance module that restricts transfers based on investor country
 * @dev Prevents transfers to/from addresses in restricted countries
 */
contract CountryRestrictionModule is IComplianceModule, Ownable {
    // Restricted countries mapping
    mapping(uint16 => bool) private restrictedCountries;
    uint16[] private restrictedCountriesList;

    // Link to identity registry
    IdentityRegistry public identityRegistry;

    // Events
    event CountryRestrictionAdded(uint16 indexed country);
    event CountryRestrictionRemoved(uint16 indexed country);
    event IdentityRegistryUpdated(address indexed identityRegistry);

    // Errors
    error CountryAlreadyRestricted(uint16 country);
    error CountryNotRestricted(uint16 country);
    error InvalidCountry();
    error IdentityNotRegistered(address investor);

    /**
     * @notice Initializes the CountryRestrictionModule
     * @param identityRegistry_ Address of the IdentityRegistry
     */
    constructor(address identityRegistry_) Ownable(msg.sender) {
        require(identityRegistry_ != address(0), "Invalid identity registry");
        identityRegistry = IdentityRegistry(identityRegistry_);
    }

    /**
     * @notice Adds a country to the restriction list
     * @param country The ISO 3166-1 alpha-2 country code
     */
    function addCountryRestriction(uint16 country) external onlyOwner {
        if (country == 0) revert InvalidCountry();
        if (restrictedCountries[country]) revert CountryAlreadyRestricted(country);

        restrictedCountries[country] = true;
        restrictedCountriesList.push(country);

        emit CountryRestrictionAdded(country);
    }

    /**
     * @notice Removes a country from the restriction list
     * @param country The ISO 3166-1 alpha-2 country code
     */
    function removeCountryRestriction(uint16 country) external onlyOwner {
        if (!restrictedCountries[country]) revert CountryNotRestricted(country);

        restrictedCountries[country] = false;

        // Remove from list
        for (uint256 i = 0; i < restrictedCountriesList.length; i++) {
            if (restrictedCountriesList[i] == country) {
                restrictedCountriesList[i] = restrictedCountriesList[restrictedCountriesList.length - 1];
                restrictedCountriesList.pop();
                break;
            }
        }

        emit CountryRestrictionRemoved(country);
    }

    /**
     * @notice Sets the identity registry for this module
     * @param identityRegistry_ Address of the IdentityRegistry
     */
    function setIdentityRegistry(address identityRegistry_) external onlyOwner {
        require(identityRegistry_ != address(0), "Invalid identity registry");
        identityRegistry = IdentityRegistry(identityRegistry_);
        emit IdentityRegistryUpdated(identityRegistry_);
    }

    /**
     * @notice Checks if a transfer is allowed based on country restrictions
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount (unused)
     * @return isAllowed True if transfer is allowed
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view override returns (bool isAllowed) {
        // Check sender's country (only if registered)
        if (identityRegistry.contains(from)) {
            uint16 senderCountry = identityRegistry.investorCountries(from);
            if (restrictedCountries[senderCountry]) {
                return false;
            }
        }

        // Check recipient's country (only if registered)
        if (identityRegistry.contains(to)) {
            uint16 recipientCountry = identityRegistry.investorCountries(to);
            if (restrictedCountries[recipientCountry]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Called after a successful transfer (no-op for this module)
     * @param from The sender address (unused)
     * @param to The recipient address (unused)
     * @param amount The transfer amount (unused)
     */
    function transferred(
        address from,
        address to,
        uint256 amount
    ) external override {
        // No state changes needed after transfer
    }

    /**
     * @notice Returns the name of this compliance module
     * @return name The module name
     */
    function name() external pure override returns (string memory name) {
        return "CountryRestrictionModule";
    }

    /**
     * @notice Returns all restricted countries
     * @return countries Array of restricted country codes
     */
    function getRestrictedCountries() external view returns (uint16[] memory countries) {
        return restrictedCountriesList;
    }

    /**
     * @notice Checks if a country is restricted
     * @param country The country code
     * @return isRestricted True if the country is restricted
     */
    function isCountryRestricted(uint16 country) external view returns (bool isRestricted) {
        return restrictedCountries[country];
    }
}
