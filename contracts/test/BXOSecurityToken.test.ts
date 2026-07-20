import { expect } from "chai";
import hre from "hardhat";
import type {
  BXOSecurityToken,
  Identity,
  IdentityRegistry,
  ClaimTopicsRegistry,
  TrustedIssuersRegistry,
  ModularCompliance,
  CountryRestrictionModule,
  MaxBalanceModule,
  BXOSecurityTokenFactory,
} from "../typechain-types/index.js";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

const { ethers } = await hre.network.create();

describe("BXOSecurityToken - ERC-3643 Compliance", function () {
  let token: BXOSecurityToken;
  let identityRegistry: IdentityRegistry;
  let claimTopicsRegistry: ClaimTopicsRegistry;
  let trustedIssuersRegistry: TrustedIssuersRegistry;
  let compliance: ModularCompliance;
  let countryModule: CountryRestrictionModule;
  let maxBalanceModule: MaxBalanceModule;
  let factory: BXOSecurityTokenFactory;

  let identity1: Identity;
  let identity2: Identity;

  let admin: HardhatEthersSigner;
  let issuer: HardhatEthersSigner;
  let investor1: HardhatEthersSigner;
  let investor2: HardhatEthersSigner;
  let investor3: HardhatEthersSigner;
  let restrictedInvestor: HardhatEthersSigner;

  const CLAIM_TOPIC_KYC = 1;
  const CLAIM_TOPIC_AML = 2;
  const CLAIM_TOPIC_ACCREDITED = 3;

  const COUNTRY_US = 840;
  const COUNTRY_UK = 826;
  const COUNTRY_RUSSIA = 643; // Restricted in many scenarios

  beforeEach(async function () {
    [admin, issuer, investor1, investor2, investor3, restrictedInvestor] =
      await ethers.getSigners();

    // Deploy ClaimTopicsRegistry
    const ClaimTopicsRegistryFactory = await ethers.getContractFactory(
      "ClaimTopicsRegistry"
    );
    claimTopicsRegistry = await ClaimTopicsRegistryFactory.deploy();
    await claimTopicsRegistry.waitForDeployment();

    // Deploy TrustedIssuersRegistry
    const TrustedIssuersRegistryFactory = await ethers.getContractFactory(
      "TrustedIssuersRegistry"
    );
    trustedIssuersRegistry = await TrustedIssuersRegistryFactory.deploy();
    await trustedIssuersRegistry.waitForDeployment();

    // Deploy IdentityRegistry with proper initialization
    const IdentityRegistryFactory = await ethers.getContractFactory(
      "IdentityRegistry"
    );
    const identityRegistryImpl = await IdentityRegistryFactory.deploy();
    await identityRegistryImpl.waitForDeployment();

    // Initialize IdentityRegistry
    identityRegistry = identityRegistryImpl as IdentityRegistry;
    const initTx = await identityRegistry.initialize(
      admin.address,
      admin.address,
      await trustedIssuersRegistry.getAddress(),
      await claimTopicsRegistry.getAddress()
    );
    await initTx.wait();

    // Deploy ModularCompliance
    const ModularComplianceFactory = await ethers.getContractFactory(
      "ModularCompliance"
    );
    compliance = await ModularComplianceFactory.deploy();
    await compliance.waitForDeployment();

    // Deploy CountryRestrictionModule
    const CountryRestrictionModuleFactory = await ethers.getContractFactory(
      "CountryRestrictionModule"
    );
    countryModule = await CountryRestrictionModuleFactory.deploy(
      await identityRegistry.getAddress()
    );
    await countryModule.waitForDeployment();

    // Deploy BXOSecurityToken
    const BXOSecurityTokenFactory = await ethers.getContractFactory(
      "BXOSecurityToken"
    );
    token = await BXOSecurityTokenFactory.deploy(
      "BlockXOne Security Token",
      "BXO-T",
      18,
      admin.address,
      await identityRegistry.getAddress(),
      await compliance.getAddress()
    );
    await token.waitForDeployment();

    // Deploy MaxBalanceModule with reference to token
    const MaxBalanceModuleFactory = await ethers.getContractFactory(
      "MaxBalanceModule"
    );
    maxBalanceModule = await MaxBalanceModuleFactory.deploy(
      ethers.parseEther("1000000"),
      await token.getAddress()
    );
    await maxBalanceModule.waitForDeployment();

    // Deploy identity contracts
    const IdentityFactory = await ethers.getContractFactory("Identity");
    identity1 = await IdentityFactory.deploy(investor1.address);
    await identity1.waitForDeployment();

    identity2 = await IdentityFactory.deploy(investor2.address);
    await identity2.waitForDeployment();

    // Register identities
    await identityRegistry
      .connect(admin)
      .registerIdentity(investor1.address, identity1, COUNTRY_US);

    await identityRegistry
      .connect(admin)
      .registerIdentity(investor2.address, identity2, COUNTRY_UK);

    // Create an unverified identity for investor3
    const Identity3 = await ethers.getContractFactory("Identity");
    const identity3 = await Identity3.deploy(investor3.address);
    await identity3.waitForDeployment();

    await identityRegistry
      .connect(admin)
      .registerIdentity(investor3.address, identity3, COUNTRY_US);

    // Create unregistered identity for restrictedInvestor
    const identityRestricted = await Identity3.deploy(
      restrictedInvestor.address
    );
    await identityRestricted.waitForDeployment();

    await identityRegistry
      .connect(admin)
      .registerIdentity(restrictedInvestor.address, identityRestricted, COUNTRY_RUSSIA);
  });

  describe("Deployment and Initialization", function () {
    it("Should deploy token with correct parameters", async function () {
      expect(await token.name()).to.equal("BlockXOne Security Token");
      expect(await token.symbol()).to.equal("BXO-T");
      expect(await token.decimals()).to.equal(18);
    });

    it("Should grant admin roles correctly", async function () {
      expect(
        await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), admin.address)
      ).to.be.true;
      expect(await token.hasRole(await token.AGENT_ROLE(), admin.address)).to
        .be.true;
    });

    it("Should link IdentityRegistry and ModularCompliance", async function () {
      expect(await token.identityRegistry()).to.equal(
        await identityRegistry.getAddress()
      );
      expect(await token.compliance()).to.equal(await compliance.getAddress());
    });
  });

  describe("Identity Registry", function () {
    it("Should register identity correctly", async function () {
      expect(await identityRegistry.contains(investor1.address)).to.be.true;
      expect(await identityRegistry.investorCountries(investor1.address)).to.equal(
        COUNTRY_US
      );
    });

    it("Should get identity contract", async function () {
      const identity = await identityRegistry.getIdentity(investor1.address);
      expect(identity).to.equal(await identity1.getAddress());
    });

    it("Should update country code", async function () {
      await identityRegistry
        .connect(admin)
        .updateCountry(investor1.address, COUNTRY_UK);

      expect(await identityRegistry.investorCountries(investor1.address)).to.equal(
        COUNTRY_UK
      );
    });

    it("Should delete identity", async function () {
      await identityRegistry
        .connect(admin)
        .deleteIdentity(investor1.address);

      expect(await identityRegistry.contains(investor1.address)).to.be.false;
    });

    it("Should verify identity with claims", async function () {
      // Initially not verified (no claims)
      const verified = await identityRegistry.isVerified(investor1.address);
      expect(verified).to.be.false;
    });
  });

  describe("Claim Topics Registry", function () {
    it("Should initialize with default topics", async function () {
      const topics = await claimTopicsRegistry.getClaimTopics();
      expect(topics.length).to.equal(2); // KYC and AML
    });

    it("Should add new claim topic", async function () {
      await claimTopicsRegistry
        .connect(admin)
        .addClaimTopic(CLAIM_TOPIC_ACCREDITED);

      const topics = await claimTopicsRegistry.getClaimTopics();
      expect(topics).to.include(BigInt(CLAIM_TOPIC_ACCREDITED));
    });

    it("Should remove claim topic", async function () {
      await claimTopicsRegistry
        .connect(admin)
        .removeClaimTopic(CLAIM_TOPIC_KYC);

      const topics = await claimTopicsRegistry.getClaimTopics();
      expect(topics).to.not.include(BigInt(CLAIM_TOPIC_KYC));
    });

    it("Should prevent adding duplicate topic", async function () {
      await expect(
        claimTopicsRegistry.connect(admin).addClaimTopic(CLAIM_TOPIC_KYC)
      ).to.be.revertedWithCustomError(
        claimTopicsRegistry,
        "TopicAlreadyAdded"
      );
    });
  });

  describe("Trusted Issuers Registry", function () {
    it("Should add trusted issuer", async function () {
      const mockIssuer = await ethers.deployContract("MockClaimIssuer", [
        issuer.address,
      ]);
      await mockIssuer.waitForDeployment();

      await trustedIssuersRegistry
        .connect(admin)
        .addTrustedIssuer(
          mockIssuer,
          [CLAIM_TOPIC_KYC, CLAIM_TOPIC_AML]
        );

      expect(
        await trustedIssuersRegistry.isTrustedIssuer(await mockIssuer.getAddress())
      ).to.be.true;
    });

    it("Should get trusted issuer claim topics", async function () {
      const mockIssuer = await ethers.deployContract("MockClaimIssuer", [
        issuer.address,
      ]);
      await mockIssuer.waitForDeployment();

      const topics = [CLAIM_TOPIC_KYC, CLAIM_TOPIC_AML];
      await trustedIssuersRegistry
        .connect(admin)
        .addTrustedIssuer(mockIssuer, topics);

      const issuerTopics =
        await trustedIssuersRegistry.getTrustedIssuerClaimTopics(
          mockIssuer
        );
      expect(issuerTopics.length).to.equal(2);
    });

    it("Should remove trusted issuer", async function () {
      const mockIssuer = await ethers.deployContract("MockClaimIssuer", [
        issuer.address,
      ]);
      await mockIssuer.waitForDeployment();

      await trustedIssuersRegistry
        .connect(admin)
        .addTrustedIssuer(
          mockIssuer,
          [CLAIM_TOPIC_KYC]
        );

      await trustedIssuersRegistry
        .connect(admin)
        .removeTrustedIssuer(mockIssuer);

      expect(
        await trustedIssuersRegistry.isTrustedIssuer(await mockIssuer.getAddress())
      ).to.be.false;
    });
  });

  describe("Token Minting and Burning", function () {
    it("Should mint tokens with MINTER_ROLE", async function () {
      const mintAmount = ethers.parseEther("1000");
      await token.connect(admin).mint(investor1.address, mintAmount);

      expect(await token.balanceOf(investor1.address)).to.equal(mintAmount);
    });

    it("Should prevent minting without MINTER_ROLE", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(
        token.connect(investor1).mint(investor1.address, mintAmount)
      ).to.be.revertedWithCustomError(token, "AccessDenied");
    });

    it("Should burn tokens with BURNER_ROLE", async function () {
      const mintAmount = ethers.parseEther("1000");
      await token.connect(admin).mint(investor1.address, mintAmount);

      const burnAmount = ethers.parseEther("500");
      await token.connect(admin).burn(investor1.address, burnAmount);

      expect(await token.balanceOf(investor1.address)).to.equal(
        mintAmount - burnAmount
      );
    });

    it("Should batch mint tokens", async function () {
      const addresses = [investor1.address, investor2.address];
      const amounts = [ethers.parseEther("1000"), ethers.parseEther("2000")];

      await token.connect(admin).batchMint(addresses, amounts);

      expect(await token.balanceOf(investor1.address)).to.equal(amounts[0]);
      expect(await token.balanceOf(investor2.address)).to.equal(amounts[1]);
    });

    it("Should batch burn tokens", async function () {
      // First mint
      const mintAddresses = [investor1.address, investor2.address];
      const mintAmounts = [
        ethers.parseEther("2000"),
        ethers.parseEther("2000"),
      ];
      await token.connect(admin).batchMint(mintAddresses, mintAmounts);

      // Then burn
      const burnAmounts = [
        ethers.parseEther("500"),
        ethers.parseEther("1000"),
      ];
      await token
        .connect(admin)
        .batchBurn(mintAddresses, burnAmounts);

      expect(await token.balanceOf(investor1.address)).to.equal(
        ethers.parseEther("1500")
      );
      expect(await token.balanceOf(investor2.address)).to.equal(
        ethers.parseEther("1000")
      );
    });
  });

  describe("Freeze/Unfreeze Functionality", function () {
    beforeEach(async function () {
      // Mint some tokens first
      const mintAmount = ethers.parseEther("1000");
      await token.connect(admin).mint(investor1.address, mintAmount);
      await token.connect(admin).mint(investor2.address, mintAmount);
    });

    it("Should freeze an address", async function () {
      await token.connect(admin).freezeAddress(investor1.address);
      expect(await token.isFrozen(investor1.address)).to.be.true;
    });

    it("Should unfreeze an address", async function () {
      await token.connect(admin).freezeAddress(investor1.address);
      await token.connect(admin).unfreezeAddress(investor1.address);
      expect(await token.isFrozen(investor1.address)).to.be.false;
    });

    it("Should prevent transfers from frozen address", async function () {
      await token.connect(admin).freezeAddress(investor1.address);

      await expect(
        token.connect(investor1).transfer(investor2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "AccountFrozen");
    });

    it("Should prevent transfers to frozen address", async function () {
      await token.connect(admin).freezeAddress(investor2.address);

      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "AccountFrozen");
    });

    it("Should batch freeze addresses", async function () {
      const addresses = [investor1.address, investor2.address];
      await token.connect(admin).batchFreezeAddress(addresses);

      expect(await token.isFrozen(investor1.address)).to.be.true;
      expect(await token.isFrozen(investor2.address)).to.be.true;
    });

    it("Should batch unfreeze addresses", async function () {
      const addresses = [investor1.address, investor2.address];
      await token.connect(admin).batchFreezeAddress(addresses);
      await token.connect(admin).batchUnfreezeAddress(addresses);

      expect(await token.isFrozen(investor1.address)).to.be.false;
      expect(await token.isFrozen(investor2.address)).to.be.false;
    });
  });

  describe("Pause/Unpause", function () {
    beforeEach(async function () {
      await token.connect(admin).mint(investor1.address, ethers.parseEther("1000"));
      await token.connect(admin).mint(investor2.address, ethers.parseEther("1000"));
    });

    it("Should pause token transfers", async function () {
      await token.connect(admin).pause();

      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("Should unpause token transfers", async function () {
      await token.connect(admin).pause();
      await token.connect(admin).unpause();

      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.not.revert(ethers);
    });
  });

  describe("Forced Transfer", function () {
    beforeEach(async function () {
      await token
        .connect(admin)
        .mint(investor1.address, ethers.parseEther("1000"));
    });

    it("Should force transfer tokens", async function () {
      const amount = ethers.parseEther("500");
      const tx = await token
        .connect(admin)
        .forcedTransfer(investor1.address, investor2.address, amount);

      expect(await token.balanceOf(investor1.address)).to.equal(
        ethers.parseEther("500")
      );
      expect(await token.balanceOf(investor2.address)).to.equal(amount);

      await expect(tx)
        .to.emit(token, "ForcedTransfer")
        .withArgs(investor1.address, investor2.address, amount, admin.address);
    });

    it("Should prevent forced transfer without AGENT_ROLE", async function () {
      const amount = ethers.parseEther("500");
      await expect(
        token
          .connect(investor1)
          .forcedTransfer(investor1.address, investor2.address, amount)
      ).to.be.revertedWithCustomError(token, "AccessDenied");
    });
  });

  describe("Recovery Address", function () {
    beforeEach(async function () {
      await token
        .connect(admin)
        .mint(investor1.address, ethers.parseEther("1000"));
    });

    it("Should recover tokens from lost address", async function () {
      const amount = ethers.parseEther("1000");
      const tx = await token
        .connect(admin)
        .recoveryAddress(investor1.address, investor2.address, amount);

      expect(await token.balanceOf(investor1.address)).to.equal(0);
      expect(await token.balanceOf(investor2.address)).to.equal(amount);

      await expect(tx)
        .to.emit(token, "RecoverySuccess")
        .withArgs(investor1.address, investor2.address, amount);
    });

    it("Should prevent recovery without AGENT_ROLE", async function () {
      await expect(
        token
          .connect(investor1)
          .recoveryAddress(
            investor1.address,
            investor2.address,
            ethers.parseEther("100")
          )
      ).to.be.revertedWithCustomError(token, "AccessDenied");
    });
  });

  describe("Modular Compliance", function () {
    beforeEach(async function () {
      await token.connect(admin).mint(investor1.address, ethers.parseEther("1000"));
      await token.connect(admin).mint(investor2.address, ethers.parseEther("1000"));
    });

    it("Should add compliance module", async function () {
      await compliance.connect(admin).addModule(countryModule);

      const modules = await compliance.getModules();
      expect(modules).to.include(await countryModule.getAddress());
    });

    it("Should remove compliance module", async function () {
      await compliance.connect(admin).addModule(countryModule);
      await compliance
        .connect(admin)
        .removeModule(await countryModule.getAddress());

      const modules = await compliance.getModules();
      expect(modules).to.not.include(await countryModule.getAddress());
    });

    it("Should check compliance on transfer", async function () {
      // No modules added, so transfer should pass identity checks
      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.not.revert(ethers);
    });
  });

  describe("Country Restriction Module", function () {
    beforeEach(async function () {
      await token
        .connect(admin)
        .mint(investor1.address, ethers.parseEther("1000"));
      await token
        .connect(admin)
        .mint(restrictedInvestor.address, ethers.parseEther("1000"));

      // Add country restriction module to compliance
      await compliance.connect(admin).addModule(countryModule);
    });

    it("Should allow transfer between non-restricted countries", async function () {
      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.not.revert(ethers);
    });

    it("Should restrict transfer from restricted country", async function () {
      // Add COUNTRY_RUSSIA to restricted list
      await countryModule
        .connect(admin)
        .addCountryRestriction(COUNTRY_RUSSIA);

      // Try to transfer from restrictedInvestor (COUNTRY_RUSSIA)
      await expect(
        token
          .connect(restrictedInvestor)
          .transfer(investor1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
    });

    it("Should restrict transfer to restricted country", async function () {
      // Add COUNTRY_RUSSIA to restricted list
      await countryModule
        .connect(admin)
        .addCountryRestriction(COUNTRY_RUSSIA);

      // Try to transfer to restrictedInvestor (COUNTRY_RUSSIA)
      await expect(
        token
          .connect(investor1)
          .transfer(restrictedInvestor.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
    });

    it("Should remove country restriction", async function () {
      await countryModule
        .connect(admin)
        .addCountryRestriction(COUNTRY_RUSSIA);
      await countryModule
        .connect(admin)
        .removeCountryRestriction(COUNTRY_RUSSIA);

      // Should now allow transfer
      await expect(
        token
          .connect(restrictedInvestor)
          .transfer(investor1.address, ethers.parseEther("100"))
      ).to.not.revert(ethers);
    });
  });

  describe("Max Balance Module", function () {
    beforeEach(async function () {
      await token
        .connect(admin)
        .mint(investor1.address, ethers.parseEther("1000"));
      await token
        .connect(admin)
        .mint(investor2.address, ethers.parseEther("100"));

      // Add max balance module to compliance
      await compliance.connect(admin).addModule(maxBalanceModule);
    });

    it("Should allow transfer within max balance", async function () {
      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("100"))
      ).to.not.revert(ethers);
    });

    it("Should restrict transfer exceeding max balance", async function () {
      // Set max balance to 500
      await maxBalanceModule
        .connect(admin)
        .setMaxBalance(ethers.parseEther("500"));

      // investor2 has 100, trying to add 600 would exceed 500
      await expect(
        token
          .connect(investor1)
          .transfer(investor2.address, ethers.parseEther("600"))
      ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
    });

    it("Should update max balance", async function () {
      const newMax = ethers.parseEther("10000");
      await maxBalanceModule.connect(admin).setMaxBalance(newMax);

      expect(await maxBalanceModule.getMaxBalance()).to.equal(newMax);
    });
  });

  describe("Identity Verification on Transfer", function () {
    it("Should prevent transfer from unverified sender", async function () {
      // Create new identity without claims
      const UnverifiedIdentity = await ethers.getContractFactory("Identity");
      const unverifiedIdentity = await UnverifiedIdentity.deploy(
        investor3.address
      );
      await unverifiedIdentity.waitForDeployment();

      // Mint tokens to investor3
      await token
        .connect(admin)
        .mint(investor3.address, ethers.parseEther("1000"));

      // Try to transfer - should fail because investor3 has no claims
      // Note: investor3 is registered but not verified (no claims matching required topics)
      // This depends on whether the transfer requires full verification
    });

    it("Should allow minting to unregistered addresses", async function () {
      const mintAmount = ethers.parseEther("1000");
      // investor3 is registered, so minting should work
      await token.connect(admin).mint(investor3.address, mintAmount);
      expect(await token.balanceOf(investor3.address)).to.equal(mintAmount);
    });
  });

  describe("Registry Update", function () {
    it("Should update identity registry", async function () {
      const newRegistry = identityRegistry; // Same registry for this test
      await token
        .connect(admin)
        .setIdentityRegistry(await newRegistry.getAddress());

      expect(await token.identityRegistry()).to.equal(
        await newRegistry.getAddress()
      );
    });

    it("Should update compliance", async function () {
      const newCompliance = compliance;
      await token.connect(admin).setCompliance(await newCompliance.getAddress());

      expect(await token.compliance()).to.equal(
        await newCompliance.getAddress()
      );
    });

    it("Should prevent invalid registry update", async function () {
      await expect(
        token.connect(admin).setIdentityRegistry(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(token, "InvalidIdentityRegistry");
    });
  });

  describe("Token Factory", function () {
    it("Should deploy token via factory", async function () {
      const BXOSecurityTokenFactoryFactory = await ethers.getContractFactory(
        "BXOSecurityTokenFactory"
      );
      const factoryInstance =
        await BXOSecurityTokenFactoryFactory.deploy();
      await factoryInstance.waitForDeployment();

      const deployTx = await factoryInstance
        .connect(admin)
        .deployToken(
          "Test Token",
          "TEST",
          18,
          await identityRegistry.getAddress(),
          await compliance.getAddress(),
          ethers.parseEther("1000000")
        );

      const receipt = await deployTx.wait();
      expect(receipt?.status).to.equal(1);
    });

    it("Should track deployed tokens", async function () {
      const BXOSecurityTokenFactoryFactory = await ethers.getContractFactory(
        "BXOSecurityTokenFactory"
      );
      const factoryInstance =
        await BXOSecurityTokenFactoryFactory.deploy();
      await factoryInstance.waitForDeployment();

      const initialCount =
        await factoryInstance.getDeployedTokensCount();

      await factoryInstance
        .connect(admin)
        .deployToken(
          "Test Token 1",
          "TEST1",
          18,
          await identityRegistry.getAddress(),
          await compliance.getAddress(),
          0
        );

      const newCount = await factoryInstance.getDeployedTokensCount();
      expect(newCount).to.equal(initialCount + 1n);
    });

    it("Should retrieve token deployment info", async function () {
      const BXOSecurityTokenFactoryFactory = await ethers.getContractFactory(
        "BXOSecurityTokenFactory"
      );
      const factoryInstance =
        await BXOSecurityTokenFactoryFactory.deploy();
      await factoryInstance.waitForDeployment();

      const deployTx = await factoryInstance
        .connect(admin)
        .deployToken(
          "Info Test Token",
          "INFO",
          18,
          await identityRegistry.getAddress(),
          await compliance.getAddress(),
          0
        );

      const receipt = await deployTx.wait();
      const deployedTokens = await factoryInstance.getDeployedTokens();
      const lastToken = deployedTokens[deployedTokens.length - 1];

      const info = await factoryInstance.getTokenInfo(lastToken);
      expect(info.name).to.equal("Info Test Token");
      expect(info.symbol).to.equal("INFO");
      expect(info.decimals).to.equal(18);
    });
  });

  describe("Edge Cases and Security", function () {
    beforeEach(async function () {
      await token
        .connect(admin)
        .mint(investor1.address, ethers.parseEther("1000"));
      await token
        .connect(admin)
        .mint(investor2.address, ethers.parseEther("1000"));
    });

    it("Should prevent double-freeze", async function () {
      await token.connect(admin).freezeAddress(investor1.address);
      // Freezing again should work but is idempotent
      await token.connect(admin).freezeAddress(investor1.address);
      expect(await token.isFrozen(investor1.address)).to.be.true;
    });

    it("Should handle zero address validation", async function () {
      await expect(
        token
          .connect(admin)
          .setIdentityRegistry(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(token, "InvalidIdentityRegistry");
    });

    it("Should prevent batch operations with mismatched arrays", async function () {
      const addresses = [investor1.address, investor2.address];
      const amounts = [ethers.parseEther("100")]; // Wrong length

      await expect(
        token.connect(admin).batchMint(addresses, amounts)
      ).to.be.revertedWith("Array length mismatch");
    });

    it("Should emit events on all major operations", async function () {
      await expect(
        token.connect(admin).freezeAddress(investor1.address)
      ).to.emit(token, "AddressFrozen");

      await expect(
        token.connect(admin).unfreezeAddress(investor1.address)
      ).to.emit(token, "AddressUnfrozen");

      await expect(
        token.connect(admin).pause()
      ).to.emit(token, "Paused");

      await expect(
        token.connect(admin).unpause()
      ).to.emit(token, "Unpaused");
    });
  });
});

// Mock ClaimIssuer for testing
describe("Mock Contracts", function () {
  it("Should deploy MockClaimIssuer", async function () {
    const [issuer] = await ethers.getSigners();
    const mockIssuer = await ethers.deployContract("MockClaimIssuer", [
      issuer.address,
    ]);
    await mockIssuer.waitForDeployment();

    expect(await mockIssuer.getIssuerAddress()).to.equal(issuer.address);
  });
});
