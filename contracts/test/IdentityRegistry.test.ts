import { expect } from "chai";
import hre from "hardhat";
import type {
  ClaimTopicsRegistry,
  Identity,
  IdentityRegistry,
  MockClaimIssuer,
  MockRegistryFailures,
  TrustedIssuersRegistry,
} from "../typechain-types/index.js";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

const { ethers } = await hre.network.create();
const abi = ethers.AbiCoder.defaultAbiCoder();

const claimTopicsInterface = new ethers.Interface([
  "function getClaimTopics() view returns (uint256[])",
]);
const identityInterface = new ethers.Interface([
  "function getClaimIdsByTopic(uint256 topic) view returns (uint256[])",
  "function getClaim(uint256 claimId) view returns (uint256,uint256,address,bytes,bytes,string)",
]);
const trustedIssuersInterface = new ethers.Interface([
  "function isTrustedIssuer(address issuer) view returns (bool)",
  "function getTrustedIssuerClaimTopics(address issuer) view returns (uint256[])",
]);

const GET_TOPICS = claimTopicsInterface.getFunction("getClaimTopics")!.selector;
const GET_CLAIM_IDS = identityInterface.getFunction("getClaimIdsByTopic")!.selector;
const GET_CLAIM = identityInterface.getFunction("getClaim")!.selector;
const IS_TRUSTED = trustedIssuersInterface.getFunction("isTrustedIssuer")!.selector;
const GET_ISSUER_TOPICS = trustedIssuersInterface.getFunction(
  "getTrustedIssuerClaimTopics",
)!.selector;

const TOPIC_KYC = 1n;
const TOPIC_AML = 2n;
const SCHEME = 1n;
const SIGNATURE = "0x010203";
const CLAIM_DATA = "0xa1b2c3d4";
const MAX_UINT256 = (1n << 256n) - 1n;

