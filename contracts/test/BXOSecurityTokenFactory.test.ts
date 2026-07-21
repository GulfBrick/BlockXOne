import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type {
  BXOSecurityToken,
  BXOSecurityTokenFactory,
  ClaimTopicsRegistry,
  CountryRestrictionModule,
  Identity,
  IdentityRegistry,
  MockClaimIssuer,
  ModularCompliance,
  TrustedIssuersRegistry,
} from "../typechain-types/index.js";

const { ethers } = await hre.network.create();

const TOPIC_KYC = 1n;
const TOPIC_AML = 2n;

interface FactoryFixture {
  deployer: HardhatEthersSigner;
  ineligibleCaller: HardhatEthersSigner;
  identityRegistry: IdentityRegistry;
  compliance: ModularCompliance;
  factory: BXOSecurityTokenFactory;
}

async function deployFactoryFixture(): Promise<FactoryFixture> {
  const [deployer, ineligibleCaller, issuerOwner] = await ethers.getSigners();
  const claimTopics = (await ethers.deployContract(
    "ClaimTopicsRegistry",
  )) as ClaimTopicsRegistry;
  const trustedIssuers = (await ethers.deployContract(
    "TrustedIssuersRegistry",
  )) as TrustedIssuersRegistry;
  const identityRegistry = (await ethers.deployContract(
    "IdentityRegistry",
  )) as IdentityRegistry;
  const issuer = (await ethers.deployContract("MockClaimIssuer", [
    issuerOwner.address,
  ])) as MockClaimIssuer;
  const identity = (await ethers.deployContract("Identity", [
    deployer.address,
  ])) as Identity;
  await Promise.all([
    claimTopics.waitForDeployment(),
    trustedIssuers.waitForDeployment(),
    identityRegistry.waitForDeployment(),
    issuer.waitForDeployment(),
    identity.waitForDeployment(),
  ]);

  await identityRegistry.initialize(
    deployer.address,
    deployer.address,
    await trustedIssuers.getAddress(),
    await claimTopics.getAddress(),
  );
  await trustedIssuers.addTrustedIssuer(await issuer.getAddress(), [
    TOPIC_KYC,
    TOPIC_AML,
  ]);
  await identityRegistry.registerIdentity(
    deployer.address,
    await identity.getAddress(),
    840,
  );
  await identity
    .connect(deployer)
    .addClaim(TOPIC_KYC, 1n, await issuer.getAddress(), "0x010203", "0xa1", "kyc");
  await identity
    .connect(deployer)
    .addClaim(TOPIC_AML, 1n, await issuer.getAddress(), "0x040506", "0xb2", "aml");
  expect(await identityRegistry.isVerified(deployer.address)).to.equal(true);

  const compliance = (await ethers.deployContract(
    "ModularCompliance",
  )) as ModularCompliance;
  const countryModule = (await ethers.deployContract(
    "CountryRestrictionModule",
    [await identityRegistry.getAddress()],
  )) as CountryRestrictionModule;
  const factory = (await ethers.deployContract(
    "BXOSecurityTokenFactory",
  )) as BXOSecurityTokenFactory;
  await Promise.all([
    compliance.waitForDeployment(),
    countryModule.waitForDeployment(),
    factory.waitForDeployment(),
  ]);
  await compliance.addModule(await countryModule.getAddress());

  return { deployer, ineligibleCaller, identityRegistry, compliance, factory };
}

async function deployedToken(factory: BXOSecurityTokenFactory): Promise<BXOSecurityToken> {
  const addresses = await factory.getDeployedTokens();
  expect(addresses).to.have.length.greaterThan(0);
  return (await ethers.getContractAt(
    "BXOSecurityToken",
    addresses[addresses.length - 1],
  )) as BXOSecurityToken;
}

