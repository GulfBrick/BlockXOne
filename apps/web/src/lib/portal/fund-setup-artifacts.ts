import 'server-only'
import { createHash } from 'node:crypto'
import { Interface, keccak256, type InterfaceAbi } from 'ethers'
import manifest from './fund-setup-artifacts/manifest.json'
import Token from './fund-setup-artifacts/Token.json'
import IdentityRegistry from './fund-setup-artifacts/IdentityRegistry.json'
import IdentityRegistryStorage from './fund-setup-artifacts/IdentityRegistryStorage.json'
import TrustedIssuersRegistry from './fund-setup-artifacts/TrustedIssuersRegistry.json'
import ClaimTopicsRegistry from './fund-setup-artifacts/ClaimTopicsRegistry.json'
import ModularCompliance from './fund-setup-artifacts/ModularCompliance.json'
import TokenProxy from './fund-setup-artifacts/TokenProxy.json'
import IdentityRegistryProxy from './fund-setup-artifacts/IdentityRegistryProxy.json'
import IdentityRegistryStorageProxy from './fund-setup-artifacts/IdentityRegistryStorageProxy.json'
import TrustedIssuersRegistryProxy from './fund-setup-artifacts/TrustedIssuersRegistryProxy.json'
import ClaimTopicsRegistryProxy from './fund-setup-artifacts/ClaimTopicsRegistryProxy.json'
import ModularComplianceProxy from './fund-setup-artifacts/ModularComplianceProxy.json'
import TREXImplementationAuthority from './fund-setup-artifacts/TREXImplementationAuthority.json'
import IAFactory from './fund-setup-artifacts/IAFactory.json'
import TREXFactory from './fund-setup-artifacts/TREXFactory.json'
import Identity from './fund-setup-artifacts/Identity.json'
import ClaimIssuer from './fund-setup-artifacts/ClaimIssuer.json'
import IdentityProxy from './fund-setup-artifacts/IdentityProxy.json'
import ImplementationAuthority from './fund-setup-artifacts/ImplementationAuthority.json'
import IdFactory from './fund-setup-artifacts/IdFactory.json'
import Bx1FundController from './fund-setup-artifacts/Bx1FundController.json'
import Bx1MaximumHoldingModule from './fund-setup-artifacts/Bx1MaximumHoldingModule.json'
import Bx1TestSettlementToken from './fund-setup-artifacts/Bx1TestSettlementToken.json'
import Safe from './fund-setup-artifacts/Safe-1.4.1.json'
import SafeL2 from './fund-setup-artifacts/SafeL2-1.4.1.json'
import SafeProxy from './fund-setup-artifacts/SafeProxy-1.4.1.json'
import SafeProxyFactory from './fund-setup-artifacts/SafeProxyFactory-1.4.1.json'

export const FUND_SETUP_CATALOG_HASH = '2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2'
export const FUND_SETUP_COMPILER_COMMIT = '6760781aad5afc7af47b47789040efec06766e20'
const catalog = { Token, IdentityRegistry, IdentityRegistryStorage, TrustedIssuersRegistry, ClaimTopicsRegistry, ModularCompliance,
  TokenProxy, IdentityRegistryProxy, IdentityRegistryStorageProxy, TrustedIssuersRegistryProxy, ClaimTopicsRegistryProxy, ModularComplianceProxy,
  TREXImplementationAuthority, IAFactory, TREXFactory, Identity, ClaimIssuer, IdentityProxy, ImplementationAuthority, IdFactory,
  Bx1FundController, Bx1MaximumHoldingModule, Bx1TestSettlementToken }
