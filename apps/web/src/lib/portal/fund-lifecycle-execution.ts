import 'server-only'
import { Interface } from 'ethers'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fundChainExpectationSchema, fundExpectationHash, prepareFundTransaction, verifyFundTransaction, verifyFundOwnerSignature, FundChainError } from './fund-lifecycle-chain'
import { fundIntentSchema, fundOperationSchema, type FundTransactionIntent } from './fund-lifecycle-contracts'
import { FundLifecycleError } from './fund-lifecycle-server'
import { callFundWorker } from './fund-lifecycle-worker'
import { requireFundRpcResult } from './fund-lifecycle-api'
import type { PortalOperatingContext } from './operating-context'

const SAFE = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool success)'])
const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/)
const ownerSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
function recover(expectation: z.infer<typeof fundChainExpectationSchema>, intent: FundTransactionIntent, signature: string, owner: string) {
  try {
    const proof = verifyFundOwnerSignature(expectation, signatureSchema.parse(signature), owner)
    if (proof.intent_hash !== intent.intent_hash) throw new Error('INTENT_HASH_MISMATCH')
    return proof.recovered_address
  }
  catch { throw new FundLifecycleError('SIGNATURE_INVALID', 'The signature did not verify for this exact Safe request.', 409) }
}
const recordSchema = z.object({
  expectation: fundChainExpectationSchema, operation: fundOperationSchema,
  signing_owner_address: ownerSchema.nullable().optional(),
})
async function readExecution(client: SupabaseClient, input: { operation_id: string; expected_revision: number; operating_context: PortalOperatingContext; signing_address?: string }) {
  const { data, error } = await client.rpc('bx1_portal_prepare_fund_transaction', {
    operation_id: input.operation_id, expected_revision: input.expected_revision, operating_context: input.operating_context,
    ...(input.signing_address ? { signing_address: input.signing_address } : {}),
  }).abortSignal(AbortSignal.timeout(10000))
  const result = recordSchema.safeParse(requireFundRpcResult(data, error))
  if (!result.success || result.data.operation.id !== input.operation_id || result.data.operation.revision !== input.expected_revision
    || result.data.expectation.operation_id !== input.operation_id || result.data.operation.product_id !== result.data.expectation.product_id
    || result.data.operation.offering_revision_id !== result.data.expectation.offering_revision_id) {
    throw new FundLifecycleError('EXECUTION_BINDING_UNAVAILABLE', 'The exact contract release, signing mandate or operation binding is not admitted. No wallet action was prepared.', 409)
  }
  return result.data
}
function chainError(error: unknown): never {
  if (error instanceof FundChainError) throw new FundLifecycleError(error.code,
    error.status === 503 ? 'Independent chain observations are unavailable. Keep the current operation and retry its verification.'
      : 'The saved network, contract, signer, nonce or eligibility requirement is no longer current. Refresh this operation before signing.', error.status)
  throw error
}

export async function prepareExecution(client: SupabaseClient, input: { operation_id: string; expected_revision: number; operating_context: PortalOperatingContext; signing_address?: string }) {
  let current = await readExecution(client, input)
  let prepared: FundTransactionIntent
  try { prepared = await prepareFundTransaction(current.expectation) } catch (error) { return chainError(error) }
  if (current.operation.state === 'REQUESTED') {
    const result = await callFundWorker('prepare_fund_operation', [input.operation_id, fundExpectationHash(current.expectation), JSON.stringify(prepared)])
    const saved = fundOperationSchema.safeParse(result)
    if (!saved.success || saved.data.id !== input.operation_id || saved.data.revision <= input.expected_revision || saved.data.state !== 'APPROVAL_PENDING') {
      throw new FundLifecycleError('PREPARATION_NOT_CONFIRMED', 'The request was not confirmed as ready for independent review. Refresh the original operation.', 503)
    }
    return { operation: saved.data, intent: null, signing_owner_address: null }
  }
  if (!['APPROVED', 'SIGNING'].includes(current.operation.state) || !current.operation.intent) throw new FundLifecycleError('APPROVAL_REQUIRED', 'This exact contract request must be independently approved before signing.', 409)
  if (JSON.stringify(fundIntentSchema.parse(current.operation.intent)) !== JSON.stringify(prepared)) throw new FundLifecycleError('INTENT_CHANGED', 'The approved Safe request differs from the current prepared operation. No signature was requested.', 409)
  // The provider reads are not authority. Re-read the database after the wait.
  current = await readExecution(client, input)
  if (!current.signing_owner_address || !current.operation.intent || !['APPROVED', 'SIGNING'].includes(current.operation.state)) throw new FundLifecycleError('SIGNER_NOT_CURRENT', 'No current Safe-owner mandate is available for this login.', 403)
  return { operation: current.operation, intent: prepared, signing_owner_address: current.signing_owner_address }
}

