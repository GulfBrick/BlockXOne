# Quick Start Guide - ERC-3643 Security Tokens

## Deployment Steps

### 1. Deploy Registries

```solidity
// Deploy Claim Topics Registry
ClaimTopicsRegistry claimTopicsRegistry = new ClaimTopicsRegistry();
// Initialized with KYC (1) and AML (2) topics

// Deploy Trusted Issuers Registry
TrustedIssuersRegistry trustedIssuersRegistry = new TrustedIssuersRegistry();
```

### 2. Deploy Identity Registry

```solidity
IdentityRegistry identityRegistry = new IdentityRegistry();
identityRegistry.initialize(
    adminAddress,
    registrarAddress,
    address(trustedIssuersRegistry),
    address(claimTopicsRegistry)
);
```

### 3. Deploy Compliance Engine

```solidity
// Core compliance engine
ModularCompliance compliance = new ModularCompliance();

// Add country restriction module
CountryRestrictionModule countryModule = new CountryRestrictionModule(
    address(identityRegistry)
);
compliance.addModule(address(countryModule));

// Add max balance module (requires token address, deploy empty first)
MaxBalanceModule maxBalanceModule = new MaxBalanceModule(
    ethers.parseEther("1000000"), // 1M token max per investor
    address(token) // Will be set after token deployment
);
compliance.addModule(address(maxBalanceModule));
```

### 4. Deploy Security Token

```solidity
BXOSecurityToken token = new BXOSecurityToken(
    "BlockXOne Security Token",  // name
    "BXO-T",                      // symbol
    18,                           // decimals
    adminAddress,                 // admin
    address(identityRegistry),    // identity registry
    address(compliance)           // compliance engine
);
```

### Alternative: Use Factory

```solidity
BXOSecurityTokenFactory factory = new BXOSecurityTokenFactory();

address newToken = factory.deployToken(
    "BlockXOne Security Token",
    "BXO-T",
    18,
    address(identityRegistry),
    address(compliance),
    ethers.parseEther("10000000") // Initial supply
);
```

## Investor Onboarding Flow

### Step 1: Create Identity Contract

```solidity
// For each investor
Identity identity = new Identity(investorAddress);
```

### Step 2: Register Investor

```solidity
// Register with country code (ISO 3166-1 alpha-2)
identityRegistry.registerIdentity(
    investorAddress,
    address(identity),
    840 // US = 840, UK = 826, etc.
);
```

### Step 3: Add KYC Claim

```solidity
// Issuer adds KYC claim to investor's identity
identity.addClaim(
    1,  // TOPIC_KYC
    1,  // ECDSA signature scheme
    kycIssuerAddress,
    signatureBytes,
    kycDataBytes,
    "https://kyc-provider.com/claim/123"
);
```

### Step 4: Add AML Claim

```solidity
// Issuer adds AML claim
identity.addClaim(
    2,  // TOPIC_AML
    1,  // ECDSA scheme
    amlIssuerAddress,
    signatureBytes,
    amlDataBytes,
    "https://aml-provider.com/check/456"
);
```

### Step 5: Register Trusted Issuers

```solidity
// Add KYC issuer as trusted for topic 1
trustedIssuersRegistry.addTrustedIssuer(
    IClaimIssuer(kycIssuerAddress),
    [1] // Can issue KYC claims
);

// Add AML issuer as trusted for topic 2
trustedIssuersRegistry.addTrustedIssuer(
    IClaimIssuer(amlIssuerAddress),
    [2] // Can issue AML claims
);
```

## Token Operations

### Minting Tokens

```solidity
// Single mint (requires MINTER_ROLE)
token.mint(investorAddress, ethers.parseEther("1000"));

// Batch mint
address[] memory recipients = [investor1, investor2, investor3];
uint256[] memory amounts = [
    ethers.parseEther("1000"),
    ethers.parseEther("2000"),
    ethers.parseEther("1500")
];
token.batchMint(recipients, amounts);
```

### Transfers

```solidity
// Normal transfer (requires identity verification + compliance)
token.transfer(recipientAddress, ethers.parseEther("100"));

// Verify transfer is allowed before sending
bool canTransfer = compliance.canTransfer(
    senderAddress,
    recipientAddress,
    ethers.parseEther("100")
);
require(canTransfer, "Transfer not allowed");
```

### Account Control

```solidity
// Freeze an account (prevents all transfers)
token.freezeAddress(investorAddress);

// Unfreeze account
token.unfreezeAddress(investorAddress);

// Batch freeze
address[] memory toFreeze = [investor1, investor2];
token.batchFreezeAddress(toFreeze);

// Check if frozen
bool isFrozen = token.isFrozen(investorAddress);
```

### Emergency Controls

```solidity
// Pause all transfers
token.pause();

// Resume transfers
token.unpause();

// Forced transfer (AGENT_ROLE only, bypasses restrictions)
token.forcedTransfer(
    investorAddress,
    regulatorAddress,
    ethers.parseEther("500")
);

// Recovery (for lost wallets)
token.recoveryAddress(
    lostWalletAddress,
    recoveryWalletAddress,
    ethers.parseEther("1000")
);
```

