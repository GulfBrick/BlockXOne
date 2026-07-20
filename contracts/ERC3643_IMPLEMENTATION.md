# ERC-3643 (T-REX) Implementation for BlockXOne

## Overview

This directory contains a complete, production-ready implementation of ERC-3643 (Token for Regulated EXchanges - T-REX) compliant smart contracts for BlockXOne's tokenization platform. The implementation provides institutional-grade security tokens with advanced identity verification, modular compliance, and regulatory controls.

## Architecture

```
BlockXOne Security Token Ecosystem
├── Identity Layer
│   ├── IIdentity.sol - Identity interface (ERC-734/735 based)
│   ├── Identity.sol - Concrete identity implementation
│   └── IdentityRegistry.sol - Wallet-to-identity mapping registry
│
├── Compliance Layer
│   ├── Registries
│   │   ├── ClaimTopicsRegistry.sol - Required claim topics manager
│   │   └── TrustedIssuersRegistry.sol - Trusted claim issuers manager
│   │
│   ├── Modular Engine
│   │   ├── IComplianceModule.sol - Compliance module interface
│   │   ├── IModularCompliance.sol - Modular compliance engine interface
│   │   └── ModularCompliance.sol - Pluggable compliance implementation
│   │
│   └── Compliance Modules
│       ├── CountryRestrictionModule.sol - Country-based restrictions
│       └── MaxBalanceModule.sol - Maximum balance enforcement
│
├── Token Layer
│   ├── BXOSecurityToken.sol - ERC-3643 compliant security token
│   └── BXOSecurityTokenFactory.sol - Token deployment factory
│
└── Test Suite
    ├── BXOSecurityToken.test.ts - Comprehensive tests
    └── Mocks
        └── MockClaimIssuer.sol - Test claim issuer
```

## File Structure

### Identity Management (src/identity/)

#### IIdentity.sol
- **Purpose**: Defines the interface for on-chain identity management
- **Methods**:
  - `getClaim(claimId)` - Retrieve a claim by ID
  - `addClaim()` - Add a new claim to identity
  - `removeClaim()` - Remove a claim
  - `getClaimIdsByTopic()` - Get all claims for a topic
  - `getClaimCount()` - Total number of claims

#### Identity.sol
- **Purpose**: Reference implementation of ERC-734/735 identity contract
- **Features**:
  - Claim-based identity management
  - Multi-topic claim support
  - Owner-controlled claim lifecycle
  - Full NatSpec documentation

#### IdentityRegistry.sol
- **Purpose**: On-chain registry mapping addresses to identity contracts
- **Key Features**:
  - Links wallets to identity contracts
  - Tracks investor country codes
  - Verifies identity compliance via claim checking
  - Integrates with TrustedIssuersRegistry and ClaimTopicsRegistry
  - Role-based access control (REGISTRAR_ROLE)
- **Methods**:
  - `registerIdentity()` - Register investor with identity
  - `deleteIdentity()` - Remove investor from registry
  - `updateCountry()` - Update country code
  - `isVerified()` - Check if identity meets compliance requirements
  - `getIdentity()` - Retrieve identity contract for address
  - `getCountry()` - Get investor's country

### Compliance Management (src/compliance/)

#### IClaimIssuer.sol
- **Purpose**: Interface for trusted claim issuers
- **Methods**:
  - `isClaimValid()` - Verify claim signature
  - `getIssuerAddress()` - Get issuer address

#### IClaimTopicsRegistry.sol
- **Purpose**: Interface for managing required claim topics
- **Methods**:
  - `addClaimTopic()` - Add required topic
  - `removeClaimTopic()` - Remove topic requirement
  - `getClaimTopics()` - Get all required topics
  - `isTopicRequired()` - Check if topic is required

#### ClaimTopicsRegistry.sol
- **Purpose**: Manages required claim topics for compliance
- **Features**:
  - Owner-controlled topic management
  - Standard topics defined: KYC (1), AML (2), ACCREDITED (3), COUNTRY (4)
  - Initialize with KYC and AML topics by default
  - Prevent duplicate topics

#### ITrustedIssuersRegistry.sol
- **Purpose**: Interface for managing trusted claim issuers
- **Methods**:
  - `addTrustedIssuer()` - Add trusted issuer with topics
  - `removeTrustedIssuer()` - Remove issuer from trust list
  - `updateIssuerClaimTopics()` - Update issuer's topics
  - `getTrustedIssuers()` - Get all trusted issuers
  - `isTrustedIssuer()` - Check if address is trusted
  - `getTrustedIssuerClaimTopics()` - Get issuer's topics