export type FundSetupArtifactName = keyof typeof catalog
export const fundSetupArtifactNames = Object.freeze(Object.keys(catalog) as FundSetupArtifactName[])
type Code = { code: string; sha256: string; keccak256: string; link_references: Record<string, unknown> }
type Immutable = { name: string; source: string; node_type: string; references: { start: number; length: number }[] }
export type CanonicalFundArtifact = {
  contract_name: FundSetupArtifactName; abi: InterfaceAbi; creation: Code; runtime_template: Code;
  immutable_references: Record<string, { start: number; length: number }[]>; immutable_bindings: Record<string, Immutable>;
}
export class FundSetupArtifactError extends Error { constructor() { super('CANONICAL_SETUP_ARTIFACT_UNVERIFIED') } }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const encoded = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
function fail(): never { throw new FundSetupArtifactError() }
function freeze(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
}
let verified = false
/** Verify the compiler packet itself, not an arbitrary browser/uploaded ABI. */
export function verifyCanonicalFundCatalog(): void {
  if (verified) return
  if (sha(encoded(manifest)) !== FUND_SETUP_CATALOG_HASH || manifest.application_commit !== FUND_SETUP_COMPILER_COMMIT
    || manifest.chain_id !== 80002 || manifest.compiler !== '0.8.17+commit.8df45f5f.Emscripten.clang'
    || manifest.settings.optimizer.runs !== 200 || !manifest.settings.optimizer.enabled || manifest.settings.evmVersion !== 'london'
    || manifest.settings.viaIR !== false || manifest.artifacts.length !== 23 || Object.keys(catalog).length !== 23
    || new Set(manifest.artifacts.map(item => item.name)).size !== 23) fail()
  for (const item of manifest.artifacts) {
    const name = item.name as FundSetupArtifactName, raw = catalog[name]
    if (!raw || sha(encoded(raw)) !== item.sha256 || raw.contract_name !== name || raw.application_commit !== FUND_SETUP_COMPILER_COMMIT
      || raw.chain_id !== 80002 || raw.deployed_address !== null || raw.deployment_transaction !== null) fail()
    const artifact = raw as unknown as CanonicalFundArtifact
    for (const bytecode of [artifact.creation, artifact.runtime_template]) {
      if (!/^0x(?:[0-9a-f]{2})+$/i.test(bytecode.code) || Object.keys(bytecode.link_references).length
        || sha(Buffer.from(bytecode.code.slice(2), 'hex')) !== bytecode.sha256 || keccak256(bytecode.code) !== bytecode.keccak256) fail()
    }
    new Interface(artifact.abi)
    const touched = new Set<number>()
    if (JSON.stringify(Object.keys(artifact.immutable_references)) !== JSON.stringify(Object.keys(artifact.immutable_bindings))) fail()
    for (const [id, binding] of Object.entries(artifact.immutable_bindings)) {
      if (binding.node_type !== 'VariableDeclaration' || JSON.stringify(binding.references) !== JSON.stringify(artifact.immutable_references[id])) fail()
      for (const offset of binding.references) {
        if (!Number.isSafeInteger(offset.start) || offset.start < 0 || offset.length !== 32
          || offset.start + 32 > (artifact.runtime_template.code.length - 2) / 2) fail()
        for (let n = offset.start; n < offset.start + 32; n++) { if (touched.has(n)) fail(); touched.add(n) }
      }
    }
    freeze(raw)
  }
  verified = true
}
export function getCanonicalFundArtifact(name: FundSetupArtifactName): CanonicalFundArtifact {
  verifyCanonicalFundCatalog()
  if (!Object.hasOwn(catalog, name)) return fail()
  return catalog[name] as unknown as CanonicalFundArtifact
}
/** All named immutable words are required; template hashes are never deployed hashes. */
export function canonicalFundRuntime(name: FundSetupArtifactName, values: Record<string, string> = {}): string {
  const artifact = getCanonicalFundArtifact(name), bindings = Object.values(artifact.immutable_bindings)
  if (Object.keys(values).length !== bindings.length || bindings.some(binding => !Object.hasOwn(values, binding.name))) return fail()
  const runtime = Buffer.from(artifact.runtime_template.code.slice(2), 'hex')
  for (const binding of bindings) {
    const value = values[binding.name]
    let word: string
    if (name === 'Bx1MaximumHoldingModule' && binding.name === 'maximumHolding') {
      if (!/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) return fail()
      word = BigInt(value).toString(16).padStart(64, '0')
    } else if ((name === 'IdFactory' && binding.name === '_implementationAuthority')
      || (name === 'Bx1FundController' && ['institutionalAuthority', 'factory'].includes(binding.name))) {
      if (!/^0x[0-9a-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) return fail()
      word = value.slice(2).toLowerCase().padStart(64, '0')
    } else return fail()
    for (const offset of binding.references) Buffer.from(word, 'hex').copy(runtime, offset.start)
  }
  return `0x${runtime.toString('hex')}`
}
export function canonicalFundCreation(name: FundSetupArtifactName, args: readonly unknown[]): string {
  const artifact = getCanonicalFundArtifact(name)
  try { return artifact.creation.code + new Interface(artifact.abi).encodeDeploy([...args]).slice(2) } catch { return fail() }
}
// Official npm @safe-global/safe-contracts@1.4.1, integrity:
// sha512-fP1jewywSwsIniM04NsqPyVRFKPMAuirC3ftA/TA4X3Zc5EnwQp/UCJUU2PL/37/z/jMo8UUaJ+pnFNWmMU7dQ==
// Public artifact sources: https://unpkg.com/@safe-global/safe-contracts@1.4.1/build/artifacts/contracts/{Safe.sol/Safe.json,SafeL2.sol/SafeL2.json,proxies/SafeProxy.sol/SafeProxy.json,proxies/SafeProxyFactory.sol/SafeProxyFactory.json}
const officialSafe = { Safe, SafeL2, SafeProxy, SafeProxyFactory }
const safePins = { Safe: 'c36a5e99bc3f25c2d75ac5f7920b679200b3ce617c0d26e674b1321dbc6b0bdf',
  SafeL2: 'a57d54c0d757ca7fb86693480797de69c880878690b67061f6f9624e11def8bd',
  SafeProxy: 'b05eaeaf7278097e52a9e9b38410de2a812c23fa3622373473e73eaa19646ecd',
  SafeProxyFactory: 'f77ccb60e95345e6583216e82feb5430098679d62aa4aeda7388df3831476997' }
export function getOfficialSafeArtifact(name: keyof typeof officialSafe): { abi: InterfaceAbi; bytecode: string; deployedBytecode: string } {
  const artifact = officialSafe[name]
  if (!artifact || sha(encoded(artifact)) !== safePins[name]) return fail()
  freeze(artifact)
  return artifact as unknown as { abi: InterfaceAbi; bytecode: string; deployedBytecode: string }
}
