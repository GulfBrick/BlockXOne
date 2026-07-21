import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type {
  BXOSecurityToken,
  ClaimTopicsRegistry,
  CountryRestrictionModule,
  Identity,
  IdentityRegistry,
  MaxBalanceModule,
  MockClaimIssuer,
  MockGovernanceExecutor,
  MockIssuanceCompliance,
  MockIssuanceReentryClaimIssuer,
  ModularCompliance,
  TrustedIssuersRegistry,
} from "../typechain-types/index.js";

const { ethers } = await hre.network.create();

const TOPIC_KYC = 1n;
const TOPIC_AML = 2n;
const CLAIM_SCHEME = 1n;
const COUNTRY_US = 840;
const COUNTRY_UK = 826;
const COUNTRY_RESTRICTED = 643;
const SIGNATURE = "0x010203";
const CLAIM_DATA = "0xa1b2c3";

const MODULES_CONFIGURED = 0;
const MODULES_EMPTY = 1;
const MODULES_ZERO_ADDRESS = 2;
const MODULES_REVERT = 3;
const MODULES_SHORT = 4;
const MODULES_WRONG_OFFSET = 5;
const MODULES_OVERSIZED = 6;
const MODULES_DIRTY_ADDRESS = 7;

const DECISION_ALLOW = 0;
const DECISION_REJECT = 1;
const DECISION_REVERT = 2;
const DECISION_SHORT = 3;
const DECISION_INVALID_BOOL = 4;
const DECISION_OVERSIZED = 5;

const REENTRY_DISABLED = 0;
const REENTRY_FORCE_FROM_MINT = 1;
const REENTRY_MINT_FROM_FORCE = 2;

interface Fixture {
  admin: HardhatEthersSigner;
  agentOnly: HardhatEthersSigner;
  forcedEoa: HardhatEthersSigner;
  investor1: HardhatEthersSigner;
  investor2: HardhatEthersSigner;
  restrictedInvestor: HardhatEthersSigner;
  unverifiedInvestor: HardhatEthersSigner;
  unregisteredInvestor: HardhatEthersSigner;
  reentryInvestor: HardhatEthersSigner;
  identityRegistry: IdentityRegistry;
  claimTopics: ClaimTopicsRegistry;
  trustedIssuers: TrustedIssuersRegistry;
  claimIssuer: MockClaimIssuer;
  compliance: ModularCompliance;
  countryModule: CountryRestrictionModule;
  token: BXOSecurityToken;
  unverifiedIdentity: Identity;
}

async function addClaims(
  identity: Identity,
  owner: HardhatEthersSigner,
  issuer: string,
): Promise<void> {
  await identity
    .connect(owner)
    .addClaim(TOPIC_KYC, CLAIM_SCHEME, issuer, SIGNATURE, CLAIM_DATA, "kyc");
  await identity
    .connect(owner)
    .addClaim(TOPIC_AML, CLAIM_SCHEME, issuer, "0x040506", "0xb1b2", "aml");
}

async function registerInvestor(
  fixture: Pick<Fixture, "admin" | "identityRegistry">,
  investor: HardhatEthersSigner,
  country: number,
  issuer?: string,
): Promise<Identity> {
  const identity = (await ethers.deployContract("Identity", [
    investor.address,
  ])) as Identity;
  await identity.waitForDeployment();
  await fixture.identityRegistry
    .connect(fixture.admin)
    .registerIdentity(investor.address, await identity.getAddress(), country);
  if (issuer !== undefined) await addClaims(identity, investor, issuer);
  return identity;
}