export async function recordExecutionSignature(client: SupabaseClient, input: { operation_id: string; expected_revision: number; signature: string; operating_context: PortalOperatingContext; signing_address?: string }) {
  const current = await readExecution(client, input)
  if (!current.operation.intent || !current.signing_owner_address || !['APPROVED', 'SIGNING'].includes(current.operation.state)) throw new FundLifecycleError('SIGNER_NOT_CURRENT', 'This login cannot sign the current operation.', 403)
  const recovered = recover(current.expectation, current.operation.intent, input.signature, current.signing_owner_address)
  if (recovered !== current.signing_owner_address.toLowerCase()) throw new FundLifecycleError('SIGNING_OWNER_MISMATCH', 'Use the wallet appointed to your own Safe-owner mandate.', 403)
  const { data, error } = await client.rpc('bx1_portal_record_fund_signature', input).abortSignal(AbortSignal.timeout(10000))
  const queued = requireFundRpcResult(data, error)
  const signatureId = z.string().uuid().parse(queued.signature_id)
  const verification = z.object({ signature: signatureSchema, intent: fundIntentSchema, expectation: fundChainExpectationSchema,
    signing_owner_address: ownerSchema }).parse(await callFundWorker('read_fund_signature_verification', [signatureId]))
  if (verification.signature !== input.signature || verification.expectation.operation_id !== input.operation_id
    || verification.intent.intent_hash !== current.operation.intent.intent_hash || verification.signing_owner_address.toLowerCase() !== recovered
    || recover(verification.expectation, verification.intent, verification.signature, verification.signing_owner_address) !== recovered) throw new FundLifecycleError('SIGNATURE_BINDING_CHANGED', 'The saved signer or operation changed. Refresh before continuing.', 409)
  const verified = requireFundRpcResult(await callFundWorker('record_fund_signature_verification', [signatureId, JSON.stringify({
    intent_hash: verification.intent.intent_hash, expectation_hash: fundExpectationHash(verification.expectation), recovered_address: recovered, valid: true,
  })]), null)
  const operation = fundOperationSchema.parse(verified.operation)
  const threshold = z.number().int().min(2).max(20).parse(verified.threshold)
  const count = z.number().int().min(0).max(20).parse(verified.signature_count)
  return { operation, signature_count: count, threshold, execution_transaction: null }
}