#### TrustedIssuersRegistry.sol
- **Purpose**: Registry for trusted claim issuers
- **Features**:
  - Owner-controlled issuer management
  - Per-issuer topic whitelisting
  - Add, remove, and update issuer roles

#### IComplianceModule.sol
- **Purpose**: Interface for pluggable compliance modules
- **Methods**:
  - `canTransfer()` - Check if transfer is allowed
  - `transferred()` - Post-transfer state update
  - `name()` - Get module name

#### IModularCompliance.sol
- **Purpose**: Interface for the modular compliance engine
- **Methods**:
  - `addModule()` - Add compliance module
  - `removeModule()` - Remove module
  - `canTransfer()` - Aggregate check from all modules
  - `transferred()` - Notify all modules of transfer
  - `getModules()` - Get all active modules

#### ModularCompliance.sol
- **Purpose**: Composition engine for compliance modules
- **Features**:
  - Add/remove compliance modules
  - Iterate all modules for transfer validation
  - Post-transfer callbacks for state updates
  - Owner-controlled module management

#### CountryRestrictionModule.sol (src/compliance/modules/)
- **Purpose**: Enforce country-based transfer restrictions
- **Features**:
  - Add/remove restricted countries
  - Check sender and recipient countries
  - Integrate with IdentityRegistry
  - Flexible restriction management
- **Methods**:
  - `addCountryRestriction()` - Restrict a country
  - `removeCountryRestriction()` - Allow a country
  - `setIdentityRegistry()` - Link to identity registry
  - `isCountryRestricted()` - Check restriction status

#### MaxBalanceModule.sol (src/compliance/modules/)
- **Purpose**: Enforce maximum token balance limits
- **Features**:
  - Configurable max balance per holder
  - Prevent transfers exceeding limit
  - Update-able balance limit
- **Methods**:
  - `setMaxBalance()` - Set new maximum balance
  - `setToken()` - Link to token contract
  - `getMaxBalance()` - Get current limit

### Token Layer (src/token/)

#### BXOSecurityToken.sol
- **Purpose**: ERC-3643 compliant security token with all regulatory controls
- **Features**:
  - ERC-20 standard token
  - Transfer restrictions based on:
    - Identity verification via IdentityRegistry
    - Compliance module checks
    - Account freeze status
    - Paused state
  - Role-based access control:
    - DEFAULT_ADMIN_ROLE - Overall admin
    - AGENT_ROLE - Forced transfer, freeze, recovery
    - MINTER_ROLE - Token minting
    - BURNER_ROLE - Token burning
    - PAUSER_ROLE - Pause/unpause
  - Advanced features:
    - `mint()` / `batchMint()` - Create tokens
    - `burn()` / `batchBurn()` - Destroy tokens
    - `freezeAddress()` / `unfreezeAddress()` - Account freeze control
    - `forcedTransfer()` - Regulatory-mandated transfers
    - `recoveryAddress()` - Token recovery for lost wallets
    - `pause()` / `unpause()` - Global transfer pause
    - `setIdentityRegistry()` - Update identity registry
    - `setCompliance()` - Update compliance engine

**Transfer Flow**:
1. Check if contract is paused
2. Check if sender/receiver is frozen
3. Check if sender/receiver is registered in IdentityRegistry
4. Run all compliance module checks
5. Execute transfer
6. Call post-transfer hooks on compliance modules

#### BXOSecurityTokenFactory.sol
- **Purpose**: Factory contract for deploying complete token ecosystems
- **Features**:
  - Deploy new tokens with proper initialization
  - Optionally mint initial supply
  - Track all deployments
  - Store deployment metadata
- **Methods**:
  - `deployToken()` - Deploy new token
  - `getDeployedTokens()` - List all tokens
  - `getDeployedTokensCount()` - Count tokens
  - `getTokenInfo()` - Retrieve deployment info

### Mocks and Test Support (src/mocks/)

#### MockClaimIssuer.sol
- **Purpose**: Test helper for claim issuer verification
- **Features**:
  - Returns true for all claim validations (for testing)
  - Tracks issuer address

## Deployment Sequence

1. **Deploy Registries**:
   ```solidity
   claimTopicsRegistry = new ClaimTopicsRegistry()
   trustedIssuersRegistry = new TrustedIssuersRegistry()
   ```

