import 'server-only'
import { AbiCoder, Interface, Signature, TypedDataEncoder, getBytes, getCreateAddress, keccak256, recoverAddress, toUtf8Bytes, verifyMessage } from 'ethers'
import { z } from 'zod'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { fundChainExpectationSchema } from './fund-lifecycle-chain'
import { fundAdmissionRpc, readCanonicalFundResult, readFundAdmissionSnapshot, recheckFundAdmissionSnapshot, type FundAdmissionRpc, type FundAdmissionSnapshot } from './fund-chain-admission'
import { canonicalFundCreation, canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, getCanonicalFundArtifact, getOfficialSafeArtifact } from './fund-setup-artifacts'
import { FUND_SETUP_SAFE_PROXY_HASH, FUND_SETUP_SAFE_SINGLETONS, fundSetupHash, type FundSetupObservers } from './fund-setup-chain'

const ZERO = '0x0000000000000000000000000000000000000000', SENTINEL = '0x0000000000000000000000000000000000000001'
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => value !== ZERO)
const digest = z.string().regex(/^[0-9a-f]{64}$/), id = z.string().uuid()
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < 2n ** 256n)
const signature = z.string().regex(/^0x[0-9a-f]{130}$/)
export const fundRecipientPhases = ['CREATE_IDENTITY', 'ADD_CLAIM', 'REGISTER_IDENTITY', 'REVOKE_CLAIM'] as const
export const fundRecipientExpectationSchema = z.object({
  operation_id: id, revision: z.number().int().positive(), phase: z.enum(fundRecipientPhases), product_id: id, offering_revision_id: id,
  investment_account_id: id, wallet_proof_id: id, eligibility_case_id: id, eligibility_revision: z.number().int().positive(),
  product_binding_hash: digest, account_binding_hash: digest, eligibility_binding_hash: digest, valid_until: z.string().datetime({ offset: true }),
  action_valid_until: z.string().datetime({ offset: true }),
  recipient_address: address, identity_address: address.nullable(), claim_topic: amount.refine(value => BigInt(value) > 0n),
  claim_signer_address: address, claim_signature: signature.nullable(), country_code: z.number().int().min(1).max(65535),
  sender_address: address, sender_nonce: amount, safe_nonce: amount.nullable(),
  manifest: fundChainExpectationSchema.options[0].shape.manifest,
}).strict().superRefine((value, context) => {
  if (value.phase === 'CREATE_IDENTITY' && value.identity_address !== null || value.phase !== 'CREATE_IDENTITY' && value.identity_address === null
    || value.phase === 'REVOKE_CLAIM' && value.claim_signature === null
    || value.phase === 'REGISTER_IDENTITY' && !value.manifest.safe.owners.includes(value.sender_address)
    || ['CREATE_IDENTITY', 'ADD_CLAIM'].includes(value.phase) && value.sender_address !== value.recipient_address
    || value.phase === 'REVOKE_CLAIM' && value.sender_address !== value.claim_signer_address
    || value.product_binding_hash !== value.manifest.product_binding_hash || BigInt(value.sender_nonce) >= 2n ** 64n) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The recipient action must match its saved wallet, product and signing authority.' })
  }
})
export type FundRecipientExpectation = z.infer<typeof fundRecipientExpectationSchema>
export class FundRecipientChainError extends Error {
  constructor(public readonly code: string) { super('The saved recipient instruction or independently observed identity evidence does not match. Keep the original operation; do not resend.') }
}
const fail = (code: string): never => { throw new FundRecipientChainError(code) }
const lower = (value: unknown) => String(value).toLowerCase()
const hex = (value: string | bigint) => `0x${BigInt(value).toString(16)}`
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('RECIPIENT_RPC_RECORD_INVALID') }
function rpcQuantity(value: unknown): bigint { return typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && BigInt(value) < 2n ** 256n ? BigInt(value) : fail('RECIPIENT_RPC_QUANTITY_INVALID') }
function checkedHash(value: unknown): string { const raw = lower(value); return /^0x[0-9a-f]{64}$/.test(raw) && !/^0x0{64}$/.test(raw) ? raw : fail('RECIPIENT_RPC_HASH_INVALID') }
const IDENTITY = new Interface(getCanonicalFundArtifact('Identity').abi)
const CLAIM = new Interface(getCanonicalFundArtifact('ClaimIssuer').abi)
const REGISTRY = new Interface(getCanonicalFundArtifact('IdentityRegistry').abi)
const SAFE = new Interface(getOfficialSafeArtifact('Safe').abi)
const SAFE_TYPES = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }
export type FundRecipientSafeTransaction = { to: string; value: '0'; data: string; operation: 0; safeTxGas: '0'; baseGas: '0'; gasPrice: '0'; gasToken: string; refundReceiver: string; nonce: string }
export type FundRecipientIntent = {
  version: 1; chain_id: 80002; operation_id: string; operation_revision: number; phase: FundRecipientExpectation['phase']; expectation_hash: string;
  catalog_hash: string; sender_address: string; sender_nonce: string; execution_mode: 'EOA_TRANSACTION' | 'SAFE_TRANSACTION';
  to: string | null; value: '0'; transaction_data: string; expected_identity_address: string; claim_data: string; claim_data_hash: string; claim_id: string;
  safe_transaction: FundRecipientSafeTransaction | null; safe_transaction_hash: string | null; safe_owners: string[]; safe_threshold: number;
  valid_until: string; claim_valid_until: string; expiry_enforced_on_chain: false; snapshot: FundAdmissionSnapshot;
}
export type FundRecipientClaimSigningRequest = { method: 'personal_sign'; message: string; signer_address: string; identity_address: string; claim_topic: string; claim_data: string; claim_data_hash: string; expiry_enforced_on_chain: false }
/** Domain/data binding is preventive against replay, but upstream 2.2.1 does not interpret its expiry. */
export function buildFundRecipientClaimData(input: Pick<FundRecipientExpectation, 'product_binding_hash' | 'account_binding_hash' | 'eligibility_binding_hash' | 'recipient_address' | 'valid_until'>) {
  for (const value of [input.product_binding_hash, input.account_binding_hash, input.eligibility_binding_hash]) if (!digest.safeParse(value).success) return fail('RECIPIENT_CLAIM_BINDING_INVALID')
  if (!address.safeParse(input.recipient_address).success || !z.string().datetime({ offset: true }).safeParse(input.valid_until).success) return fail('RECIPIENT_CLAIM_BINDING_INVALID')
  return AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'address', 'uint256'],
    [keccak256(toUtf8Bytes('BX1_FUND_RECIPIENT_CLAIM_V1')), 80002, `0x${input.product_binding_hash}`, `0x${input.account_binding_hash}`,
      `0x${input.eligibility_binding_hash}`, input.recipient_address, Math.floor(Date.parse(input.valid_until) / 1000)]).toLowerCase()
}
export function buildFundRecipientClaimSigningRequest(raw: unknown): FundRecipientClaimSigningRequest {
  const e = fundRecipientExpectationSchema.parse(raw)
  if (!e.identity_address || Date.parse(e.valid_until) <= Date.now() || Date.parse(e.action_valid_until) <= Date.now()) return fail('RECIPIENT_CLAIM_NOT_CURRENT')
  const data = buildFundRecipientClaimData(e), message = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes'], [e.identity_address, e.claim_topic, data]))
  return { method: 'personal_sign', message, signer_address: e.claim_signer_address, identity_address: e.identity_address,
    claim_topic: e.claim_topic, claim_data: data, claim_data_hash: keccak256(data), expiry_enforced_on_chain: false }
}
function issuer(e: FundRecipientExpectation) {
  const found = e.manifest.token_details.claim_issuers.filter(item => item.topics.includes(e.claim_topic))
  if (found.length !== 1 || found[0].code_kind !== 'IMMUTABLE' || found[0].runtime_hash !== keccak256(canonicalFundRuntime('ClaimIssuer'))
    || !e.manifest.token_details.claim_topics.includes(e.claim_topic)) return fail('RECIPIENT_CLAIM_ISSUER_NOT_PINNED')
  return found[0]
}
function verifyClaimSignature(e: FundRecipientExpectation, data: string) {
  if (!e.identity_address || !e.claim_signature) return fail('RECIPIENT_CLAIM_SIGNATURE_REQUIRED')
  const message = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes'], [e.identity_address, e.claim_topic, data]))
  try { const parsed = Signature.from(e.claim_signature)
    if (![27, 28].includes(parsed.v) || lower(parsed.serialized) !== e.claim_signature || lower(verifyMessage(getBytes(message), parsed)) !== e.claim_signer_address) return fail('RECIPIENT_CLAIM_SIGNATURE_INVALID')
  } catch { return fail('RECIPIENT_CLAIM_SIGNATURE_INVALID') }
}
async function code(rpc: FundAdmissionRpc, url: string, at: string, expected: string, height: string) {
  const value = await rpc(url, 'eth_getCode', [at, hex(height)])
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value) || keccak256(value) !== expected) return fail('RECIPIENT_CANONICAL_CODE_CHANGED')
}
async function safeAt(rpc: FundAdmissionRpc, url: string, e: FundRecipientExpectation, height: string, completed: boolean) {
  const s = e.manifest.safe
  if (s.runtime_hash !== FUND_SETUP_SAFE_PROXY_HASH || FUND_SETUP_SAFE_SINGLETONS[s.singleton.address as keyof typeof FUND_SETUP_SAFE_SINGLETONS] !== s.singleton.runtime_hash) return fail('RECIPIENT_SAFE_RELEASE_UNSUPPORTED')
  await Promise.all([code(rpc, url, s.address, s.runtime_hash, height), code(rpc, url, s.singleton.address, s.singleton.runtime_hash, height)])
  const read = async (method: string, args: unknown[] = []) => {
    try { return SAFE.decodeFunctionResult(method, String(await rpc(url, 'eth_call', [{ to: s.address, data: SAFE.encodeFunctionData(method, args) }, hex(height)]))) } catch { return fail('RECIPIENT_SAFE_READ_UNAVAILABLE') }
  }
  const [owners, threshold, nonce, modules, singleton, guard, fallback] = await Promise.all([read('getOwners'), read('getThreshold'), read('nonce'),
    read('getModulesPaginated', [SENTINEL, 100]), read('getStorageAt', [0, 1]), read('getStorageAt', [keccak256(toUtf8Bytes('guard_manager.guard.address')), 1]),
    read('getStorageAt', [keccak256(toUtf8Bytes('fallback_manager.handler.address')), 1])])
  const slot = (value: unknown) => { const raw = lower(value); return /^0x0{24}[0-9a-f]{40}$/.test(raw) ? `0x${raw.slice(-40)}` : fail('RECIPIENT_SAFE_STORAGE_INVALID') }
  if (JSON.stringify([...owners[0]].map(lower).sort()) !== JSON.stringify([...s.owners].sort()) || Number(threshold[0]) !== s.threshold
    || e.safe_nonce === null || (completed ? BigInt(nonce[0]) < BigInt(e.safe_nonce) + 1n : String(nonce[0]) !== e.safe_nonce)
    || modules[0].length !== 0 || lower(modules[1]) !== SENTINEL || slot(singleton[0]) !== s.singleton.address
    || slot(guard[0]) !== ZERO || slot(fallback[0]) !== ZERO) return fail('RECIPIENT_SAFE_GOVERNANCE_CHANGED')
}
async function identityAt(rpc: FundAdmissionRpc, url: string, e: FundRecipientExpectation, at: string, height: string) {
  const binding = e.manifest.token_details.onchain_id_binding
  if (binding.code_kind !== 'ONCHAINID_PROXY' || !binding.implementation || !binding.implementation_authority
    || binding.implementation_version !== '2.2.1' || binding.implementation.runtime_hash !== keccak256(canonicalFundRuntime('Identity'))
    || binding.implementation_authority.owner !== e.manifest.safe.address) return fail('RECIPIENT_IDENTITY_RELEASE_NOT_PINNED')
  await Promise.all([code(rpc, url, at, keccak256(canonicalFundRuntime('IdentityProxy')), height),
    code(rpc, url, binding.implementation.address, binding.implementation.runtime_hash, height), code(rpc, url, binding.implementation_authority.address, binding.implementation_authority.runtime_hash, height)])
  const key = keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [e.recipient_address]))
  const [authority, implementation, owner, version, management] = await Promise.all([
    readCanonicalFundResult(rpc, url, at, 'IdentityProxy', 'implementationAuthority', [], height),
    readCanonicalFundResult(rpc, url, binding.implementation_authority.address, 'ImplementationAuthority', 'getImplementation', [], height),
    readCanonicalFundResult(rpc, url, binding.implementation_authority.address, 'ImplementationAuthority', 'owner', [], height),
    readCanonicalFundResult(rpc, url, at, 'Identity', 'version', [], height), readCanonicalFundResult(rpc, url, at, 'Identity', 'keyHasPurpose', [key, 1], height),
  ])
  if (lower(authority[0]) !== binding.implementation_authority.address || lower(implementation[0]) !== binding.implementation.address
    || lower(owner[0]) !== binding.implementation_authority.owner || version[0] !== '2.2.1' || management[0] !== true) return fail('RECIPIENT_IDENTITY_AUTHORITY_CHANGED')
}
async function claimAt(rpc: FundAdmissionRpc, url: string, e: FundRecipientExpectation, data: string, height: string, revoked: boolean) {
  const trusted = issuer(e), key = keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [e.claim_signer_address]))
  await code(rpc, url, trusted.address, trusted.runtime_hash, height)
  const [purpose, isRevoked, valid] = await Promise.all([
    readCanonicalFundResult(rpc, url, trusted.address, 'ClaimIssuer', 'keyHasPurpose', [key, 3], height),
    readCanonicalFundResult(rpc, url, trusted.address, 'ClaimIssuer', 'isClaimRevoked', [e.claim_signature!], height),
    readCanonicalFundResult(rpc, url, trusted.address, 'ClaimIssuer', 'isClaimValid', [e.identity_address!, e.claim_topic, e.claim_signature!, data], height),
  ])
  if (purpose[0] !== true || isRevoked[0] !== revoked || valid[0] !== !revoked) return fail('RECIPIENT_CLAIM_KEY_OR_REVOCATION_CHANGED')
}
/** Cryptographic/provider evidence only; cannot approve a customer or product eligibility. */
export async function verifyFundRecipientClaim(raw: unknown, options: FundSetupObservers = {}) {
  const e = fundRecipientExpectationSchema.parse(raw), request = buildFundRecipientClaimSigningRequest(e), trusted = issuer(e)
  verifyClaimSignature(e, request.claim_data)
  const rpc = fundAdmissionRpc(options), observed = await readFundAdmissionSnapshot(rpc)
  for (const url of FUNDING_RPC_URLS) {
    await identityAt(rpc, url, e, e.identity_address!, observed.block.number)
    await claimAt(rpc, url, e, request.claim_data, observed.block.number, false)
  }
  await recheckFundAdmissionSnapshot(rpc, observed)
  if (Date.parse(e.action_valid_until) <= Date.now() || Date.parse(e.valid_until) <= Date.now()) return fail('RECIPIENT_CLAIM_NOT_CURRENT')
  return { version: 1 as const, status: 'VERIFIED' as const, operation_id: e.operation_id, expectation_hash: fundSetupHash(e),
    signature: e.claim_signature!, claim_data_hash: request.claim_data_hash, claim_signer_address: request.signer_address,
    claim_id: keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [trusted.address, e.claim_topic])),
    observed, catalog_hash: FUND_SETUP_CATALOG_HASH, expiry_enforced_on_chain: false as const }
}
async function registryAt(rpc: FundAdmissionRpc, url: string, e: FundRecipientExpectation, height: string) {
  const r = e.manifest.suite.identity_registry
  const pieces = [
    { piece: r, proxy: 'IdentityRegistryProxy' as const, implementation: 'IdentityRegistry' as const, getter: 'getIRImplementation' },
    { piece: e.manifest.suite.trusted_issuers, proxy: 'TrustedIssuersRegistryProxy' as const, implementation: 'TrustedIssuersRegistry' as const, getter: 'getTIRImplementation' },
    { piece: e.manifest.suite.claim_topics, proxy: 'ClaimTopicsRegistryProxy' as const, implementation: 'ClaimTopicsRegistry' as const, getter: 'getCTRImplementation' },
  ]
  const authorityContract = e.manifest.implementation_authority
  if (authorityContract.runtime_hash !== keccak256(canonicalFundRuntime('TREXImplementationAuthority'))) return fail('RECIPIENT_REGISTRY_RELEASE_NOT_PINNED')
  await code(rpc, url, authorityContract.address, authorityContract.runtime_hash, height)
  const [version, authorityOwner] = await Promise.all([
    readCanonicalFundResult(rpc, url, authorityContract.address, 'TREXImplementationAuthority', 'getCurrentVersion', [], height),
    readCanonicalFundResult(rpc, url, authorityContract.address, 'TREXImplementationAuthority', 'owner', [], height),
  ])
  if (JSON.stringify([...version[0]].map(Number)) !== '[4,1,3]' || lower(authorityOwner[0]) !== e.manifest.safe.address) return fail('RECIPIENT_REGISTRY_AUTHORITY_CHANGED')
  for (const item of pieces) {
    if (item.piece.runtime_hash !== keccak256(canonicalFundRuntime(item.proxy)) || item.piece.implementation_runtime_hash !== keccak256(canonicalFundRuntime(item.implementation))) return fail('RECIPIENT_REGISTRY_RELEASE_NOT_PINNED')
    await Promise.all([code(rpc, url, item.piece.address, item.piece.runtime_hash, height), code(rpc, url, item.piece.implementation_address, item.piece.implementation_runtime_hash, height)])
    const [proxyAuthority, activeImplementation] = await Promise.all([
      readCanonicalFundResult(rpc, url, item.piece.address, item.proxy, 'getImplementationAuthority', [], height),
      readCanonicalFundResult(rpc, url, authorityContract.address, 'TREXImplementationAuthority', item.getter, [], height),
    ])
    if (lower(proxyAuthority[0]) !== authorityContract.address || lower(activeImplementation[0]) !== item.piece.implementation_address) return fail('RECIPIENT_REGISTRY_AUTHORITY_CHANGED')
  }
  const [authority, owner, storage, issuers, topics, agent] = await Promise.all([
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistryProxy', 'getImplementationAuthority', [], height),
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistry', 'owner', [], height),
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistry', 'identityStorage', [], height),
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistry', 'issuersRegistry', [], height),
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistry', 'topicsRegistry', [], height),
    readCanonicalFundResult(rpc, url, r.address, 'IdentityRegistry', 'isAgent', [e.manifest.safe.address], height),
  ])
  if (lower(authority[0]) !== e.manifest.implementation_authority.address || lower(owner[0]) !== e.manifest.safe.address
    || lower(storage[0]) !== e.manifest.suite.identity_storage.address || lower(issuers[0]) !== e.manifest.suite.trusted_issuers.address
    || lower(topics[0]) !== e.manifest.suite.claim_topics.address || agent[0] !== true) return fail('RECIPIENT_REGISTRY_AUTHORITY_CHANGED')
  const trusted = issuer(e)
  await Promise.all([code(rpc, url, e.manifest.suite.trusted_issuers.address, e.manifest.suite.trusted_issuers.runtime_hash, height),
    code(rpc, url, e.manifest.suite.claim_topics.address, e.manifest.suite.claim_topics.runtime_hash, height)])
  const [allowed, required] = await Promise.all([
    readCanonicalFundResult(rpc, url, e.manifest.suite.trusted_issuers.address, 'TrustedIssuersRegistry', 'getTrustedIssuerClaimTopics', [trusted.address], height),
    readCanonicalFundResult(rpc, url, e.manifest.suite.claim_topics.address, 'ClaimTopicsRegistry', 'getClaimTopics', [], height),
  ])
  if (JSON.stringify([...allowed[0]].map(String).sort()) !== JSON.stringify([...trusted.topics].sort()) || ![...required[0]].map(String).includes(e.claim_topic)
    || JSON.stringify([...required[0]].map(String).sort()) !== JSON.stringify([...e.manifest.token_details.claim_topics].sort())) return fail('RECIPIENT_REQUIRED_TOPICS_CHANGED')
}
/** Reads only. Caller persists the result and claims UNKNOWN before showing MetaMask. */
function expectedRecipientPayload(e: FundRecipientExpectation) {
  const data = buildFundRecipientClaimData(e)
  const identity = e.identity_address ?? getCreateAddress({ from: e.sender_address, nonce: e.sender_nonce }).toLowerCase(), trusted = issuer(e)
  if (e.phase !== 'CREATE_IDENTITY') verifyClaimSignature(e, data)
  const targetData = e.phase === 'CREATE_IDENTITY' ? canonicalFundCreation('IdentityProxy', [e.manifest.token_details.onchain_id_binding.implementation_authority?.address ?? fail('RECIPIENT_IDENTITY_RELEASE_NOT_PINNED'), e.recipient_address])
    : e.phase === 'ADD_CLAIM' ? IDENTITY.encodeFunctionData('addClaim', [e.claim_topic, 1, trusted.address, e.claim_signature!, data, '']).toLowerCase()
      : e.phase === 'REGISTER_IDENTITY' ? REGISTRY.encodeFunctionData('registerIdentity', [e.recipient_address, identity, e.country_code]).toLowerCase()
        : CLAIM.encodeFunctionData('revokeClaimBySignature', [e.claim_signature!]).toLowerCase()
  const safeTransaction: FundRecipientSafeTransaction | null = e.phase === 'REGISTER_IDENTITY' ? {
    to: e.manifest.suite.identity_registry.address, value: '0', data: targetData, operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: ZERO, refundReceiver: ZERO, nonce: e.safe_nonce!,
  } : null
  const to = e.phase === 'CREATE_IDENTITY' ? null : safeTransaction ? e.manifest.safe.address : e.phase === 'REVOKE_CLAIM' ? trusted.address : identity
  return { data, identity, trusted, targetData, safeTransaction, to }
}
export async function prepareFundRecipientOperation(raw: unknown, options: FundSetupObservers = {}): Promise<FundRecipientIntent> {
  const e = fundRecipientExpectationSchema.parse(raw)
  if (e.phase === 'REGISTER_IDENTITY' && e.safe_nonce === null) return fail('RECIPIENT_SAFE_NONCE_REQUIRED')
  if (Date.parse(e.action_valid_until) <= Date.now() || e.phase !== 'REVOKE_CLAIM' && Date.parse(e.valid_until) <= Date.now()) return fail('RECIPIENT_AUTHORITY_EXPIRED')
  const rpc = fundAdmissionRpc(options), snapshot = await readFundAdmissionSnapshot(rpc)
  const { data, identity, trusted, targetData, safeTransaction, to } = expectedRecipientPayload(e)
  for (const url of FUNDING_RPC_URLS) {
    if (e.phase === 'CREATE_IDENTITY') {
      if (await rpc(url, 'eth_getCode', [identity, hex(snapshot.block.number)]) !== '0x') return fail('RECIPIENT_IDENTITY_ADDRESS_OCCUPIED')
      const binding = e.manifest.token_details.onchain_id_binding
      if (!binding.implementation || !binding.implementation_authority || binding.implementation_version !== '2.2.1'
        || binding.implementation.runtime_hash !== keccak256(canonicalFundRuntime('Identity'))) return fail('RECIPIENT_IDENTITY_RELEASE_NOT_PINNED')
      await Promise.all([code(rpc, url, binding.implementation.address, binding.implementation.runtime_hash, snapshot.block.number), code(rpc, url, binding.implementation_authority.address, binding.implementation_authority.runtime_hash, snapshot.block.number)])
      const implementation = await readCanonicalFundResult(rpc, url, binding.implementation_authority.address, 'ImplementationAuthority', 'getImplementation', [], snapshot.block.number)
      if (lower(implementation[0]) !== binding.implementation.address) return fail('RECIPIENT_IDENTITY_AUTHORITY_CHANGED')
    } else {
      await identityAt(rpc, url, e, identity, snapshot.block.number)
      await claimAt(rpc, url, e, data, snapshot.block.number, false)
      if (e.phase === 'REGISTER_IDENTITY') {
        await safeAt(rpc, url, e, snapshot.block.number, false); await registryAt(rpc, url, e, snapshot.block.number)
        const linked = await readCanonicalFundResult(rpc, url, e.manifest.suite.identity_registry.address, 'IdentityRegistry', 'identity', [e.recipient_address], snapshot.block.number)
        if (lower(linked[0]) !== ZERO) return fail('RECIPIENT_REGISTRY_ALREADY_BOUND')
      }
      const target = e.phase === 'REVOKE_CLAIM' ? trusted.address : e.phase === 'REGISTER_IDENTITY' ? e.manifest.suite.identity_registry.address : identity
      const from = e.phase === 'REGISTER_IDENTITY' ? e.manifest.safe.address : e.sender_address
      const simulated = await rpc(url, 'eth_call', [{ from, to: target, value: '0x0', data: targetData }, hex(snapshot.block.number)])
      if (typeof simulated !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(simulated)) return fail('RECIPIENT_ACTION_SIMULATION_FAILED')
    }
  }
  await recheckFundAdmissionSnapshot(rpc, snapshot)
  if (Date.parse(e.action_valid_until) <= Date.now() || e.phase !== 'REVOKE_CLAIM' && Date.parse(e.valid_until) <= Date.now()) return fail('RECIPIENT_AUTHORITY_EXPIRED_DURING_CHECKS')
  return { version: 1, chain_id: 80002, operation_id: e.operation_id, operation_revision: e.revision, phase: e.phase, expectation_hash: fundSetupHash(e),
    catalog_hash: FUND_SETUP_CATALOG_HASH, sender_address: e.sender_address, sender_nonce: e.sender_nonce,
    execution_mode: safeTransaction ? 'SAFE_TRANSACTION' : 'EOA_TRANSACTION', to,
    value: '0', transaction_data: targetData, expected_identity_address: identity, claim_data: data, claim_data_hash: keccak256(data),
    claim_id: keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [trusted.address, e.claim_topic])),
    safe_transaction: safeTransaction, safe_transaction_hash: safeTransaction ? TypedDataEncoder.hash({ chainId: 80002, verifyingContract: e.manifest.safe.address }, SAFE_TYPES, safeTransaction) : null,
    safe_owners: [...e.manifest.safe.owners], safe_threshold: e.manifest.safe.threshold, valid_until: e.action_valid_until, claim_valid_until: e.valid_until, expiry_enforced_on_chain: false, snapshot }
}
export function recipientSafeTypedData(intent: FundRecipientIntent) {
  if (!intent.safe_transaction || !intent.safe_transaction_hash || !intent.to || intent.phase !== 'REGISTER_IDENTITY'
    || intent.chain_id !== 80002 || intent.version !== 1 || intent.safe_transaction.data !== intent.transaction_data || intent.value !== '0'
    || intent.safe_transaction.operation !== 0 || intent.safe_transaction.value !== '0') return fail('RECIPIENT_SAFE_INTENT_REQUIRED')
  const domain = { chainId: 80002, verifyingContract: intent.to }
  if (TypedDataEncoder.hash(domain, SAFE_TYPES, intent.safe_transaction) !== intent.safe_transaction_hash) return fail('RECIPIENT_SAFE_INTENT_CHANGED')
  return { domain, types: SAFE_TYPES, message: intent.safe_transaction }
}
export function verifyRecipientSafeSignature(intent: FundRecipientIntent, signerAddress: string, rawSignature: string) {
  const typed = recipientSafeTypedData(intent)
  try { const parsed = Signature.from(rawSignature)
    if (!address.safeParse(signerAddress).success || !intent.safe_owners.includes(signerAddress) || !signature.safeParse(rawSignature).success
      || ![27, 28].includes(parsed.v) || lower(parsed.serialized) !== rawSignature || lower(recoverAddress(TypedDataEncoder.hash(typed.domain, typed.types, typed.message), parsed)) !== signerAddress) return fail('RECIPIENT_SAFE_OWNER_SIGNATURE_INVALID')
  } catch { return fail('RECIPIENT_SAFE_OWNER_SIGNATURE_INVALID') }
  return { signer_address: signerAddress, signature: rawSignature }
}
export function buildSignedRecipientSafeTransaction(intent: FundRecipientIntent, signatures: { signer_address: string; signature: string }[]) {
  recipientSafeTypedData(intent)
  if (signatures.length !== intent.safe_threshold || new Set(signatures.map(item => item.signer_address)).size !== signatures.length) return fail('RECIPIENT_SAFE_THRESHOLD_NOT_MET')
  const sorted = signatures.map(item => verifyRecipientSafeSignature(intent, item.signer_address, item.signature)).sort((a, b) => a.signer_address.localeCompare(b.signer_address))
  const s = intent.safe_transaction!, packed = `0x${sorted.map(item => item.signature.slice(2)).join('')}`
  return { to: intent.to!, value: '0' as const, data: SAFE.encodeFunctionData('execTransaction', [s.to, s.value, s.data, s.operation, s.safeTxGas, s.baseGas, s.gasPrice, s.gasToken, s.refundReceiver, packed]).toLowerCase(), nonce: intent.sender_nonce }
}
function exactEvent(receipt: Record<string, unknown>, at: string, abi: Interface, name: string) {
  if (!Array.isArray(receipt.logs)) return fail('RECIPIENT_EVENT_MISSING')
  const topic = lower(abi.getEvent(name)!.topicHash), logs = receipt.logs.map(object).filter(log => lower(log.address) === at && Array.isArray(log.topics) && lower(log.topics[0]) === topic)
  if (logs.length !== 1 || logs[0].removed !== false) return fail('RECIPIENT_EVENT_AMBIGUOUS')
  const log = logs[0]
  if (checkedHash(log.transactionHash) !== checkedHash(receipt.transactionHash) || checkedHash(log.blockHash) !== checkedHash(receipt.blockHash)
    || rpcQuantity(log.blockNumber) !== rpcQuantity(receipt.blockNumber) || rpcQuantity(log.transactionIndex) !== rpcQuantity(receipt.transactionIndex)) return fail('RECIPIENT_EVENT_BINDING_MISMATCH')
  try { return abi.decodeEventLog(name, String(log.data), log.topics as string[]) } catch { return fail('RECIPIENT_EVENT_INVALID') }
}
/** Actual receipt/effects only. The SQL recorder must independently recheck scope and preserve unknown recovery. */
export async function observeFundRecipientOperation(raw: unknown, intent: FundRecipientIntent, transactionHash: string, options: FundSetupObservers = {}) {
  const e = fundRecipientExpectationSchema.parse(raw), txHash = checkedHash(transactionHash), rpc = fundAdmissionRpc(options), snapshot = await readFundAdmissionSnapshot(rpc)
  const expected = expectedRecipientPayload(e)
  if (intent.operation_id !== e.operation_id || intent.operation_revision !== e.revision || intent.expectation_hash !== fundSetupHash(e)
    || intent.catalog_hash !== FUND_SETUP_CATALOG_HASH || intent.phase !== e.phase || intent.chain_id !== 80002 || intent.version !== 1
    || intent.sender_address !== e.sender_address || intent.sender_nonce !== e.sender_nonce || intent.to !== expected.to || intent.value !== '0'
    || intent.transaction_data !== expected.targetData || intent.expected_identity_address !== expected.identity || intent.claim_data !== expected.data
    || intent.claim_data_hash !== keccak256(expected.data) || intent.valid_until !== e.action_valid_until || intent.claim_valid_until !== e.valid_until
    || intent.claim_id !== keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [expected.trusted.address, e.claim_topic]))
    || fundSetupHash(intent.safe_transaction) !== fundSetupHash(expected.safeTransaction) || intent.execution_mode !== (expected.safeTransaction ? 'SAFE_TRANSACTION' : 'EOA_TRANSACTION')
    || JSON.stringify(intent.safe_owners) !== JSON.stringify(e.manifest.safe.owners) || intent.safe_threshold !== e.manifest.safe.threshold
    || intent.expiry_enforced_on_chain !== false) return fail('RECIPIENT_INTENT_BINDING_CHANGED')
  const rawFacts = await Promise.all(FUNDING_RPC_URLS.map(async url => {
    const [tx, receipt] = await Promise.all([rpc(url, 'eth_getTransactionByHash', [txHash]), rpc(url, 'eth_getTransactionReceipt', [txHash])])
    return { url, tx, receipt }
  }))
  const base = { version: 1 as const, chain_id: 80002 as const, operation_id: e.operation_id, operation_revision: e.revision, phase: e.phase,
    expectation_hash: intent.expectation_hash, transaction_hash: txHash, identity_address: intent.expected_identity_address,
    claim_data_hash: intent.claim_data_hash, claim_id: intent.claim_id, expiry_enforced_on_chain: false as const, providers: snapshot.providers }
  for (const fact of rawFacts) if (fact.tx !== null) {
    const tx = object(fact.tx)
    if (checkedHash(tx.hash) !== txHash || lower(tx.from) !== e.sender_address || rpcQuantity(tx.nonce).toString() !== e.sender_nonce
      || rpcQuantity(tx.value) !== 0n || tx.chainId !== undefined && rpcQuantity(tx.chainId) !== 80002n
      || (intent.to === null ? tx.to !== null : lower(tx.to) !== intent.to)) return fail('RECIPIENT_TRANSACTION_MISMATCH')
    if (intent.safe_transaction) {
      let call
      try { call = SAFE.decodeFunctionData('execTransaction', String(tx.input)) } catch { return fail('RECIPIENT_SAFE_CALL_INVALID') }
      const s = intent.safe_transaction
      if (lower(call[0]) !== s.to || String(call[1]) !== s.value || lower(call[2]) !== s.data || Number(call[3]) !== 0
        || String(call[4]) !== '0' || String(call[5]) !== '0' || String(call[6]) !== '0' || lower(call[7]) !== ZERO || lower(call[8]) !== ZERO) return fail('RECIPIENT_SAFE_CALL_MISMATCH')
      const signatures = lower(call[9])
      if (!new RegExp(`^0x[0-9a-f]{${intent.safe_threshold * 130}}$`).test(signatures)) return fail('RECIPIENT_SAFE_THRESHOLD_NOT_MET')
      const recovered: string[] = []
      for (let index = 0; index < intent.safe_threshold; index++) {
        const rawSignature = `0x${signatures.slice(2 + index * 130, 2 + (index + 1) * 130)}`
        let owner: string
        try { owner = lower(recoverAddress(intent.safe_transaction_hash!, Signature.from(rawSignature))) } catch { return fail('RECIPIENT_SAFE_OWNER_SIGNATURE_INVALID') }
        verifyRecipientSafeSignature(intent, owner, rawSignature)
        if (recovered.length && owner <= recovered[recovered.length - 1]) return fail('RECIPIENT_SAFE_OWNER_SIGNATURE_INVALID')
        recovered.push(owner)
      }
    } else if (lower(tx.input) !== intent.transaction_data) return fail('RECIPIENT_TRANSACTION_MISMATCH')
  }
  if (rawFacts.some(item => item.tx === null)) return { ...base, status: 'UNKNOWN' as const, reason_code: 'RECIPIENT_TRANSACTION_UNKNOWN' }
  if (rawFacts.some(item => item.receipt === null)) return { ...base, status: 'PENDING' as const, reason_code: 'RECIPIENT_RECEIPT_PENDING' }
  if (rawFacts.some(item => rpcQuantity(object(item.receipt).blockNumber) > BigInt(snapshot.block.number)
    || BigInt(snapshot.block.number) - rpcQuantity(object(item.receipt).blockNumber) + 1n < BigInt(e.manifest.required_confirmations))) return { ...base, status: 'PENDING' as const, reason_code: 'RECIPIENT_FINALITY_PENDING' }
  const observed = await Promise.all(rawFacts.map(async fact => {
    const r = object(fact.receipt), tx = object(fact.tx), height = rpcQuantity(r.blockNumber).toString(), bh = checkedHash(r.blockHash), index = rpcQuantity(r.transactionIndex)
    if (checkedHash(r.transactionHash) !== txHash || lower(r.from) !== e.sender_address || (intent.to === null ? r.to !== null : lower(r.to) !== intent.to)
      || checkedHash(tx.blockHash) !== bh || rpcQuantity(tx.blockNumber).toString() !== height || rpcQuantity(tx.transactionIndex) !== index || index > 2147483647n) return fail('RECIPIENT_RECEIPT_MISMATCH')
    const canonical = object(await rpc(fact.url, 'eth_getBlockByNumber', [hex(height), false]))
    if (checkedHash(canonical.hash) !== bh || rpcQuantity(canonical.number).toString() !== height || !Array.isArray(canonical.transactions) || lower(canonical.transactions[Number(index)]) !== txHash) return fail('RECIPIENT_CANONICAL_BLOCK_CHANGED')
    const status = rpcQuantity(r.status)
    if (status !== 0n && status !== 1n) return fail('RECIPIENT_RECEIPT_STATUS_INVALID')
    const common = { block_number: height, block_hash: bh, block_timestamp: new Date(Number(rpcQuantity(canonical.timestamp)) * 1000).toISOString(), transaction_index: Number(index) }
    if (status === 0n) return { ...common, status: 'FAILED' as const, reason_code: 'RECIPIENT_TRANSACTION_REVERTED', inner_execution_success: false, registry_verified: false }
    if (intent.safe_transaction) {
      const failure = Array.isArray(r.logs) && r.logs.map(object).some(log => lower(log.address) === e.manifest.safe.address && Array.isArray(log.topics) && lower(log.topics[0]) === lower(SAFE.getEvent('ExecutionFailure')!.topicHash))
      const event = exactEvent(r, e.manifest.safe.address, SAFE, failure ? 'ExecutionFailure' : 'ExecutionSuccess')
      if (lower(event[0]) !== intent.safe_transaction_hash || String(event[1]) !== '0') return fail('RECIPIENT_SAFE_INNER_EVENT_MISMATCH')
      if (failure) return { ...common, status: 'FAILED' as const, reason_code: 'RECIPIENT_SAFE_INNER_FAILED', inner_execution_success: false, registry_verified: false }
    }
    if (Date.parse(common.block_timestamp) > Date.parse(e.action_valid_until) || e.phase !== 'REVOKE_CLAIM' && Date.parse(common.block_timestamp) > Date.parse(e.valid_until)) return fail('RECIPIENT_EXECUTED_AFTER_OFFCHAIN_AUTHORITY_EXPIRED')
    const identity = intent.expected_identity_address
    if (e.phase === 'CREATE_IDENTITY' && lower(r.contractAddress) !== identity || e.phase !== 'CREATE_IDENTITY' && r.contractAddress !== null) return fail('RECIPIENT_CREATED_ADDRESS_MISMATCH')
    for (const at of [height, snapshot.block.number]) {
      await identityAt(rpc, fact.url, e, identity, at)
      if (e.phase !== 'CREATE_IDENTITY') await claimAt(rpc, fact.url, e, intent.claim_data, at, e.phase === 'REVOKE_CLAIM')
    }
    if (e.phase === 'ADD_CLAIM' || e.phase === 'REGISTER_IDENTITY') {
      const claim = await readCanonicalFundResult(rpc, fact.url, identity, 'Identity', 'getClaim', [intent.claim_id], height)
      if (String(claim[0]) !== e.claim_topic || String(claim[1]) !== '1' || lower(claim[2]) !== issuer(e).address || lower(claim[3]) !== e.claim_signature || lower(claim[4]) !== intent.claim_data || String(claim[5]) !== '') return fail('RECIPIENT_STORED_CLAIM_MISMATCH')
      if (e.phase === 'ADD_CLAIM') {
        const event = exactEvent(r, identity, IDENTITY, 'ClaimAdded')
        if (lower(event[0]) !== intent.claim_id || String(event[1]) !== e.claim_topic || lower(event[3]) !== issuer(e).address || lower(event[4]) !== e.claim_signature || lower(event[5]) !== intent.claim_data) return fail('RECIPIENT_CLAIM_EVENT_MISMATCH')
      }
    }
    let registryVerified = false
    if (e.phase === 'REGISTER_IDENTITY' || e.phase === 'REVOKE_CLAIM') {
      for (const at of [height, snapshot.block.number]) {
        await registryAt(rpc, fact.url, e, at)
        const [linked, country, valid] = await Promise.all([
          readCanonicalFundResult(rpc, fact.url, e.manifest.suite.identity_registry.address, 'IdentityRegistry', 'identity', [e.recipient_address], at),
          readCanonicalFundResult(rpc, fact.url, e.manifest.suite.identity_registry.address, 'IdentityRegistry', 'investorCountry', [e.recipient_address], at),
          readCanonicalFundResult(rpc, fact.url, e.manifest.suite.identity_registry.address, 'IdentityRegistry', 'isVerified', [e.recipient_address], at),
        ])
        if (lower(linked[0]) !== identity || Number(country[0]) !== e.country_code || valid[0] !== (e.phase === 'REGISTER_IDENTITY')) return fail('RECIPIENT_REGISTRY_EFFECT_MISMATCH')
        registryVerified = valid[0] === true
      }
      if (e.phase === 'REGISTER_IDENTITY') {
        await safeAt(rpc, fact.url, e, height, true); await safeAt(rpc, fact.url, e, snapshot.block.number, true)
        const event = exactEvent(r, e.manifest.suite.identity_registry.address, REGISTRY, 'IdentityRegistered')
        if (lower(event[0]) !== e.recipient_address || lower(event[1]) !== identity) return fail('RECIPIENT_REGISTRY_EVENT_MISMATCH')
      } else {
        const event = exactEvent(r, issuer(e).address, CLAIM, 'ClaimRevoked')
        // Upstream declares dynamic bytes as indexed. The topic is its Keccak
        // digest; ABI decoding cannot recover the original signature bytes.
        if (object(event[0]).hash !== keccak256(e.claim_signature!)) return fail('RECIPIENT_REVOCATION_EVENT_MISMATCH')
      }
    }
    const reread = await rpc(fact.url, 'eth_getTransactionReceipt', [txHash])
    if (fundSetupHash(reread) !== fundSetupHash(r)) return fail('RECIPIENT_RECEIPT_CHANGED_AFTER_WAIT')
    const rb = object(await rpc(fact.url, 'eth_getBlockByNumber', [hex(height), false]))
    if (checkedHash(rb.hash) !== bh || rpcQuantity(rb.number).toString() !== height || !Array.isArray(rb.transactions) || lower(rb.transactions[Number(index)]) !== txHash) return fail('RECIPIENT_REORG_AFTER_WAIT')
    return { ...common, status: 'FINAL' as const, reason_code: null, inner_execution_success: true, registry_verified: registryVerified }
  }))
  if (fundSetupHash(observed[0]) !== fundSetupHash(observed[1])) return fail('RECIPIENT_OBSERVERS_DISAGREE')
  await recheckFundAdmissionSnapshot(rpc, snapshot)
  return { ...base, ...observed[0] }
}
export type FundRecipientObservation = Awaited<ReturnType<typeof observeFundRecipientOperation>>