/** Execution is a separate, explicit handoff; the executor may have signed first. */
export async function claimExecution(client: SupabaseClient, input: { operation_id: string; expected_revision: number; operating_context: PortalOperatingContext }) {
  const current = await readExecution(client, input)
  if (!current.operation.intent) throw new FundLifecycleError('APPROVAL_REQUIRED', 'The exact contract request must be approved before execution.', 409)
  const selected = current.operation.signing_owner_addresses?.some(address => address.toLowerCase() === current.operation.intent!.signer_address.toLowerCase())
  const prepared = await prepareExecution(client, selected ? { ...input, signing_address: current.operation.intent.signer_address } : input)
  if (!prepared.intent || !prepared.signing_owner_address || prepared.signing_owner_address.toLowerCase() !== prepared.intent.signer_address.toLowerCase()) {
    throw new FundLifecycleError('EXECUTOR_REQUIRED', 'Only the designated execution wallet can submit the approved operation.', 403)
  }
  // Current database validation and a one-time nonce/submission lease must
  // succeed before any browser receives actionable execTransaction calldata.
  const { data: claimedData, error: claimedError } = await client.rpc('bx1_portal_claim_fund_execution', {
    operation_id: input.operation_id, expected_revision: prepared.operation.revision, operating_context: input.operating_context,
  }).abortSignal(AbortSignal.timeout(10000))
  const claimed = requireFundRpcResult(claimedData, claimedError)
  const intent = fundIntentSchema.parse(claimed.intent)
  const expectation = fundChainExpectationSchema.parse(claimed.expectation)
  const operation = fundOperationSchema.parse(claimed.operation)
  const threshold = expectation.manifest.safe.threshold
  const signatures = z.array(z.object({ signer_address: ownerSchema, signature: signatureSchema }).strict()).min(2).max(20).parse(claimed.signatures)
  if (intent.intent_hash !== prepared.intent.intent_hash || expectation.operation_id !== input.operation_id || signatures.length < threshold
    || operation.id !== input.operation_id || operation.state !== 'UNKNOWN' || operation.revision !== claimed.operation_revision
    || intent.signer_address.toLowerCase() !== prepared.signing_owner_address.toLowerCase()) throw new FundLifecycleError('EXECUTION_LEASE_UNVERIFIED', 'The current execution lease could not be verified. Do not execute another transaction.', 503)
  const owners = new Set(expectation.manifest.safe.owners.map(owner => owner.toLowerCase()))
  const signerSet = new Set<string>()
  const sorted = signatures.map(item => {
    const signer = recover(expectation, intent, item.signature, item.signer_address)
    if (signer !== item.signer_address.toLowerCase() || !owners.has(signer) || signerSet.has(signer)) throw new FundLifecycleError('SAFE_SIGNATURE_SET_INVALID', 'The Safe signature set is not current or independent.', 409)
    signerSet.add(signer); return { signer, signature: item.signature }
  }).sort((a, b) => a.signer.localeCompare(b.signer)).slice(0, threshold)
  const tx = intent.safe_transaction
  const dataHex = SAFE.encodeFunctionData('execTransaction', [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, `0x${sorted.map(item => item.signature.slice(2)).join('')}`])
  return { operation, intent, signature_count: signatures.length, threshold, execution_transaction: { operation_id: input.operation_id,
    expected_revision: z.number().int().positive().parse(claimed.operation_revision), from: intent.signer_address, to: intent.execution_account,
    data: dataHex, value: '0x0', chain_id: intent.chain_id } }
}

export async function observeExecution(client: SupabaseClient, input: { operation_id: string; expected_revision: number; operating_context: PortalOperatingContext }) {
  const current = await readExecution(client, input)
  if (!current.operation.transaction_hash || !['BROADCAST', 'MINED', 'CONFIRMING', 'UNKNOWN', 'REPLACED'].includes(current.operation.state)) throw new FundLifecycleError('TRANSACTION_REFERENCE_REQUIRED', 'Record the existing transaction hash before requesting verification.', 409)
  const lease = z.object({ verification_lease: z.object({ lease_id: z.string().uuid(), generation: z.number().int().positive() }),
    expectation: fundChainExpectationSchema, transaction_hash: z.string().regex(/^0x[0-9a-f]{64}$/i) }).parse(await callFundWorker('claim_fund_observation', [input.operation_id]))
  if (lease.expectation.operation_id !== input.operation_id || fundExpectationHash(lease.expectation) !== fundExpectationHash(current.expectation)
    || lease.transaction_hash.toLowerCase() !== current.operation.transaction_hash.toLowerCase()) throw new FundLifecycleError('OBSERVATION_LEASE_CHANGED', 'The transaction being checked changed. Refresh the existing operation.', 409)
  let observation
  try { observation = await verifyFundTransaction(lease.expectation, lease.transaction_hash) } catch (error) { return chainError(error) }
  const result = await callFundWorker('record_fund_observation', [input.operation_id, JSON.stringify({ ...observation, verification_lease: lease.verification_lease })])
  return { observation_status: observation.status, operation: fundOperationSchema.parse(result) }
}