## Compliance Management

### Country Restrictions

```solidity
// Restrict Russia (ISO 643)
countryModule.addCountryRestriction(643);

// Now transfers to/from Russian investors blocked
// token.transfer(russianInvestor, 100) // Reverts

// Remove restriction
countryModule.removeCountryRestriction(643);
```

### Balance Limits

```solidity
// Set max balance to 500K tokens
maxBalanceModule.setMaxBalance(ethers.parseEther("500000"));

// Now transfers exceeding 500K per holder rejected
// token.transfer(holder, 600000 ether) // Reverts if holder has > 100K
```

### Update Registries

```solidity
// Update investor country
identityRegistry.updateCountry(investorAddress, 826); // Change to UK

// Update claim topic requirements
claimTopicsRegistry.addClaimTopic(3); // Add ACCREDITED topic

// Update trusted issuer topics
trustedIssuersRegistry.updateIssuerClaimTopics(
    IClaimIssuer(issuerAddress),
    [1, 2, 3] // Now can issue KYC, AML, ACCREDITED
);
```

## Testing

### Run Full Test Suite

```bash
cd contracts
npm install
npm test
```

### Test Specific Contract

```bash
npx hardhat test test/BXOSecurityToken.test.ts
```

### Run With Gas Report

```bash
REPORT_GAS=true npx hardhat test
```

## Key Roles

| Role | Purpose | Methods |
|------|---------|---------|
| DEFAULT_ADMIN_ROLE | Admin of all operations | All sensitive operations |
| REGISTRAR_ROLE | Manage identity registry | registerIdentity, deleteIdentity |
| MINTER_ROLE | Create tokens | mint, batchMint |
| BURNER_ROLE | Destroy tokens | burn, batchBurn |
| AGENT_ROLE | Regulatory override | forcedTransfer, freezeAddress, recovery |
| PAUSER_ROLE | Emergency pause | pause, unpause |

## Access Control Example

```solidity
// Grant roles
token.grantRole(token.MINTER_ROLE(), minterAddress);
token.grantRole(token.AGENT_ROLE(), agentAddress);
token.grantRole(token.PAUSER_ROLE(), pauserAddress);

// Revoke roles
token.revokeRole(token.MINTER_ROLE(), oldMinterAddress);

// Check role
bool isMinter = token.hasRole(token.MINTER_ROLE(), address);
```

## Events to Monitor

```solidity
// Identity events
event IdentityRegistered(address indexed investor, address indexed identity, uint16 country);
event IdentityDeleted(address indexed investor);
event CountryUpdated(address indexed investor, uint16 country);

// Token events
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);
event AddressFrozen(address indexed account);
event AddressUnfrozen(address indexed account);
event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent);
event RecoverySuccess(address indexed original, address indexed recovery, uint256 amount);
event Paused(address indexed account);
event Unpaused(address indexed account);
```

## Security Checklist

- [ ] All admin keys secured with multi-sig
- [ ] Trusted issuers properly vetted
- [ ] Initial claim topics set correctly
- [ ] Country restrictions configured
- [ ] Max balance limits reviewed
- [ ] Test suite passes completely
- [ ] Contracts externally audited
- [ ] Deployment variables double-checked
- [ ] Emergency pause tested
- [ ] Role assignments verified
- [ ] Event logging confirmed
- [ ] Gas optimization reviewed

## Troubleshooting

**Transfer fails with "UnverifiedIdentity"**
- Investor must be registered in IdentityRegistry
- Check: `identityRegistry.contains(investorAddress)`

**Transfer fails with "ComplianceCheckFailed"**
- Check compliance module restrictions
- May be due to: country restriction, max balance, or other module rule
- Verify: `compliance.canTransfer(from, to, amount)`

**Claim not recognized**
- Issuer must be trusted for that claim topic
- Check: `trustedIssuersRegistry.isTrustedIssuer(issuer)`

**Account frozen - can't transfer**
- Use `token.unfreezeAddress(account)` to unfreeze
- Or use `token.forcedTransfer()` with AGENT_ROLE

**Token paused**
- Call `token.unpause()` with PAUSER_ROLE
- Use in emergency situations only

## Next Steps

1. Deploy to testnet (Sepolia/Goerli)
2. Run integration tests
3. Request external security audit
4. Deploy to mainnet after audit
5. Implement monitoring and alerting
6. Document operational procedures
7. Train support team

## Resources

- ERC-3643 Specification: https://eips.ethereum.org/EIPS/eip-3643
- OpenZeppelin Docs: https://docs.openzeppelin.com/
- Hardhat Docs: https://hardhat.org/docs
- ethers.js v6: https://docs.ethers.org/v6/

---

For questions or issues, refer to `ERC3643_IMPLEMENTATION.md` for detailed architecture documentation.
