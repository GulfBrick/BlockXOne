// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../identity/IdentityRegistry.sol";
import "../compliance/ModularCompliance.sol";
import "./BXOSecurityToken.sol";

/**
 * @title BXOSecurityTokenFactory
 * @notice Factory for deploying the Generation 3 reviewed token prototype.
 * @dev This factory does not establish ERC-3643 conformance or production readiness.
 */
contract BXOSecurityTokenFactory {
    // Track deployed tokens
    address[] public deployedTokens;
    mapping(address => TokenDeploymentInfo) public tokenInfo;

    // Deployment information structure
    struct TokenDeploymentInfo {
        address token;
        address identityRegistry;
        address compliance;
        string name;
        string symbol;
        uint8 decimals;
        address deployer;
        uint256 deploymentTime;
    }

    // Events
    event TokenDeployed(
        address indexed token,
        string name,
        string symbol,
        address indexed identityRegistry,
        address indexed compliance,
        address deployer
    );

    event TokenMinted(address indexed token, address indexed to, uint256 amount);

    // Errors
    error InvalidDeployer();
    error InvalidName();
    error InvalidSymbol();
    error InvalidDecimals();
    error InvalidIdentityRegistry();
    error InvalidCompliance();
    error InvalidInitialSupply();

    /**
     * @notice Deploys one token prototype against caller-supplied registries.
     * @param name Token name
     * @param symbol Token symbol
     * @param decimals Number of decimals
     * @param identityRegistry Address of the IdentityRegistry
     * @param compliance Address of the ModularCompliance contract
     * @param initialSupply Initial token supply to mint to deployer
     * @return tokenAddress The address of the newly deployed token
     */
    function deployToken(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address identityRegistry,
        address compliance,
        uint256 initialSupply
    ) external returns (address tokenAddress) {
        // Validate inputs
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(symbol).length == 0) revert InvalidSymbol();
        if (decimals > 18) revert InvalidDecimals();
        if (identityRegistry == address(0)) revert InvalidIdentityRegistry();
        if (compliance == address(0)) revert InvalidCompliance();

        // Deploy token
        BXOSecurityToken token = new BXOSecurityToken(
            name,
            symbol,
            decimals,
            address(this),
            identityRegistry,
            compliance
        );

        tokenAddress = address(token);

        token.grantRole(token.DEFAULT_ADMIN_ROLE(), msg.sender);
        token.grantRole(token.AGENT_ROLE(), msg.sender);
        token.grantRole(token.MINTER_ROLE(), msg.sender);

        // The standard mint path enforces the same identity and compliance predicate as
        // every later standard issuance. No forced-issuer authority is ever granted here.
        if (initialSupply > 0) {
            token.mint(msg.sender, initialSupply);
            emit TokenMinted(tokenAddress, msg.sender, initialSupply);
        }

        token.renounceRole(token.MINTER_ROLE(), address(this));
        token.renounceRole(token.AGENT_ROLE(), address(this));
        token.renounceRole(token.DEFAULT_ADMIN_ROLE(), address(this));

        // Record deployment info
        tokenInfo[tokenAddress] = TokenDeploymentInfo({
            token: tokenAddress,
            identityRegistry: identityRegistry,
            compliance: compliance,
            name: name,
            symbol: symbol,
            decimals: decimals,
            deployer: msg.sender,
            deploymentTime: block.timestamp
        });

        deployedTokens.push(tokenAddress);

        emit TokenDeployed(tokenAddress, name, symbol, identityRegistry, compliance, msg.sender);
    }

    /**
     * @notice Returns all deployed tokens
     * @return tokens Array of deployed token addresses
     */
    function getDeployedTokens() external view returns (address[] memory tokens) {
        return deployedTokens;
    }

    /**
     * @notice Returns the number of deployed tokens
     * @return count The total number of deployed tokens
     */
    function getDeployedTokensCount() external view returns (uint256 count) {
        return deployedTokens.length;
    }

    /**
     * @notice Gets deployment information for a specific token
     * @param token The token address
     * @return info The deployment information
     */
    function getTokenInfo(address token)
        external
        view
        returns (TokenDeploymentInfo memory info)
    {
        return tokenInfo[token];
    }
}