function word(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function arrayResult(values: bigint[]): string {
  return abi.encode(["uint256[]"], [values]);
}

function boolResult(value: boolean): string {
  return abi.encode(["bool"], [value]);
}

function claimResult(
  topic: bigint,
  scheme: bigint,
  issuer: string,
  signature = SIGNATURE,
  data = CLAIM_DATA,
  uri = "",
): string {
  return abi.encode(
    ["uint256", "uint256", "address", "bytes", "bytes", "string"],
    [topic, scheme, issuer, signature, data, uri],
  );
}

function replaceWord(encoded: string, index: number, value: bigint): string {
  const start = index * 32;
  return ethers.concat([
    ethers.dataSlice(encoded, 0, start),
    word(value),
    ethers.dataSlice(encoded, start + 32),
  ]);
}

function readWord(encoded: string, index: number): bigint {
  return BigInt(ethers.dataSlice(encoded, index * 32, (index + 1) * 32));
}

function replaceByte(encoded: string, index: number, value: number): string {
  return ethers.concat([
    ethers.dataSlice(encoded, 0, index),
    ethers.toBeHex(value, 1),
    ethers.dataSlice(encoded, index + 1),
  ]);
}

interface RawFixture {
  registry: IdentityRegistry;
  requiredTopics: MockRegistryFailures;
  identity: MockRegistryFailures;
  trustedIssuers: MockRegistryFailures;
  issuer: MockClaimIssuer;
  investor: HardhatEthersSigner;
  other: HardhatEthersSigner;
  issuerAddress: string;
  claimCall: string;
  claimIdsCall: string;
  issuerTopicsCall: string;
  trustedCall: string;
  validClaim: string;
}

async function deployRawFixture(): Promise<RawFixture> {
  const [admin, investor, other, issuerOwner] = await ethers.getSigners();

  const requiredTopics = (await ethers.deployContract(
    "MockRegistryFailures",
  )) as MockRegistryFailures;
  const identity = (await ethers.deployContract(
    "MockRegistryFailures",
  )) as MockRegistryFailures;
  const trustedIssuers = (await ethers.deployContract(
    "MockRegistryFailures",
  )) as MockRegistryFailures;
  const issuer = (await ethers.deployContract("MockClaimIssuer", [
    issuerOwner.address,
  ])) as MockClaimIssuer;
  const registry = (await ethers.deployContract(
    "IdentityRegistry",
  )) as IdentityRegistry;

  await Promise.all([
    requiredTopics.waitForDeployment(),
    identity.waitForDeployment(),
    trustedIssuers.waitForDeployment(),
    issuer.waitForDeployment(),
    registry.waitForDeployment(),
  ]);

  await registry.initialize(
    admin.address,
    admin.address,
    await trustedIssuers.getAddress(),
    await requiredTopics.getAddress(),
  );
  await registry.registerIdentity(
    investor.address,
    await identity.getAddress(),
    840,
  );

  const issuerAddress = await issuer.getAddress();
  const claimIdsCall = identityInterface.encodeFunctionData(
    "getClaimIdsByTopic",
    [TOPIC_KYC],
  );
  const claimCall = identityInterface.encodeFunctionData("getClaim", [11n]);
  const trustedCall = trustedIssuersInterface.encodeFunctionData(
    "isTrustedIssuer",
    [issuerAddress],
  );
  const issuerTopicsCall = trustedIssuersInterface.encodeFunctionData(
    "getTrustedIssuerClaimTopics",
    [issuerAddress],
  );
  const validClaim = claimResult(
    TOPIC_KYC,
    SCHEME,
    issuerAddress,
    SIGNATURE,
    CLAIM_DATA,
    "claim://kyc",
  );

  await requiredTopics.setSelectorResponse(GET_TOPICS, arrayResult([TOPIC_KYC]));
  await identity.setCallResponse(claimIdsCall, arrayResult([11n]));
  await identity.setCallResponse(claimCall, validClaim);
  await trustedIssuers.setCallResponse(trustedCall, boolResult(true));
  await trustedIssuers.setCallResponse(
    issuerTopicsCall,
    arrayResult([TOPIC_KYC]),
  );

  expect(await registry.isVerified(investor.address)).to.equal(true);

  return {
    registry,
    requiredTopics,
    identity,
    trustedIssuers,
    issuer,
    investor,
    other,
    issuerAddress,
    claimCall,
    claimIdsCall,
    issuerTopicsCall,
    trustedCall,
    validClaim,
  };
}

interface RealFixture {
  registry: IdentityRegistry;
  claimTopics: ClaimTopicsRegistry;
  trustedIssuers: TrustedIssuersRegistry;
  identity: Identity;
  issuer: MockClaimIssuer;
  admin: HardhatEthersSigner;
  investor: HardhatEthersSigner;
  other: HardhatEthersSigner;
}

async function deployRealFixture(): Promise<RealFixture> {
  const [admin, investor, other, issuerOwner] = await ethers.getSigners();
  const claimTopics = (await ethers.deployContract(
    "ClaimTopicsRegistry",
  )) as ClaimTopicsRegistry;
  const trustedIssuers = (await ethers.deployContract(
    "TrustedIssuersRegistry",
  )) as TrustedIssuersRegistry;
  const registry = (await ethers.deployContract(
    "IdentityRegistry",
  )) as IdentityRegistry;
  const identity = (await ethers.deployContract("Identity", [
    investor.address,
  ])) as Identity;
  const issuer = (await ethers.deployContract("MockClaimIssuer", [
    issuerOwner.address,
  ])) as MockClaimIssuer;

  await Promise.all([
    claimTopics.waitForDeployment(),
    trustedIssuers.waitForDeployment(),
    registry.waitForDeployment(),
    identity.waitForDeployment(),
    issuer.waitForDeployment(),
  ]);

  await registry.initialize(
    admin.address,
    admin.address,
    await trustedIssuers.getAddress(),
    await claimTopics.getAddress(),
  );
  await registry.registerIdentity(investor.address, await identity.getAddress(), 840);
  await trustedIssuers.addTrustedIssuer(await issuer.getAddress(), [
    TOPIC_KYC,
    TOPIC_AML,
  ]);
  await identity
    .connect(investor)
    .addClaim(TOPIC_KYC, SCHEME, await issuer.getAddress(), SIGNATURE, CLAIM_DATA, "kyc");
  await identity
    .connect(investor)
    .addClaim(TOPIC_AML, SCHEME, await issuer.getAddress(), "0x040506", "0xb1b2", "aml");

  expect(await registry.isVerified(investor.address)).to.equal(true);
  return { registry, claimTopics, trustedIssuers, identity, issuer, admin, investor, other };
}

describe("IdentityRegistry fail-closed claim verification", function () {
  describe("current production-shaped registries", function () {
    it("requires a valid claim for every current required topic", async function () {
      const fixture = await deployRealFixture();
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.claimTopics.addClaimTopic(3n);
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("returns false without reverting for unregistered and EOA identities", async function () {
      const fixture = await deployRealFixture();
      expect(await fixture.registry.isVerified(fixture.other.address)).to.equal(false);

      await fixture.registry.registerIdentity(
        fixture.other.address,
        fixture.other.address,
        826,
      );
      expect(await fixture.registry.isVerified(fixture.other.address)).to.equal(false);
    });

    it("returns false when no claim topic is required", async function () {
      const fixture = await deployRealFixture();
      await fixture.claimTopics.removeClaimTopic(TOPIC_KYC);
      await fixture.claimTopics.removeClaimTopic(TOPIC_AML);
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("passes identity, topic, signature, and data to the issuer unchanged", async function () {
      const fixture = await deployRealFixture();
      await fixture.claimTopics.removeClaimTopic(TOPIC_AML);
      const identityAddress = await fixture.identity.getAddress();

      await fixture.issuer.setExpectedArguments(
        true,
        identityAddress,
        TOPIC_KYC,
        SIGNATURE,
        CLAIM_DATA,
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      const mismatches: [string, bigint, string, string][] = [
        [fixture.other.address, TOPIC_KYC, SIGNATURE, CLAIM_DATA],
        [identityAddress, 99n, SIGNATURE, CLAIM_DATA],
        [identityAddress, TOPIC_KYC, "0xffff", CLAIM_DATA],
        [identityAddress, TOPIC_KYC, SIGNATURE, "0xffff"],
      ];
      for (const [identity, topic, signature, data] of mismatches) {
        await fixture.issuer.setExpectedArguments(true, identity, topic, signature, data);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
    });

    it("invalidates immediately when trust or topic authorization is removed", async function () {
      const fixture = await deployRealFixture();
      await fixture.trustedIssuers.updateIssuerClaimTopics(
        await fixture.issuer.getAddress(),
        [TOPIC_AML],
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);

      await fixture.trustedIssuers.updateIssuerClaimTopics(
        await fixture.issuer.getAddress(),
        [TOPIC_KYC, TOPIC_AML],
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.trustedIssuers.removeTrustedIssuer(await fixture.issuer.getAddress());
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("invalidates immediately when a required claim is removed", async function () {
      const fixture = await deployRealFixture();
      await fixture.identity.connect(fixture.investor).removeClaim(1n);
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });
  });

  describe("malicious returndata and independent predicate mutations", function () {
    it("rejects required-topic reverts and every malformed array shape", async function () {
      const fixture = await deployRawFixture();
      await fixture.requiredTopics.setSelectorRevert(GET_TOPICS, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);

      const malformed = [
        "0x",
        "0x01",
        ethers.concat([word(64n), word(1n), word(TOPIC_KYC)]),
        ethers.concat([word(32n), word(MAX_UINT256)]),
        ethers.concat([word(32n), word(1n), "0x01"]),
        ethers.concat([arrayResult([TOPIC_KYC]), word(0n)]),
      ];
      for (const returnData of malformed) {
        await fixture.requiredTopics.setSelectorResponse(GET_TOPICS, returnData);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }

      await fixture.requiredTopics.setSelectorResponse(GET_TOPICS, arrayResult([]));
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("rejects claim-ID reverts, empty results, and malformed arrays", async function () {
      const fixture = await deployRawFixture();
      await fixture.identity.setCallRevert(fixture.claimIdsCall, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);

      const malformed = [
        arrayResult([]),
        "0x01",
        ethers.concat([word(64n), word(1n), word(11n)]),
        ethers.concat([word(32n), word(MAX_UINT256)]),
        ethers.concat([arrayResult([11n]), word(0n)]),
      ];
      for (const returnData of malformed) {
        await fixture.identity.setCallResponse(fixture.claimIdsCall, returnData);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
    });

    it("rejects false, revert, short, invalid, and oversized trust booleans", async function () {
      const fixture = await deployRawFixture();
      const invalidTrustResults = [
        boolResult(false),
        "0x01",
        word(2n),
        ethers.concat([word(1n), word(0n)]),
      ];
      for (const returnData of invalidTrustResults) {
        await fixture.trustedIssuers.setCallResponse(fixture.trustedCall, returnData);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
      await fixture.trustedIssuers.setCallRevert(fixture.trustedCall, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("rejects issuer-topic reverts, missing authorization, and malformed arrays", async function () {
      const fixture = await deployRawFixture();
      const invalidTopicResults = [
        arrayResult([]),
        arrayResult([TOPIC_AML]),
        "0x01",
        ethers.concat([word(64n), word(1n), word(TOPIC_KYC)]),
        ethers.concat([word(32n), word(MAX_UINT256)]),
        ethers.concat([arrayResult([TOPIC_KYC]), word(0n)]),
      ];
      for (const returnData of invalidTopicResults) {
        await fixture.trustedIssuers.setCallResponse(
          fixture.issuerTopicsCall,
          returnData,
        );
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
      await fixture.trustedIssuers.setCallRevert(
        fixture.issuerTopicsCall,
        "0xdeadbeef",
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });

    it("rejects noncanonical and malformed six-output claim tuples", async function () {
      const fixture = await deployRawFixture();
      await fixture.identity.setCallRevert(fixture.claimCall, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);

      const issuerBits = BigInt(fixture.issuerAddress);
      const signaturePaddingIndex = 0xc0 + 32 + ethers.dataLength(SIGNATURE);
      const dataOffset = Number(readWord(fixture.validClaim, 4));
      const uriOffset = Number(readWord(fixture.validClaim, 5));
      const dataPaddingIndex = dataOffset + 32 + ethers.dataLength(CLAIM_DATA);
      const uriPaddingIndex =
        uriOffset + 32 + new TextEncoder().encode("claim://kyc").length;
      const malformed = [
        "0x",
        replaceWord(fixture.validClaim, 2, issuerBits | (1n << 200n)),
        replaceWord(fixture.validClaim, 3, 0xe0n),
        replaceWord(fixture.validClaim, 4, 0x120n),
        replaceWord(fixture.validClaim, 5, BigInt(uriOffset + 32)),
        replaceWord(fixture.validClaim, 6, MAX_UINT256),
        replaceWord(fixture.validClaim, uriOffset / 32, MAX_UINT256),
        replaceByte(fixture.validClaim, signaturePaddingIndex, 1),
        replaceByte(fixture.validClaim, dataPaddingIndex, 1),
        replaceByte(fixture.validClaim, uriPaddingIndex, 1),
        ethers.dataSlice(
          fixture.validClaim,
          0,
          ethers.dataLength(fixture.validClaim) - 1,
        ),
        ethers.concat([fixture.validClaim, word(0n)]),
      ];
      for (const returnData of malformed) {
        await fixture.identity.setCallResponse(fixture.claimCall, returnData);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
    });

    it("rejects wrong topic, wrong scheme, zero issuer, and empty signature", async function () {
      const fixture = await deployRawFixture();
      const invalidClaims = [
        claimResult(TOPIC_AML, SCHEME, fixture.issuerAddress),
        claimResult(TOPIC_KYC, 2n, fixture.issuerAddress),
        claimResult(TOPIC_KYC, SCHEME, ethers.ZeroAddress),
        claimResult(TOPIC_KYC, SCHEME, fixture.issuerAddress, "0x"),
      ];
      for (const returnData of invalidClaims) {
        await fixture.identity.setCallResponse(fixture.claimCall, returnData);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
    });

    it("rejects false, reverting, short, invalid-bool, and oversized issuer validation", async function () {
      const fixture = await deployRawFixture();
      for (const mode of [1, 2, 3, 4, 5]) {
        await fixture.issuer.setValidationMode(mode);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
      }
      await fixture.issuer.setValidationMode(0);
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);
    });

    it("continues past invalid, reverting, and malformed alternative claims", async function () {
      const fixture = await deployRawFixture();
      const firstClaimCall = identityInterface.encodeFunctionData("getClaim", [11n]);
      const secondClaimCall = identityInterface.encodeFunctionData("getClaim", [12n]);
      await fixture.identity.setCallResponse(
        fixture.claimIdsCall,
        arrayResult([11n, 12n]),
      );
      await fixture.identity.setCallResponse(secondClaimCall, fixture.validClaim);

      await fixture.identity.setCallResponse(
        firstClaimCall,
        claimResult(TOPIC_KYC, 2n, fixture.issuerAddress),
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.identity.setCallRevert(firstClaimCall, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.identity.setCallResponse(firstClaimCall, "0x01");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);
    });

    it("continues after first-issuer trust, authorization, or validation failures", async function () {
      const fixture = await deployRawFixture();
      const [, , , secondIssuerOwner] = await ethers.getSigners();
      const secondIssuer = (await ethers.deployContract("MockClaimIssuer", [
        secondIssuerOwner.address,
      ])) as MockClaimIssuer;
      await secondIssuer.waitForDeployment();

      const secondIssuerAddress = await secondIssuer.getAddress();
      const secondClaimCall = identityInterface.encodeFunctionData("getClaim", [12n]);
      const secondTrustedCall = trustedIssuersInterface.encodeFunctionData(
        "isTrustedIssuer",
        [secondIssuerAddress],
      );
      const secondIssuerTopicsCall = trustedIssuersInterface.encodeFunctionData(
        "getTrustedIssuerClaimTopics",
        [secondIssuerAddress],
      );

      await fixture.identity.setCallResponse(
        fixture.claimIdsCall,
        arrayResult([11n, 12n]),
      );
      await fixture.identity.setCallResponse(fixture.claimCall, fixture.validClaim);
      await fixture.identity.setCallResponse(
        secondClaimCall,
        claimResult(TOPIC_KYC, SCHEME, secondIssuerAddress),
      );
      await fixture.trustedIssuers.setCallResponse(
        secondTrustedCall,
        boolResult(true),
      );
      await fixture.trustedIssuers.setCallResponse(
        secondIssuerTopicsCall,
        arrayResult([TOPIC_KYC]),
      );

      for (const firstIssuerMode of [1, 2, 3, 4, 5]) {
        await fixture.issuer.setValidationMode(firstIssuerMode);
        expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);
      }

      await fixture.issuer.setValidationMode(0);
      await fixture.trustedIssuers.setCallRevert(fixture.trustedCall, "0xdeadbeef");
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.trustedIssuers.setCallResponse(fixture.trustedCall, boolResult(true));
      await fixture.trustedIssuers.setCallRevert(
        fixture.issuerTopicsCall,
        "0xdeadbeef",
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);
    });

    it("still requires one qualifying claim for every required topic", async function () {
      const fixture = await deployRawFixture();
      const amlClaimIdsCall = identityInterface.encodeFunctionData(
        "getClaimIdsByTopic",
        [TOPIC_AML],
      );
      const amlClaimCall = identityInterface.encodeFunctionData("getClaim", [22n]);

      await fixture.requiredTopics.setSelectorResponse(
        GET_TOPICS,
        arrayResult([TOPIC_KYC, TOPIC_AML]),
      );
      await fixture.identity.setCallResponse(amlClaimIdsCall, arrayResult([22n]));
      await fixture.identity.setCallResponse(
        amlClaimCall,
        claimResult(TOPIC_AML, SCHEME, fixture.issuerAddress, "0x040506", "0xb1b2"),
      );
      await fixture.trustedIssuers.setCallResponse(
        fixture.issuerTopicsCall,
        arrayResult([TOPIC_KYC, TOPIC_AML]),
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(true);

      await fixture.identity.setCallResponse(
        amlClaimCall,
        claimResult(TOPIC_AML, 2n, fixture.issuerAddress, "0x040506", "0xb1b2"),
      );
      expect(await fixture.registry.isVerified(fixture.investor.address)).to.equal(false);
    });
  });
});