2. **Deploy IdentityRegistry**:
   ```solidity
   identityRegistry = new IdentityRegistry()
   identityRegistry.initialize(admin, registrar, trustedIssuersRegistry, claimTopicsRegistry)
   ```

3. **Deploy Compliance Engine and Modules**:
   ```solidity
   compliance = new ModularCompliance()
   countryModule = new CountryRestrictionModule(identityRegistry)
   maxBalanceModule = new MaxBalanceModule(maxBalance, token)
   compliance.addModule(countryModule)
   compliance.addModule(maxBalanceModule)
   ```

4. **Deploy Token**:
   ```solidity
   token = new BXOSecurityToken(
       "BlockXOne Security Token",
       "BXO-T",
       18,
       admin,
       identityRegistry,
       compliance
   )
   ```

5. **Or use Factory** (simplified):
   ```solidity
   factory = new BXOSecurityTokenFactory()
   token = factory.deployToken(
       name, symbol, decimals,
       identityRegistry, compliance,
       initialSupply
   )
   ```

## Integration Example

```solidity
// 1. Create identity for investor
identity = new Identity(investorAddress)

// 2. Register investor
identityRegistry.registerIdentity(investorAddress, identity, 840) // 840 = US

// 3. Add KYC claim to identity
identity.addClaim(
    1,  // KYC topic
    1,  // ECDSA scheme
    issuerAddress,
    signature,
    kycData,
    "https://kyc-provider.com/claim/123"
)

// 4. Add trusted issuer for KYC topic
trustedIssuersRegistry.addTrustedIssuer(issuer, [1])

// 5. Now investor can receive tokens
token.mint(investorAddress, ethers.parseEther("1000"))

// 6. Investor can transfer tokens
token.transfer(investor2Address, ethers.parseEther("100"))
```

## Security Features

1. **Identity Verification**: All transfers require verified identities
2. **Claim-Based Compliance**: Identity verified via trusted issuer claims
3. **Modular Restrictions**: Composable compliance rules
4. **Freeze Mechanism**: Immediate account lockdown capability
5. **Forced Transfer**: Regulatory override for compliance
6. **Token Recovery**: Recovery mechanism for lost wallets
7. **Role-Based Access**: Fine-grained permission control
8. **Pausable**: Emergency pause mechanism
9. **Country Restrictions**: Geographic compliance
10. **Balance Caps**: Maximum holding limits

## Testing

Comprehensive test suite in `test/BXOSecurityToken.test.ts` covers:

- Deployment and initialization
- Identity registry operations
- Claim topics management
- Trusted issuers management
- Token minting and burning (single and batch)
- Freeze/unfreeze functionality
- Pause/unpause operations
- Forced transfers
- Token recovery
- Modular compliance engine
- Country restrictions
- Maximum balance enforcement
- Edge cases and security scenarios
- Factory deployment

### Run Tests

```bash
cd contracts
npm install
npm test
```

## Solidity Version

- **Pragma**: `^0.8.20`
- **OpenZeppelin**: v5.x
- **Hardhat**: Latest stable

## Gas Optimization Considerations

1. **Batch Operations**: Use batch mint/burn/freeze for efficiency
2. **Module Optimization**: Minimize active compliance modules
3. **Cache Registry References**: Store in contract state where possible
4. **Claim Lookup**: Maintain indexed access to claims by topic

## Future Enhancements

1. **Oracle Integration**: Dynamic country restrictions via Chainlink
2. **Advanced Claim Types**: Encrypted claims, temporal validity
3. **Multi-Signature Control**: Require multiple signatures for sensitive operations
4. **Token Transfer Hooks**: ERC-1155 style hooks for advanced DeFi
5. **Governance**: DAO-controlled compliance updates
6. **Dividend Distribution**: Integrated dividend mechanisms
7. **Atomic Swaps**: P2P token exchange with identity verification

## Compliance Standards

- **ERC-20**: Full compatibility
- **ERC-3643**: Complete implementation (T-REX)
- **ERC-734/735**: Identity management foundation
- **OpenZeppelin**: Best practices and audited code

## License

MIT License - See individual files for details

## Support and Documentation

- Detailed NatSpec comments in all contracts
- Comprehensive test examples
- Type-safe TypeScript tests
- Full event logging for off-chain tracking

---

**Implementation Date**: 2026-03-29
**Status**: Production Ready
**Audit Status**: Ready for external audit