async function deployFixture(): Promise<Fixture> {
  const [
    admin,
    agentOnly,
    forcedEoa,
    investor1,
    investor2,
    restrictedInvestor,
    unverifiedInvestor,
    unregisteredInvestor,
    issuerOwner,
    reentryInvestor,
  ] = await ethers.getSigners();

  const claimTopics = (await ethers.deployContract(
    "ClaimTopicsRegistry",
  )) as ClaimTopicsRegistry;
  const trustedIssuers = (await ethers.deployContract(
    "TrustedIssuersRegistry",
  )) as TrustedIssuersRegistry;
  const identityRegistry = (await ethers.deployContract(
    "IdentityRegistry",
  )) as IdentityRegistry;
  const claimIssuer = (await ethers.deployContract("MockClaimIssuer", [
    issuerOwner.address,
  ])) as MockClaimIssuer;

  await Promise.all([
    claimTopics.waitForDeployment(),
    trustedIssuers.waitForDeployment(),
    identityRegistry.waitForDeployment(),
    claimIssuer.waitForDeployment(),
  ]);

  await identityRegistry.initialize(
    admin.address,
    admin.address,
    await trustedIssuers.getAddress(),
    await claimTopics.getAddress(),
  );
  await trustedIssuers.addTrustedIssuer(await claimIssuer.getAddress(), [
    TOPIC_KYC,
    TOPIC_AML,
  ]);

  const partial = { admin, identityRegistry };
  await registerInvestor(
    partial,
    investor1,
    COUNTRY_US,
    await claimIssuer.getAddress(),
  );
  await registerInvestor(
    partial,
    investor2,
    COUNTRY_UK,
    await claimIssuer.getAddress(),
  );
  await registerInvestor(
    partial,
    restrictedInvestor,
    COUNTRY_RESTRICTED,
    await claimIssuer.getAddress(),
  );
  const unverifiedIdentity = await registerInvestor(
    partial,
    unverifiedInvestor,
    COUNTRY_US,
  );

  const compliance = (await ethers.deployContract(
    "ModularCompliance",
  )) as ModularCompliance;
  const countryModule = (await ethers.deployContract(
    "CountryRestrictionModule",
    [await identityRegistry.getAddress()],
  )) as CountryRestrictionModule;
  await Promise.all([
    compliance.waitForDeployment(),
    countryModule.waitForDeployment(),
  ]);
  await compliance.addModule(await countryModule.getAddress());

  const token = (await ethers.deployContract("BXOSecurityToken", [
    "BlockXOne Security Token",
    "BXO-T",
    6,
    admin.address,
    await identityRegistry.getAddress(),
    await compliance.getAddress(),
  ])) as BXOSecurityToken;
  await token.waitForDeployment();
  await token.grantRole(await token.AGENT_ROLE(), agentOnly.address);

  return {
    admin,
    agentOnly,
    forcedEoa,
    investor1,
    investor2,
    restrictedInvestor,
    unverifiedInvestor,
    unregisteredInvestor,
    reentryInvestor,
    identityRegistry,
    claimTopics,
    trustedIssuers,
    claimIssuer,
    compliance,
    countryModule,
    token,
    unverifiedIdentity,
  };
}

async function deployMockComplianceToken(fixture: Fixture): Promise<{
  compliance: MockIssuanceCompliance;
  token: BXOSecurityToken;
}> {
  const compliance = (await ethers.deployContract(
    "MockIssuanceCompliance",
  )) as MockIssuanceCompliance;
  await compliance.waitForDeployment();
  const token = (await ethers.deployContract("BXOSecurityToken", [
    "Mock-compliance token",
    "MCT",
    6,
    fixture.admin.address,
    await fixture.identityRegistry.getAddress(),
    await compliance.getAddress(),
  ])) as BXOSecurityToken;
  await token.waitForDeployment();
  return { compliance, token };
}

async function deployGovernance(token: BXOSecurityToken): Promise<MockGovernanceExecutor> {
  const governance = (await ethers.deployContract(
    "MockGovernanceExecutor",
  )) as MockGovernanceExecutor;
  await governance.waitForDeployment();
  await token.grantRole(await token.FORCED_ISSUER_ROLE(), await governance.getAddress());
  return governance;
}