describe("BXOSecurityTokenFactory authority handoff", function () {
  let fixture: FactoryFixture;

  beforeEach(async function () {
    fixture = await deployFactoryFixture();
  });

  it("grants caller admin/agent/minter, never forced, and removes every factory role", async function () {
    const { factory, deployer, identityRegistry, compliance } = fixture;
    await factory.deployToken(
      "Factory token",
      "FTK",
      6,
      await identityRegistry.getAddress(),
      await compliance.getAddress(),
      0n,
    );
    const token = await deployedToken(factory);
    const factoryAddress = await factory.getAddress();

    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(
      true,
    );
    expect(await token.hasRole(await token.AGENT_ROLE(), deployer.address)).to.equal(true);
    expect(await token.hasRole(await token.MINTER_ROLE(), deployer.address)).to.equal(true);
    expect(await token.hasRole(await token.FORCED_ISSUER_ROLE(), deployer.address)).to.equal(
      false,
    );

    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), factoryAddress)).to.equal(
      false,
    );
    expect(await token.hasRole(await token.AGENT_ROLE(), factoryAddress)).to.equal(false);
    expect(await token.hasRole(await token.MINTER_ROLE(), factoryAddress)).to.equal(false);
    expect(await token.hasRole(await token.FORCED_ISSUER_ROLE(), factoryAddress)).to.equal(
      false,
    );
  });

  it("uses the standard mint path for eligible initial supply and records exact metadata", async function () {
    const { factory, deployer, identityRegistry, compliance } = fixture;
    const transaction = factory.deployToken(
      "Initial supply token",
      "IST",
      8,
      await identityRegistry.getAddress(),
      await compliance.getAddress(),
      500n,
    );
    await expect(transaction).to.emit(factory, "TokenMinted");

    const token = await deployedToken(factory);
    const tokenAddress = await token.getAddress();
    expect(await token.balanceOf(deployer.address)).to.equal(500n);
    expect(await token.totalSupply()).to.equal(500n);
    expect(await factory.getDeployedTokensCount()).to.equal(1n);

    const info = await factory.getTokenInfo(tokenAddress);
    expect(info.token).to.equal(tokenAddress);
    expect(info.identityRegistry).to.equal(await identityRegistry.getAddress());
    expect(info.compliance).to.equal(await compliance.getAddress());
    expect(info.name).to.equal("Initial supply token");
    expect(info.symbol).to.equal("IST");
    expect(info.decimals).to.equal(8n);
    expect(info.deployer).to.equal(deployer.address);
  });

  it("lets the caller use its handed-off standard minter after deployment", async function () {
    const { factory, deployer, identityRegistry, compliance } = fixture;
    await factory.deployToken(
      "Post deployment token",
      "PDT",
      6,
      await identityRegistry.getAddress(),
      await compliance.getAddress(),
      0n,
    );
    const token = await deployedToken(factory);
    await token.connect(deployer).mint(deployer.address, 25n);
    expect(await token.balanceOf(deployer.address)).to.equal(25n);
  });

  it("atomically reverts an ineligible initial supply without recording a deployment", async function () {
    const { factory, ineligibleCaller, identityRegistry, compliance } = fixture;
    const tokenErrorDecoder = (await ethers.getContractAt(
      "BXOSecurityToken",
      await factory.getAddress(),
    )) as BXOSecurityToken;
    await expect(
      factory.connect(ineligibleCaller).deployToken(
        "Ineligible token",
        "BAD",
        6,
        await identityRegistry.getAddress(),
        await compliance.getAddress(),
        1n,
      ),
    )
      .to.be.revertedWithCustomError(tokenErrorDecoder, "IdentityNotRegistered")
      .withArgs(ineligibleCaller.address);
    expect(await factory.getDeployedTokensCount()).to.equal(0n);
    expect(await factory.getDeployedTokens()).to.deep.equal([]);
  });

  it("atomically rejects initial supply when compliance has no configured module", async function () {
    const { factory, deployer, identityRegistry } = fixture;
    const emptyCompliance = (await ethers.deployContract(
      "ModularCompliance",
    )) as ModularCompliance;
    await emptyCompliance.waitForDeployment();
    const tokenErrorDecoder = (await ethers.getContractAt(
      "BXOSecurityToken",
      await factory.getAddress(),
    )) as BXOSecurityToken;
    await expect(
      factory.deployToken(
        "Empty compliance token",
        "ECT",
        6,
        await identityRegistry.getAddress(),
        await emptyCompliance.getAddress(),
        1n,
      ),
    ).to.be.revertedWithCustomError(tokenErrorDecoder, "ComplianceNotConfigured");
    expect(await factory.getDeployedTokensCount()).to.equal(0n);
    expect(await factory.getDeployedTokens()).to.deep.equal([]);
    expect(deployer.address).to.not.equal(ethers.ZeroAddress);
  });
});
