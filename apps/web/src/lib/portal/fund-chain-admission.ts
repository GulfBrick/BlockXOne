import 'server-only'
import { AbiCoder, Interface, keccak256 } from 'ethers'
import { z } from 'zod'
import { createFundingRpc, FUNDING_RPC_URLS } from './funding-verifier'
import { fundChainExpectationSchema } from './fund-lifecycle-chain'
import { fundSetupSnapshotSchema } from './fund-setup-contracts'
import { FUND_SETUP_STEPS, fundSetupHash, observeSetupSafe, predictFundSuite, type FundSetupObservers } from './fund-setup-chain'
import { canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, getCanonicalFundArtifact, type FundSetupArtifactName } from './fund-setup-artifacts'

const ZERO = '0x0000000000000000000000000000000000000000'
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => value !== ZERO)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < 2n ** 256n)
const positive = quantity.refine(value => BigInt(value) > 0n)
const receipt = z.string().uuid()
/** These IDs are guarded database evidence references, never invented by this adapter. */
export const fundAdmissionInputSchema = z.object({
  manifest_id: receipt, setup: fundSetupSnapshotSchema, product_binding_hash: digest,
  class_id: receipt, class_name: z.string().min(1).max(200), security_unit_decimals: z.number().int().min(0).max(18),
  token_name: z.string().min(1).max(200), token_symbol: z.string().min(1).max(24), cap_units: positive,
  maximum_operation_units: positive, claim_topics: z.array(positive).min(1).max(5),
  deployment_salt: z.string().min(1).max(160), signer_address: address,
  authority_epoch: z.number().int().positive(), required_confirmations: z.number().int().min(1).max(10000),
  proof_refs: z.object({ conformance_receipt_id: receipt, governance_receipt_id: receipt,
    observation_policy_receipt_id: receipt, role_state_receipt_id: receipt }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set(value.claim_topics).size !== value.claim_topics.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Claim topics must be unique.' })
  if (BigInt(value.maximum_operation_units) > BigInt(value.cap_units) * 10n ** BigInt(value.security_unit_decimals)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'The operation limit exceeds the approved supply.' })
})
export type FundAdmissionInput = z.infer<typeof fundAdmissionInputSchema>
const candidateManifestSchema = fundChainExpectationSchema.options[0].shape.manifest.omit({ status: true }).extend({ status: z.literal('NOT_ADMITTED') })
export class FundAdmissionChainError extends Error {
  constructor(public readonly code: string) { super('The saved setup or independently observed governance does not support this release candidate. Nothing was admitted or sent.') }
}
const fail = (code: string): never => { throw new FundAdmissionChainError(code) }
export type FundAdmissionRpc = ReturnType<typeof createFundingRpc>
export type FundAdmissionHead = { number: string; hash: string; timestamp: string }
export type FundAdmissionSnapshot = { block: FundAdmissionHead; providers: { url: string; finalized_block_number: string; finalized_block_hash: string }[] }
const hex = (value: string) => `0x${BigInt(value).toString(16)}`
function rpcQuantity(value: unknown): string {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || BigInt(value) >= 2n ** 256n) return fail('ADMISSION_RPC_QUANTITY_INVALID')
  return BigInt(value).toString()
}
function block(value: unknown): FundAdmissionHead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('ADMISSION_BLOCK_UNAVAILABLE')
  const b = value as Record<string, unknown>, number = rpcQuantity(b.number), seconds = rpcQuantity(b.timestamp)
  if (typeof b.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(b.hash) || /^0x0{64}$/i.test(b.hash) || BigInt(seconds) > 8640000000000n) return fail('ADMISSION_BLOCK_INVALID')
  return { number, hash: b.hash.toLowerCase(), timestamp: new Date(Number(seconds) * 1000).toISOString() }
}
export function fundAdmissionRpc(options: FundSetupObservers = {}): FundAdmissionRpc {
  return async (url, method, params) => {
    const index = FUNDING_RPC_URLS.indexOf(url as typeof FUNDING_RPC_URLS[number])
    if (index < 0) return fail('ADMISSION_OBSERVER_NOT_APPROVED')
    const source = (index === 0 ? options.primary : options.secondary) ?? options.rpc ?? createFundingRpc()
    try { return await source(url, method, params) } catch (error) { if (error instanceof FundAdmissionChainError) throw error; return fail('ADMISSION_OBSERVATION_UNAVAILABLE') }
  }
}
/** Common canonical finalized block; the provider URLs are fixed public identifiers. */
export async function readFundAdmissionSnapshot(rpc: FundAdmissionRpc): Promise<FundAdmissionSnapshot> {
  const heads = await Promise.all(FUNDING_RPC_URLS.map(async url => {
    const [chain, raw] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
    if (rpcQuantity(chain) !== '80002') return fail('ADMISSION_WRONG_CHAIN')
    const head = block(raw), reread = block(await rpc(url, 'eth_getBlockByNumber', [hex(head.number), false]))
    if (fundSetupHash(head) !== fundSetupHash(reread)) return fail('ADMISSION_FINALIZED_HEAD_CHANGED')
    return { url, head }
  }))
  const height = heads.reduce((min, value) => BigInt(value.head.number) < BigInt(min) ? value.head.number : min, heads[0].head.number)
  const common = await Promise.all(heads.map(item => rpc(item.url, 'eth_getBlockByNumber', [hex(height), false]).then(block)))
  if (common.some(item => item.number !== height) || fundSetupHash(common[0]) !== fundSetupHash(common[1])) return fail('ADMISSION_OBSERVERS_DISAGREE')
  return { block: common[0], providers: heads.map(item => ({ url: item.url, finalized_block_number: item.head.number, finalized_block_hash: item.head.hash })) }
}
export async function recheckFundAdmissionSnapshot(rpc: FundAdmissionRpc, snapshot: FundAdmissionSnapshot): Promise<void> {
  const current = await Promise.all(FUNDING_RPC_URLS.map(url => rpc(url, 'eth_getBlockByNumber', [hex(snapshot.block.number), false]).then(block)))
  if (current.some(value => fundSetupHash(value) !== fundSetupHash(snapshot.block))) return fail('ADMISSION_CANONICAL_BLOCK_CHANGED')
}
export async function readCanonicalFundResult(rpc: FundAdmissionRpc, url: string, at: string, artifact: FundSetupArtifactName, method: string, args: unknown[], height: string) {
  const abi = new Interface(getCanonicalFundArtifact(artifact).abi)
  const raw = await rpc(url, 'eth_call', [{ to: at, data: abi.encodeFunctionData(method, args).toLowerCase() }, hex(height)])
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(raw)) return fail('ADMISSION_GETTER_UNAVAILABLE')
  try { return abi.decodeFunctionResult(method, raw) } catch { return fail('ADMISSION_GETTER_INVALID') }
}
function readback(artifact: FundSetupArtifactName, method: string, args: unknown[], result: unknown[]) {
  const abi = new Interface(getCanonicalFundArtifact(artifact).abi)
  return { data: abi.encodeFunctionData(method, args).toLowerCase(), result: abi.encodeFunctionResult(method, result).toLowerCase() }
}
/** A truthful candidate only. The guarded writer must validate durable receipt provenance before admission. */
export async function buildFundAdmissionCandidate(raw: unknown, options: FundSetupObservers = {}) {
  const input = fundAdmissionInputSchema.parse(raw), saved = input.setup.setup, c = saved?.configuration
  if (!saved || saved.state !== 'COMPLETE_NOT_ADMITTED' || saved.recovery_hold || !c || saved.safe_state !== 'VERIFIED'
    || !saved.safe_address || input.setup.configuration_hash === null || Date.parse(saved.expires_at) <= Date.now()
    || input.setup.environment !== 'TESTNET' || input.setup.source_pin !== 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4'
    || input.setup.roleplay_policy && (Date.parse(input.setup.roleplay_policy.expires_at) <= Date.now() || input.setup.roleplay_policy.epoch !== input.authority_epoch)
    || saved.steps.some(step => step.state !== 'FINAL' || !step.intent || !step.transaction_hash || !step.observation_id || step.intent.catalog_hash !== FUND_SETUP_CATALOG_HASH)) return fail('ADMISSION_SAVED_SETUP_NOT_COMPLETE')
  const rpc = fundAdmissionRpc(options), snapshot = await readFundAdmissionSnapshot(rpc), safe = await observeSetupSafe(c.safe_address, options)
  if (safe.address !== saved.safe_address || safe.threshold !== saved.safe_threshold || fundSetupHash(safe.owners) !== fundSetupHash([...saved.safe_owners].sort())
    || safe.guard !== ZERO || safe.fallback_handler !== ZERO || !safe.owners.includes(input.signer_address)) return fail('ADMISSION_SAFE_STATE_CHANGED')
  const dependencies = saved.dependencies, needed = (key: keyof typeof dependencies) => dependencies[key] ?? fail('ADMISSION_DEPENDENCY_MISSING')
  const runtimeBindings: Partial<Record<string, Record<string, string>>> = {
    IdFactory: { _implementationAuthority: needed('oid_authority') },
    Bx1FundController: { institutionalAuthority: c.safe_address, factory: needed('trex_factory') },
    Bx1MaximumHoldingModule: { maximumHolding: c.maximum_holding_base_units },
  }
  const pieces = Object.fromEntries(FUND_SETUP_STEPS.filter(step => step.kind === 'CREATE').map(step => {
    const deployed = needed(step.key as keyof typeof dependencies), runtimeHash = keccak256(canonicalFundRuntime(step.artifact, runtimeBindings[step.artifact] ?? {}))
    const savedStep = saved.steps.find(item => item.step_key === step.key)
    if (savedStep?.intent?.expected_address !== deployed || savedStep.intent.expected_runtime_hash !== runtimeHash) return fail('ADMISSION_SAVED_RUNTIME_BINDING_CHANGED')
    return [step.key, { address: deployed, runtime_hash: runtimeHash, artifact: step.artifact }]
  }))
  const current = await Promise.all(FUNDING_RPC_URLS.map(async url => {
    for (const item of Object.values(pieces)) {
      const code = await rpc(url, 'eth_getCode', [item.address, hex(snapshot.block.number)])
      if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code) !== item.runtime_hash) return fail('ADMISSION_CURRENT_RUNTIME_CHANGED')
    }
    const read = (key: keyof typeof dependencies, method: string, args: unknown[] = []) => {
      const item = pieces[key]
      if (!item) return fail('ADMISSION_DEPENDENCY_MISSING')
      return readCanonicalFundResult(rpc, url, item.address, item.artifact === 'IdentityProxy' && method !== 'implementationAuthority' ? 'Identity' : item.artifact, method, args, snapshot.block.number)
    }
    const ownerKeys = [c.claim_management_key, c.token_management_key].map(value => keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [value])))
    const values = await Promise.all([read('trex_factory', 'owner'), read('trex_factory', 'getImplementationAuthority'),
      read('trex_factory', 'getIdFactory'), read('trex_authority', 'owner'), read('trex_authority', 'getCurrentVersion'),
      read('oid_authority', 'owner'), read('oid_authority', 'getImplementation'), read('oid_factory', 'owner'),
      read('oid_factory', 'isTokenFactory', [needed('trex_factory')]), read('controller', 'institutionalAuthority'),
      read('controller', 'factory'), read('controller', 'authorityEpoch'), read('controller', 'paused'),
      read('claim_issuer', 'getKeysByPurpose', [1]), read('claim_issuer', 'getKeysByPurpose', [3]),
      read('claim_issuer', 'keyHasPurpose', [ownerKeys[0], 3]), read('token_identity', 'getKeysByPurpose', [1]),
      read('token_identity', 'implementationAuthority'), read('holding_module', 'maximumHolding'),
      ...['getTokenImplementation', 'getCTRImplementation', 'getIRSImplementation', 'getIRImplementation', 'getTIRImplementation', 'getMCImplementation'].map(method => read('trex_authority', method)),
      read('trex_authority', 'getTREXFactory')])
    if (String(values[0][0]).toLowerCase() !== needed('controller') || String(values[1][0]).toLowerCase() !== needed('trex_authority')
      || String(values[2][0]).toLowerCase() !== needed('oid_factory') || String(values[3][0]).toLowerCase() !== c.safe_address
      || JSON.stringify([...values[4][0]].map(Number)) !== '[4,1,3]' || String(values[5][0]).toLowerCase() !== c.safe_address
      || String(values[6][0]).toLowerCase() !== needed('oid_implementation') || String(values[7][0]).toLowerCase() !== c.safe_address
      || values[8][0] !== true || String(values[9][0]).toLowerCase() !== c.safe_address || String(values[10][0]).toLowerCase() !== needed('trex_factory')
      || Number(values[11][0]) !== input.authority_epoch || values[12][0] !== false
      || JSON.stringify([...values[13][0]].map(String)) !== JSON.stringify([ownerKeys[0]]) || values[14][0].length !== 0 || values[15][0] !== true
      || JSON.stringify([...values[16][0]].map(String)) !== JSON.stringify([ownerKeys[1]]) || String(values[17][0]).toLowerCase() !== needed('oid_authority')
      || String(values[18][0]) !== c.maximum_holding_base_units
      || ['token_implementation', 'ctr_implementation', 'irs_implementation', 'ir_implementation', 'tir_implementation', 'mc_implementation'].some((key, index) => String(values[index + 19][0]).toLowerCase() !== dependencies[key as keyof typeof dependencies])
      || String(values[25][0]).toLowerCase() !== needed('trex_factory')) return fail('ADMISSION_CURRENT_GOVERNANCE_CHANGED')
    const iaFactorySlot = await rpc(url, 'eth_getStorageAt', [needed('trex_authority'), '0x4', hex(snapshot.block.number)])
    if (String(iaFactorySlot).toLowerCase() !== AbiCoder.defaultAbiCoder().encode(['address'], [needed('ia_factory')]).toLowerCase()) return fail('ADMISSION_CURRENT_GOVERNANCE_CHANGED')
    return values.map(value => [...value].map(item => typeof item === 'bigint' ? item.toString() : Array.isArray(item) ? [...item].map(String) : item))
  }))
  if (fundSetupHash(current[0]) !== fundSetupHash(current[1])) return fail('ADMISSION_OBSERVERS_DISAGREE')
  const predicted = predictFundSuite(needed('trex_factory'), input.deployment_salt, needed('trex_authority'), {
    name: input.token_name, symbol: input.token_symbol, decimals: input.security_unit_decimals, onchain_id: needed('token_identity'),
  })
  for (const url of FUNDING_RPC_URLS) for (const at of Object.values(predicted)) if (await rpc(url, 'eth_getCode', [at, hex(snapshot.block.number)]) !== '0x') return fail('ADMISSION_EXPECTED_SUITE_ALREADY_OCCUPIED')
  const proxy = (key: keyof typeof predicted, artifact: FundSetupArtifactName, implementation: keyof typeof dependencies) => ({
    address: predicted[key], runtime_hash: keccak256(canonicalFundRuntime(artifact)),
    implementation_address: needed(implementation), implementation_runtime_hash: pieces[implementation].runtime_hash,
  })
  const dep = (key: keyof typeof dependencies, governanceReadbacks: ReturnType<typeof readback>[]) => ({
    address: needed(key), runtime_hash: pieces[key].runtime_hash, code_kind: 'IMMUTABLE' as const,
    release_evidence_id: input.proof_refs.conformance_receipt_id, governance_evidence_id: input.proof_refs.governance_receipt_id,
    governance_readbacks: governanceReadbacks, implementation: null, implementation_authority: null, implementation_version: null,
  })
  const claimKey = keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [c.claim_management_key]))
  const tokenKey = keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [c.token_management_key]))
  const holdingReadback = readback('Bx1MaximumHoldingModule', 'maximumHolding', [], [c.maximum_holding_base_units])
  const onchain = { ...dep('token_identity', [readback('Identity', 'keyHasPurpose', [tokenKey, 1], [true])]), code_kind: 'ONCHAINID_PROXY' as const,
    implementation: { address: needed('oid_implementation'), runtime_hash: pieces.oid_implementation.runtime_hash },
    implementation_authority: { address: needed('oid_authority'), runtime_hash: pieces.oid_authority.runtime_hash, owner: c.safe_address }, implementation_version: '2.2.1' as const }
  const manifestBody = {
    id: input.manifest_id, revision: 1, product_binding_hash: input.product_binding_hash, status: 'NOT_ADMITTED' as const,
    release_commit: input.setup.source_pin, release_version: '4.1.3' as const,
    governance_evidence_id: input.proof_refs.governance_receipt_id, conformance_evidence_id: input.proof_refs.conformance_receipt_id,
    network_evidence_id: input.proof_refs.observation_policy_receipt_id, required_confirmations: input.required_confirmations,
    safe: { address: safe.address, runtime_hash: safe.runtime_hash, singleton: safe.singleton, owners: safe.owners,
      threshold: safe.threshold, nonce: safe.nonce, guard: safe.guard, fallback_handler: safe.fallback_handler },
    controller: { address: needed('controller'), runtime_hash: pieces.controller.runtime_hash }, factory: { address: needed('trex_factory'), runtime_hash: pieces.trex_factory.runtime_hash },
    implementation_authority: { address: needed('trex_authority'), runtime_hash: pieces.trex_authority.runtime_hash, owner: safe.address, version: [4, 1, 3] },
    suite: { token: proxy('token', 'TokenProxy', 'token_implementation'), identity_registry: proxy('identity_registry', 'IdentityRegistryProxy', 'ir_implementation'),
      identity_storage: proxy('identity_storage', 'IdentityRegistryStorageProxy', 'irs_implementation'), trusted_issuers: proxy('trusted_issuers', 'TrustedIssuersRegistryProxy', 'tir_implementation'),
      claim_topics: proxy('claim_topics', 'ClaimTopicsRegistryProxy', 'ctr_implementation'), compliance: proxy('compliance', 'ModularComplianceProxy', 'mc_implementation') },
    token_details: { owner: safe.address, name: input.token_name, symbol: input.token_symbol, decimals: input.security_unit_decimals, irs: ZERO,
      onchain_id: needed('token_identity'), onchain_id_runtime_hash: pieces.token_identity.runtime_hash, onchain_id_binding: onchain,
      identity_agents: [safe.address], token_agents: [needed('controller')], compliance_modules: [{ ...dep('holding_module', [holdingReadback]), settings_readbacks: [holdingReadback] }],
      compliance_settings: [], claim_topics: input.claim_topics, claim_issuers: [{ ...dep('claim_issuer', [readback('ClaimIssuer', 'keyHasPurpose', [claimKey, 3], [true])]), topics: input.claim_topics }] },
    maximum_supply: (BigInt(input.cap_units) * 10n ** BigInt(input.security_unit_decimals)).toString(), maximum_operation_units: input.maximum_operation_units,
    role_state_evidence_id: input.proof_refs.role_state_receipt_id,
  }
  const manifest = candidateManifestSchema.parse({ ...manifestBody, hash: fundSetupHash(manifestBody) })
  await recheckFundAdmissionSnapshot(rpc, snapshot)
  if (Date.parse(saved.expires_at) <= Date.now()) return fail('ADMISSION_AUTHORITY_EXPIRED_DURING_CHECKS')
  const common = { manifest, safe_transaction: { nonce: safe.nonce, safe_tx_gas: '0' }, signer_address: input.signer_address }
  return { schema_version: 1 as const, status: 'NOT_ADMITTED' as const, environment: 'TESTNET' as const, chain_id: 80002 as const,
    setup_id: saved.id, setup_revision: saved.revision, product_id: input.setup.product_id, offering_revision_id: input.setup.offering_revision_id,
    terms_hash: input.setup.terms_hash, configuration_hash: input.setup.configuration_hash, product_binding_hash: input.product_binding_hash,
    class_id: input.class_id, class_name: input.class_name, security_unit_decimals: input.security_unit_decimals,
    authority_epoch: input.authority_epoch, source_pin: input.setup.source_pin, catalog_hash: FUND_SETUP_CATALOG_HASH,
    proof_refs: input.proof_refs, roleplay_policy: input.setup.roleplay_policy, observed: snapshot, manifest,
    deployment_expectation: { ...common, deployment: { salt: input.deployment_salt } },
    issuance_expectation: { ...common, issuance: { chain_snapshot_block: snapshot.block.number, chain_snapshot_hash: snapshot.block.hash } },
    assurance: 'SOURCE_CONFORMANCE_AND_OBSERVED_TEST_GOVERNANCE_ONLY' as const, independent_audit_proven: false as const,
    standard_claim_expiry_enforced: false as const }
}
export type FundAdmissionCandidate = Awaited<ReturnType<typeof buildFundAdmissionCandidate>>