describe("BXOSecurityToken governed issuance containment", function () {
  let fixture: Fixture;

  beforeEach(async function () {
    fixture = await deployFixture();
  });

  describe("roles and deployment", function () {
    it("grants the admin standard authorities but no forced-issuer authority", async function () {
      const { token, admin } = fixture;
      expect(await token.name()).to.equal("BlockXOne Security Token");
      expect(await token.symbol()).to.equal("BXO-T");
      expect(await token.decimals()).to.equal(6);
      expect(await token.MAX_BATCH_MINT_SIZE()).to.equal(100n);
      expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(
        true,
      );
      expect(await token.hasRole(await token.AGENT_ROLE(), admin.address)).to.equal(true);
      expect(await token.hasRole(await token.MINTER_ROLE(), admin.address)).to.equal(true);
      expect(await token.hasRole(await token.FORCED_ISSUER_ROLE(), admin.address)).to.equal(
        false,
      );
    });

    it("rejects public forced-role grants to EOAs and accepts deployed contracts", async function () {
      const { token, forcedEoa } = fixture;
      const forcedRole = await token.FORCED_ISSUER_ROLE();
      await expect(token.grantRole(forcedRole, forcedEoa.address))
        .to.be.revertedWithCustomError(token, "InvalidForcedIssuer")
        .withArgs(forcedEoa.address);

      const governance = (await ethers.deployContract(
        "MockGovernanceExecutor",
      )) as MockGovernanceExecutor;
      await governance.waitForDeployment();
      await expect(token.grantRole(forcedRole, await governance.getAddress())).to.not.revert(
        ethers,
      );
      expect(await token.hasRole(forcedRole, await governance.getAddress())).to.equal(true);
    });

    it("keeps AGENT_ROLE separate from MINTER_ROLE", async function () {
      const { token, agentOnly, investor1 } = fixture;
      expect(await token.hasRole(await token.AGENT_ROLE(), agentOnly.address)).to.equal(true);
      expect(await token.hasRole(await token.MINTER_ROLE(), agentOnly.address)).to.equal(false);
      await expect(token.connect(agentOnly).mint(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "AccessDenied");
    });
  });

  describe("standard mint eligibility", function () {
    it("mints only to a registered, verified, compliance-eligible recipient", async function () {
      const { token, admin, investor1 } = fixture;
      const amount = 250n;
      const tx = token.connect(admin).mint(investor1.address, amount);
      await expect(tx)
        .to.emit(token, "MintExecuted")
        .withArgs(admin.address, investor1.address, amount);
      expect(await token.balanceOf(investor1.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("rejects unauthorized, paused, zero-recipient, and zero-amount minting", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await expect(token.connect(investor2).mint(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "AccessDenied");
      await expect(token.connect(admin).mint(ethers.ZeroAddress, 1n)).to.be
        .revertedWithCustomError(token, "InvalidIssuanceRecipient");
      await expect(token.connect(admin).mint(investor1.address, 0n)).to.be
        .revertedWithCustomError(token, "InvalidIssuanceAmount");

      await token.pause();
      await expect(token.connect(admin).mint(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "EnforcedPause");
    });

    it("rejects unregistered and registered-but-unverified recipients", async function () {
      const { token, admin, unregisteredInvestor, unverifiedInvestor } = fixture;
      await expect(token.connect(admin).mint(unregisteredInvestor.address, 1n))
        .to.be.revertedWithCustomError(token, "IdentityNotRegistered")
        .withArgs(unregisteredInvestor.address);
      await expect(token.connect(admin).mint(unverifiedInvestor.address, 1n))
        .to.be.revertedWithCustomError(token, "IdentityNotVerified")
        .withArgs(unverifiedInvestor.address);
    });

    it("rejects empty and restricted-country compliance", async function () {
      const { token, admin, investor1, restrictedInvestor, compliance, countryModule } =
        fixture;
      await compliance.removeModule(await countryModule.getAddress());
      await expect(token.connect(admin).mint(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceNotConfigured");

      await compliance.addModule(await countryModule.getAddress());
      await countryModule.addCountryRestriction(COUNTRY_RESTRICTED);
      await expect(token.connect(admin).mint(restrictedInvestor.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");
    });

    it("rejects an issuance that would exceed the configured maximum balance", async function () {
      const { token, admin, investor1, compliance } = fixture;
      const maxModule = (await ethers.deployContract("MaxBalanceModule", [
        100n,
        await token.getAddress(),
      ])) as MaxBalanceModule;
      await maxModule.waitForDeployment();
      await compliance.addModule(await maxModule.getAddress());

      await token.connect(admin).mint(investor1.address, 80n);
      await expect(token.connect(admin).mint(investor1.address, 21n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");
      expect(await token.balanceOf(investor1.address)).to.equal(80n);
      expect(await token.totalSupply()).to.equal(80n);
    });

    it("fails closed for rejecting, reverting, short, invalid-bool, and oversized decisions", async function () {
      const { token, compliance } = await deployMockComplianceToken(fixture);
      expect(await compliance.modulesMode()).to.equal(BigInt(MODULES_CONFIGURED));
      expect(await compliance.decisionMode()).to.equal(BigInt(DECISION_ALLOW));

      for (const mode of [
        DECISION_REJECT,
        DECISION_REVERT,
        DECISION_SHORT,
        DECISION_INVALID_BOOL,
        DECISION_OVERSIZED,
      ]) {
        await compliance.setDecisionMode(mode);
        await expect(token.mint(fixture.investor1.address, 10n)).to.be
          .revertedWithCustomError(token, "ComplianceCheckFailed");
      }
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("calls compliance with the exact zero sender, recipient, and issuance amount", async function () {
      const { token, compliance } = await deployMockComplianceToken(fixture);
      await compliance.setExpectedDecisionArguments(
        true,
        ethers.ZeroAddress,
        fixture.investor1.address,
        37n,
      );
      await token.mint(fixture.investor1.address, 37n);
      expect(await token.balanceOf(fixture.investor1.address)).to.equal(37n);

      await expect(token.mint(fixture.investor1.address, 38n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");
      expect(await token.totalSupply()).to.equal(37n);
    });

    it("rejects zero-address, reverting, and malformed module lists", async function () {
      const { token, compliance } = await deployMockComplianceToken(fixture);

      await compliance.setModulesMode(MODULES_ZERO_ADDRESS);
      await expect(token.mint(fixture.investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");

      for (const mode of [
        MODULES_REVERT,
        MODULES_SHORT,
        MODULES_WRONG_OFFSET,
        MODULES_OVERSIZED,
        MODULES_DIRTY_ADDRESS,
      ]) {
        await compliance.setModulesMode(mode);
        await expect(token.mint(fixture.investor1.address, 1n)).to.be
          .revertedWithCustomError(token, "ComplianceCheckFailed");
      }
      await compliance.setModulesMode(MODULES_EMPTY);
      await expect(token.mint(fixture.investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceNotConfigured");
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("batch minting", function () {
    it("mints a valid bounded batch and emits one event per item", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      const tx = token
        .connect(admin)
        .batchMint([investor1.address, investor2.address], [10n, 20n]);
      await expect(tx)
        .to.emit(token, "MintExecuted")
        .withArgs(admin.address, investor1.address, 10n);
      await expect(tx)
        .to.emit(token, "MintExecuted")
        .withArgs(admin.address, investor2.address, 20n);
      expect(await token.balanceOf(investor1.address)).to.equal(10n);
      expect(await token.balanceOf(investor2.address)).to.equal(20n);
      expect(await token.totalSupply()).to.equal(30n);
    });

    it("rejects empty, mismatched, oversized, and unauthorized batches", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await expect(token.connect(admin).batchMint([], [])).to.be.revertedWithCustomError(
        token,
        "InvalidBatch",
      );
      await expect(token.connect(admin).batchMint([investor1.address], [])).to.be
        .revertedWithCustomError(token, "InvalidBatch");

      const recipients = Array.from({ length: 101 }, () => investor1.address);
      const amounts = Array.from({ length: 101 }, () => 1n);
      await expect(token.connect(admin).batchMint(recipients, amounts))
        .to.be.revertedWithCustomError(token, "TooManyBatchRecipients")
        .withArgs(101n, 100n);
      await expect(token.connect(investor2).batchMint([investor1.address], [1n])).to.be
        .revertedWithCustomError(token, "AccessDenied");
    });

    it("rolls back every item when a later recipient is ineligible", async function () {
      const { token, admin, investor1, unverifiedInvestor } = fixture;
      await expect(
        token
          .connect(admin)
          .batchMint([investor1.address, unverifiedInvestor.address], [10n, 20n]),
      ).to.be.revertedWithCustomError(token, "IdentityNotVerified");
      expect(await token.balanceOf(investor1.address)).to.equal(0n);
      expect(await token.balanceOf(unverifiedInvestor.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("makes duplicate recipients observe updated balances and atomically rolls back aggregate excess", async function () {
      const { token, admin, investor1, compliance } = fixture;
      const maxModule = (await ethers.deployContract("MaxBalanceModule", [
        100n,
        await token.getAddress(),
      ])) as MaxBalanceModule;
      await maxModule.waitForDeployment();
      await compliance.addModule(await maxModule.getAddress());

      await expect(
        token
          .connect(admin)
          .batchMint([investor1.address, investor1.address], [60n, 41n]),
      ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
      expect(await token.balanceOf(investor1.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("checks pause before authorization inside the shared reentrancy boundary", async function () {
      const { token, investor1, investor2 } = fixture;
      await token.pause();
      await expect(token.connect(investor2).batchMint([investor1.address], [1n])).to.be
        .revertedWithCustomError(token, "EnforcedPause");
    });
  });

  describe("forced issuance", function () {
    it("requires a contract-held forced role and emits exact durable evidence", async function () {
      const { token, investor1 } = fixture;
      const governance = await deployGovernance(token);
      const operationId = ethers.id("forced-issuance-1");
      const evidenceHash = ethers.id("case-evidence-1");
      const tx = governance.executeForcedIssue(
        await token.getAddress(),
        operationId,
        investor1.address,
        75n,
        evidenceHash,
      );
      await expect(tx)
        .to.emit(token, "ForcedIssuanceExecuted")
        .withArgs(
          operationId,
          await governance.getAddress(),
          investor1.address,
          75n,
          evidenceHash,
        );
      expect(await token.usedForcedIssuanceOperationIds(operationId)).to.equal(true);
      expect(await token.balanceOf(investor1.address)).to.equal(75n);
    });

    it("does not let MINTER_ROLE alone call forcedIssue", async function () {
      const { token, admin, investor1 } = fixture;
      await expect(
        token
          .connect(admin)
          .forcedIssue(ethers.id("not-authorized"), investor1.address, 1n, ethers.id("evidence")),
      ).to.be.revertedWithCustomError(token, "AccessDenied");
    });

    it("rejects zero operation IDs, zero evidence, reused IDs, and paused execution", async function () {
      const { token, investor1 } = fixture;
      const governance = await deployGovernance(token);
      const evidenceHash = ethers.id("evidence");
      await expect(
        governance.executeForcedIssue(
          await token.getAddress(),
          ethers.ZeroHash,
          investor1.address,
          1n,
          evidenceHash,
        ),
      ).to.be.revertedWithCustomError(token, "InvalidOperationId");
      await expect(
        governance.executeForcedIssue(
          await token.getAddress(),
          ethers.id("zero-evidence"),
          investor1.address,
          1n,
          ethers.ZeroHash,
        ),
      ).to.be.revertedWithCustomError(token, "InvalidEvidenceHash");

      const operationId = ethers.id("single-use");
      await governance.executeForcedIssue(
        await token.getAddress(),
        operationId,
        investor1.address,
        1n,
        evidenceHash,
      );
      await expect(
        governance.executeForcedIssue(
          await token.getAddress(),
          operationId,
          investor1.address,
          1n,
          evidenceHash,
        ),
      )
        .to.be.revertedWithCustomError(token, "OperationAlreadyUsed")
        .withArgs(operationId);

      await token.pause();
      await expect(
        governance.executeForcedIssue(
          await token.getAddress(),
          ethers.id("paused"),
          investor1.address,
          1n,
          evidenceHash,
        ),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("applies the same zero, registration, verification, and compliance policy", async function () {
      const {
        token,
        investor1,
        unregisteredInvestor,
        unverifiedInvestor,
        restrictedInvestor,
        countryModule,
      } = fixture;
      const governance = await deployGovernance(token);
      const target = await token.getAddress();
      const evidence = ethers.id("shared-policy");

      await expect(
        governance.executeForcedIssue(target, ethers.id("zero-recipient"), ethers.ZeroAddress, 1n, evidence),
      ).to.be.revertedWithCustomError(token, "InvalidIssuanceRecipient");
      await expect(
        governance.executeForcedIssue(target, ethers.id("zero-amount"), investor1.address, 0n, evidence),
      ).to.be.revertedWithCustomError(token, "InvalidIssuanceAmount");
      await expect(
        governance.executeForcedIssue(
          target,
          ethers.id("unregistered"),
          unregisteredInvestor.address,
          1n,
          evidence,
        ),
      ).to.be.revertedWithCustomError(token, "IdentityNotRegistered");
      await expect(
        governance.executeForcedIssue(
          target,
          ethers.id("unverified"),
          unverifiedInvestor.address,
          1n,
          evidence,
        ),
      ).to.be.revertedWithCustomError(token, "IdentityNotVerified");

      await countryModule.addCountryRestriction(COUNTRY_RESTRICTED);
      await expect(
        governance.executeForcedIssue(
          target,
          ethers.id("restricted"),
          restrictedInvestor.address,
          1n,
          evidence,
        ),
      ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
    });

    it("rolls back the operation ID on failed eligibility and permits a corrected retry", async function () {
      const { token, unverifiedInvestor, unverifiedIdentity, claimIssuer } = fixture;
      const governance = await deployGovernance(token);
      const operationId = ethers.id("eligibility-retry");
      const evidence = ethers.id("eligibility-evidence");
      await expect(
        governance.executeForcedIssue(
          await token.getAddress(),
          operationId,
          unverifiedInvestor.address,
          10n,
          evidence,
        ),
      ).to.be.revertedWithCustomError(token, "IdentityNotVerified");
      expect(await token.usedForcedIssuanceOperationIds(operationId)).to.equal(false);

      await addClaims(
        unverifiedIdentity,
        unverifiedInvestor,
        await claimIssuer.getAddress(),
      );
      await governance.executeForcedIssue(
        await token.getAddress(),
        operationId,
        unverifiedInvestor.address,
        10n,
        evidence,
      );
      expect(await token.usedForcedIssuanceOperationIds(operationId)).to.equal(true);
      expect(await token.balanceOf(unverifiedInvestor.address)).to.equal(10n);
    });

    it("has no forced-issuance bypass for empty, rejecting, or malformed compliance", async function () {
      const { token, compliance } = await deployMockComplianceToken(fixture);
      const governance = await deployGovernance(token);
      const target = await token.getAddress();
      const evidence = ethers.id("forced-compliance-evidence");

      await compliance.setModulesMode(MODULES_EMPTY);
      const emptyId = ethers.id("forced-empty-compliance");
      await expect(
        governance.executeForcedIssue(
          target,
          emptyId,
          fixture.investor1.address,
          1n,
          evidence,
        ),
      ).to.be.revertedWithCustomError(token, "ComplianceNotConfigured");
      expect(await token.usedForcedIssuanceOperationIds(emptyId)).to.equal(false);

      await compliance.setModulesMode(MODULES_CONFIGURED);
      for (const [label, mode] of [
        ["reject", DECISION_REJECT],
        ["revert", DECISION_REVERT],
        ["short", DECISION_SHORT],
        ["invalid-bool", DECISION_INVALID_BOOL],
        ["oversized", DECISION_OVERSIZED],
      ] as const) {
        const operationId = ethers.id(`forced-compliance-${label}`);
        await compliance.setDecisionMode(mode);
        await expect(
          governance.executeForcedIssue(
            target,
            operationId,
            fixture.investor1.address,
            1n,
            evidence,
          ),
        ).to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
        expect(await token.usedForcedIssuanceOperationIds(operationId)).to.equal(false);
      }
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("shared reentrancy boundary", function () {
    async function configureReentryIdentity(
      mode: number,
      nestedOperationId: string,
    ): Promise<{
      probe: MockIssuanceReentryClaimIssuer;
      identity: Identity;
    }> {
      const { token, reentryInvestor, trustedIssuers, admin, identityRegistry } = fixture;
      const probe = (await ethers.deployContract(
        "MockIssuanceReentryClaimIssuer",
      )) as MockIssuanceReentryClaimIssuer;
      await probe.waitForDeployment();
      await token.grantRole(await token.MINTER_ROLE(), await probe.getAddress());
      await token.grantRole(await token.FORCED_ISSUER_ROLE(), await probe.getAddress());
      await probe.configure(
        mode,
        await token.getAddress(),
        reentryInvestor.address,
        999n,
        nestedOperationId,
        ethers.id("nested-evidence"),
      );
      await trustedIssuers.addTrustedIssuer(await probe.getAddress(), [TOPIC_KYC, TOPIC_AML]);
      const identity = await registerInvestor(
        { admin, identityRegistry },
        reentryInvestor,
        COUNTRY_US,
        await probe.getAddress(),
      );
      return { probe, identity };
    }

    it("recognizes only the exact four-byte ReentrancyGuard error", async function () {
      const probe = (await ethers.deployContract(
        "MockIssuanceReentryClaimIssuer",
      )) as MockIssuanceReentryClaimIssuer;
      await probe.waitForDeployment();
      expect(await probe.matchesExpectedReentrancyFailure("0x3ee5aeb5")).to.equal(true);
      expect(await probe.matchesExpectedReentrancyFailure("0x3ee5aeb500")).to.equal(false);
      expect(await probe.matchesExpectedReentrancyFailure("0xdeadbeef")).to.equal(false);
      expect(await probe.matchesExpectedReentrancyFailure("0x")).to.equal(false);
    });

    it("blocks a different-ID forced issue nested inside standard mint", async function () {
      const { token, admin, reentryInvestor } = fixture;
      const nestedOperationId = ethers.id("fresh-nested-force-id");
      await configureReentryIdentity(REENTRY_FORCE_FROM_MINT, nestedOperationId);

      await token.connect(admin).mint(reentryInvestor.address, 40n);
      expect(await token.balanceOf(reentryInvestor.address)).to.equal(40n);
      expect(await token.totalSupply()).to.equal(40n);
      expect(await token.usedForcedIssuanceOperationIds(nestedOperationId)).to.equal(false);
    });

    it("blocks standard mint nested inside forced issuance", async function () {
      const { token, reentryInvestor } = fixture;
      await configureReentryIdentity(REENTRY_MINT_FROM_FORCE, ethers.id("unused-nested-id"));
      const governance = await deployGovernance(token);
      const outerOperationId = ethers.id("outer-forced-operation");

      await governance.executeForcedIssue(
        await token.getAddress(),
        outerOperationId,
        reentryInvestor.address,
        55n,
        ethers.id("outer-evidence"),
      );
      expect(await token.balanceOf(reentryInvestor.address)).to.equal(55n);
      expect(await token.totalSupply()).to.equal(55n);
      expect(await token.usedForcedIssuanceOperationIds(outerOperationId)).to.equal(true);
    });

    it("does not treat the disabled probe as valid reentrancy proof", async function () {
      const { token, admin, reentryInvestor } = fixture;
      await configureReentryIdentity(REENTRY_DISABLED, ethers.id("disabled"));
      await expect(token.connect(admin).mint(reentryInvestor.address, 1n)).to.be
        .revertedWithCustomError(token, "IdentityNotVerified");
    });
  });

  describe("adjacent supply controls and accounting", function () {
    it("cannot mint or burn through zero-endpoint forced transfer or recovery", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      const supplyBefore = await token.totalSupply();
      const firstBalance = await token.balanceOf(investor1.address);

      for (const makeCall of [
        () => token.connect(admin).forcedTransfer(ethers.ZeroAddress, investor2.address, 1n),
        () => token.connect(admin).forcedTransfer(investor1.address, ethers.ZeroAddress, 1n),
        () => token.connect(admin).recoveryAddress(ethers.ZeroAddress, investor2.address, 1n),
        () => token.connect(admin).recoveryAddress(investor1.address, ethers.ZeroAddress, 1n),
      ]) {
        await expect(makeCall()).to.be.revertedWithCustomError(
          token,
          "InvalidForcedTransferEndpoint",
        );
      }
      expect(await token.totalSupply()).to.equal(supplyBefore);
      expect(await token.balanceOf(investor1.address)).to.equal(firstBalance);
      expect(await token.balanceOf(investor2.address)).to.equal(0n);
    });

    it("reconciles supply across standard, batch, forced issuance, and burns", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      const governance = await deployGovernance(token);
      await token.connect(admin).mint(investor1.address, 100n);
      await token
        .connect(admin)
        .batchMint([investor1.address, investor2.address], [20n, 30n]);
      await governance.executeForcedIssue(
        await token.getAddress(),
        ethers.id("supply-invariant"),
        investor2.address,
        40n,
        ethers.id("supply-evidence"),
      );
      await token.connect(admin).burn(investor1.address, 25n);

      const balance1 = await token.balanceOf(investor1.address);
      const balance2 = await token.balanceOf(investor2.address);
      expect(balance1).to.equal(95n);
      expect(balance2).to.equal(70n);
      expect(await token.totalSupply()).to.equal(165n);
      expect(await token.totalSupply()).to.equal(balance1 + balance2);
    });
  });

  describe("retained token lifecycle regressions", function () {
    it("retains authorized single and batch burns with atomic supply accounting", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token
        .connect(admin)
        .batchMint([investor1.address, investor2.address], [100n, 80n]);
      await expect(token.connect(investor1).burn(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "AccessDenied");

      await token.connect(admin).burn(investor1.address, 10n);
      await token
        .connect(admin)
        .batchBurn([investor1.address, investor2.address], [20n, 30n]);
      expect(await token.balanceOf(investor1.address)).to.equal(70n);
      expect(await token.balanceOf(investor2.address)).to.equal(50n);
      expect(await token.totalSupply()).to.equal(120n);
      await expect(
        token.connect(admin).batchBurn([investor1.address], []),
      ).to.be.revertedWith("Array length mismatch");
      expect(await token.totalSupply()).to.equal(120n);
    });

    it("retains single and batch freeze controls and blocks frozen transfers", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      await token.connect(admin).freezeAddress(investor1.address);
      expect(await token.isFrozen(investor1.address)).to.equal(true);
      await expect(token.connect(investor1).transfer(investor2.address, 1n))
        .to.be.revertedWithCustomError(token, "AccountFrozen")
        .withArgs(investor1.address);

      await token.connect(admin).unfreezeAddress(investor1.address);
      await token.connect(admin).batchFreezeAddress([investor1.address, investor2.address]);
      expect(await token.isFrozen(investor1.address)).to.equal(true);
      expect(await token.isFrozen(investor2.address)).to.equal(true);
      await token
        .connect(admin)
        .batchUnfreezeAddress([investor1.address, investor2.address]);
      expect(await token.isFrozen(investor1.address)).to.equal(false);
      expect(await token.isFrozen(investor2.address)).to.equal(false);
      await expect(token.connect(investor1).transfer(investor2.address, 1n)).to.not.revert(
        ethers,
      );
    });

    it("retains pause/unpause behavior for transfers and burns", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      await token.connect(admin).pause();
      await expect(token.connect(investor1).transfer(investor2.address, 1n)).to.be
        .revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(admin).burn(investor1.address, 1n)).to.be
        .revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(investor1).unpause()).to.be.revertedWithCustomError(
        token,
        "AccessDenied",
      );

      await token.connect(admin).unpause();
      await token.connect(investor1).transfer(investor2.address, 1n);
      expect(await token.balanceOf(investor2.address)).to.equal(1n);
    });

    it("retains normal and unauthorized forced-transfer behavior without changing supply", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      await expect(
        token.connect(investor1).forcedTransfer(investor1.address, investor2.address, 1n),
      ).to.be.revertedWithCustomError(token, "AccessDenied");

      const tx = token
        .connect(admin)
        .forcedTransfer(investor1.address, investor2.address, 40n);
      await expect(tx)
        .to.emit(token, "ForcedTransfer")
        .withArgs(investor1.address, investor2.address, 40n, admin.address);
      expect(await token.balanceOf(investor1.address)).to.equal(60n);
      expect(await token.balanceOf(investor2.address)).to.equal(40n);
      expect(await token.totalSupply()).to.equal(100n);
    });

    it("retains normal and unauthorized recovery behavior without changing supply", async function () {
      const { token, admin, investor1, investor2 } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      await expect(
        token.connect(investor1).recoveryAddress(investor1.address, investor2.address, 1n),
      ).to.be.revertedWithCustomError(token, "AccessDenied");

      const tx = token
        .connect(admin)
        .recoveryAddress(investor1.address, investor2.address, 100n);
      await expect(tx)
        .to.emit(token, "RecoverySuccess")
        .withArgs(investor1.address, investor2.address, 100n);
      expect(await token.balanceOf(investor1.address)).to.equal(0n);
      expect(await token.balanceOf(investor2.address)).to.equal(100n);
      expect(await token.totalSupply()).to.equal(100n);
    });

    it("retains country restriction checks in normal transfer flow", async function () {
      const { token, admin, investor1, investor2, countryModule } = fixture;
      await token.connect(admin).mint(investor1.address, 100n);
      await countryModule.addCountryRestriction(COUNTRY_US);
      await expect(token.connect(investor1).transfer(investor2.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");

      await countryModule.removeCountryRestriction(COUNTRY_US);
      await countryModule.addCountryRestriction(COUNTRY_UK);
      await expect(token.connect(investor1).transfer(investor2.address, 1n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");

      await countryModule.removeCountryRestriction(COUNTRY_UK);
      await token.connect(investor1).transfer(investor2.address, 1n);
      expect(await token.balanceOf(investor2.address)).to.equal(1n);
    });

    it("retains maximum-balance checks in normal transfer flow", async function () {
      const { token, admin, investor1, investor2, compliance } = fixture;
      const maxModule = (await ethers.deployContract("MaxBalanceModule", [
        100n,
        await token.getAddress(),
      ])) as MaxBalanceModule;
      await maxModule.waitForDeployment();
      await compliance.addModule(await maxModule.getAddress());
      await token.connect(admin).mint(investor1.address, 100n);
      await token.connect(admin).mint(investor2.address, 90n);

      await expect(token.connect(investor1).transfer(investor2.address, 11n)).to.be
        .revertedWithCustomError(token, "ComplianceCheckFailed");
      await token.connect(investor1).transfer(investor2.address, 10n);
      expect(await token.balanceOf(investor2.address)).to.equal(100n);
    });

    it("retains governed registry/compliance setters, events, and zero-address rejection", async function () {
      const { token, admin, investor1, identityRegistry } = fixture;
      const replacementRegistry = (await ethers.deployContract(
        "IdentityRegistry",
      )) as IdentityRegistry;
      const replacementCompliance = (await ethers.deployContract(
        "MockIssuanceCompliance",
      )) as MockIssuanceCompliance;
      await Promise.all([
        replacementRegistry.waitForDeployment(),
        replacementCompliance.waitForDeployment(),
      ]);

      await expect(
        token.connect(investor1).setIdentityRegistry(await replacementRegistry.getAddress()),
      ).to.be.revertedWithCustomError(token, "AccessDenied");
      await expect(token.connect(admin).setIdentityRegistry(ethers.ZeroAddress)).to.be
        .revertedWithCustomError(token, "InvalidIdentityRegistry");
      await expect(
        token.connect(admin).setIdentityRegistry(await replacementRegistry.getAddress()),
      )
        .to.emit(token, "IdentityRegistryUpdated")
        .withArgs(await replacementRegistry.getAddress());
      expect(await token.identityRegistry()).to.equal(await replacementRegistry.getAddress());

      await expect(token.connect(investor1).setCompliance(await replacementCompliance.getAddress()))
        .to.be.revertedWithCustomError(token, "AccessDenied");
      await expect(token.connect(admin).setCompliance(ethers.ZeroAddress)).to.be
        .revertedWithCustomError(token, "InvalidCompliance");
      await expect(
        token.connect(admin).setCompliance(await replacementCompliance.getAddress()),
      )
        .to.emit(token, "ComplianceUpdated")
        .withArgs(await replacementCompliance.getAddress());
      expect(await token.compliance()).to.equal(await replacementCompliance.getAddress());

      await token.connect(admin).setIdentityRegistry(await identityRegistry.getAddress());
      await token.connect(admin).mint(investor1.address, 1n);
      expect(await token.balanceOf(investor1.address)).to.equal(1n);
    });
  });
});
