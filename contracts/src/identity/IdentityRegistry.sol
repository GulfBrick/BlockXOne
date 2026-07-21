// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./IIdentity.sol";
import "../compliance/IClaimIssuer.sol";
import "../compliance/ITrustedIssuersRegistry.sol";
import "../compliance/IClaimTopicsRegistry.sol";

/**
 * @title IdentityRegistry
 * @notice On-chain registry mapping wallet addresses to identity contracts
 * @dev Implements ERC-3643 identity registry with country tracking and claim verification
 */
contract IdentityRegistry is AccessControl, Initializable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    uint256 private constant CLAIM_SCHEME = 1;
    uint256 private constant CLAIM_HEAD_SIZE = 0xc0;

    struct DecodedClaim {
        uint256 topic;
        uint256 scheme;
        address issuer;
        bytes signature;
        bytes data;
    }

    struct DynamicSlice {
        uint256 start;
        uint256 length;
        uint256 next;
    }

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

        address identity = address(identities[investor]);
        if (identity == address(0)) return false;

        (bool topicsDecoded, uint256[] memory requiredTopics) = _readUint256Array(
            address(claimTopicsRegistry),
            abi.encodeWithSelector(IClaimTopicsRegistry.getClaimTopics.selector)
        );
        if (!topicsDecoded || requiredTopics.length == 0) return false;

        for (uint256 i = 0; i < requiredTopics.length; i++) {
            uint256 topic = requiredTopics[i];
            (bool claimIdsDecoded, uint256[] memory claimIds) = _readUint256Array(
                identity,
                abi.encodeWithSelector(IIdentity.getClaimIdsByTopic.selector, topic)
            );
            if (!claimIdsDecoded || claimIds.length == 0) return false;

            bool foundValidClaim = false;
            for (uint256 j = 0; j < claimIds.length; j++) {
                if (_isQualifyingClaim(identity, topic, claimIds[j])) {
                    foundValidClaim = true;
                    break;
                }
            }

            if (!foundValidClaim) return false;
        }

        return true;
    }

    function _isQualifyingClaim(
        address identity,
        uint256 requiredTopic,
        uint256 claimId
    ) private view returns (bool) {
        (bool callSucceeded, bytes memory encodedClaim) = identity.staticcall(
            abi.encodeWithSelector(IIdentity.getClaim.selector, claimId)
        );
        if (!callSucceeded) return false;

        (bool claimDecoded, DecodedClaim memory claim) = _decodeClaim(encodedClaim);
        if (
            !claimDecoded ||
            claim.topic != requiredTopic ||
            claim.scheme != CLAIM_SCHEME ||
            claim.issuer == address(0) ||
            claim.signature.length == 0
        ) {
            return false;
        }

        if (!_isCurrentlyAuthorizedIssuer(claim.issuer, requiredTopic)) return false;
        return _isAcceptedByIssuer(claim, identity);
    }

    function _isCurrentlyAuthorizedIssuer(
        address issuer,
        uint256 requiredTopic
    ) private view returns (bool) {
        (bool trustDecoded, bool trusted) = _readBool(
            address(trustedIssuersRegistry),
            abi.encodeWithSelector(
                ITrustedIssuersRegistry.isTrustedIssuer.selector,
                issuer
            )
        );
        if (!trustDecoded || !trusted) return false;

        (bool issuerTopicsDecoded, uint256[] memory issuerTopics) = _readUint256Array(
            address(trustedIssuersRegistry),
            abi.encodeWithSelector(
                ITrustedIssuersRegistry.getTrustedIssuerClaimTopics.selector,
                issuer
            )
        );
        return issuerTopicsDecoded && _containsTopic(issuerTopics, requiredTopic);
    }

    function _isAcceptedByIssuer(
        DecodedClaim memory claim,
        address identity
    ) private view returns (bool) {
        (bool validationDecoded, bool valid) = _readBool(
            claim.issuer,
            abi.encodeWithSelector(
                IClaimIssuer.isClaimValid.selector,
                identity,
                claim.topic,
                claim.signature,
                claim.data
            )
        );
        return validationDecoded && valid;
    }

    function _containsTopic(
        uint256[] memory topics,
        uint256 requiredTopic
    ) private pure returns (bool) {
        for (uint256 i = 0; i < topics.length; i++) {
            if (topics[i] == requiredTopic) return true;
        }
        return false;
    }

    function _readBool(
        address target,
        bytes memory callData
    ) private view returns (bool decoded, bool value) {
        (bool callSucceeded, bytes memory returnData) = target.staticcall(callData);
        if (!callSucceeded || returnData.length != 32) return (false, false);

        uint256 word = _wordAt(returnData, 0);
        if (word > 1) return (false, false);
        return (true, word == 1);
    }

    function _readUint256Array(
        address target,
        bytes memory callData
    ) private view returns (bool decoded, uint256[] memory values) {
        (bool callSucceeded, bytes memory returnData) = target.staticcall(callData);
        if (!callSucceeded) return (false, new uint256[](0));
        return _decodeUint256Array(returnData);
    }

    function _decodeUint256Array(
        bytes memory encoded
    ) private pure returns (bool decoded, uint256[] memory values) {
        if (encoded.length < 64 || _wordAt(encoded, 0) != 0x20) {
            return (false, new uint256[](0));
        }

        uint256 elementBytes = encoded.length - 64;
        if (elementBytes % 32 != 0) return (false, new uint256[](0));

        uint256 elementCount = _wordAt(encoded, 32);
        if (elementCount != elementBytes / 32) return (false, new uint256[](0));

        values = new uint256[](elementCount);
        for (uint256 i = 0; i < elementCount; i++) {
            values[i] = _wordAt(encoded, 64 + (i * 32));
        }
        return (true, values);
    }

    function _decodeClaim(
        bytes memory encoded
    ) private pure returns (bool decoded, DecodedClaim memory claim) {
        if (encoded.length < CLAIM_HEAD_SIZE) return (false, claim);

        uint256 issuerWord = _wordAt(encoded, 64);
        if (issuerWord >> 160 != 0) return (false, claim);

        uint256 signatureOffset = _wordAt(encoded, 96);
        uint256 dataOffset = _wordAt(encoded, 128);
        uint256 uriOffset = _wordAt(encoded, 160);
        if (signatureOffset != CLAIM_HEAD_SIZE) return (false, claim);

        (bool signatureValid, DynamicSlice memory signatureSlice) = _validateDynamicSlice(
            encoded,
            signatureOffset,
            CLAIM_HEAD_SIZE
        );
        if (!signatureValid || dataOffset != signatureSlice.next) return (false, claim);

        (bool dataValid, DynamicSlice memory dataSlice) = _validateDynamicSlice(
            encoded,
            dataOffset,
            signatureSlice.next
        );
        if (!dataValid || uriOffset != dataSlice.next) return (false, claim);

        (bool uriValid, DynamicSlice memory uriSlice) = _validateDynamicSlice(
            encoded,
            uriOffset,
            dataSlice.next
        );
        if (!uriValid || uriSlice.next != encoded.length) return (false, claim);

        claim.topic = _wordAt(encoded, 0);
        claim.scheme = _wordAt(encoded, 32);
        claim.issuer = address(uint160(issuerWord));
        claim.signature = _copyBytes(encoded, signatureSlice.start, signatureSlice.length);
        claim.data = _copyBytes(encoded, dataSlice.start, dataSlice.length);
        return (true, claim);
    }

    function _validateDynamicSlice(
        bytes memory encoded,
        uint256 offset,
        uint256 expectedOffset
    ) private pure returns (bool valid, DynamicSlice memory slice) {
        if (offset != expectedOffset || offset > encoded.length || encoded.length - offset < 32) {
            return (false, slice);
        }

        uint256 length = _wordAt(encoded, offset);
        uint256 start = offset + 32;
        if (length > encoded.length - start) return (false, slice);

        uint256 padding = length % 32 == 0 ? 0 : 32 - (length % 32);
        if (length > type(uint256).max - padding) return (false, slice);
        uint256 paddedLength = length + padding;
        if (paddedLength > encoded.length - start) return (false, slice);

        uint256 next = start + paddedLength;
        for (uint256 i = start + length; i < next; i++) {
            if (encoded[i] != bytes1(0)) return (false, slice);
        }

        slice = DynamicSlice({start: start, length: length, next: next});
        return (true, slice);
    }

    function _copyBytes(
        bytes memory source,
        uint256 start,
        uint256 length
    ) private pure returns (bytes memory result) {
        result = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = source[start + i];
        }
    }

    function _wordAt(bytes memory encoded, uint256 offset) private pure returns (uint256 word) {
        assembly ("memory-safe") {
            word := mload(add(add(encoded, 0x20), offset))
        }
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
