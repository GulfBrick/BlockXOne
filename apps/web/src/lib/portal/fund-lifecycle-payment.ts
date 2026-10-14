import 'server-only'
import { Interface } from 'ethers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fundPaymentIntentSchema, type FundPaymentIntent } from './fund-lifecycle-contracts'
import { requireFundRpcResult } from './fund-lifecycle-api'
import { FundLifecycleError } from './fund-lifecycle-server'
import type { PortalOperatingContext } from './operating-context'

const TRANSFER = new Interface(['function transfer(address to,uint256 amount) returns(bool)'])
function checkedPayment(data: unknown, error: { code?: string } | null, actorId: string): FundPaymentIntent {
  const result = requireFundRpcResult(data, error)
  const parsed = fundPaymentIntentSchema.safeParse(result.intent)
  if (!parsed.success || parsed.data.actor_id !== actorId || parsed.data.data.toLowerCase() !== TRANSFER.encodeFunctionData('transfer',
    [parsed.data.beneficiary_address, parsed.data.amount_base_units]).toLowerCase()) {
    throw new FundLifecycleError('PAYMENT_INTENT_UNVERIFIED', 'The exact account, TST amount or receiving instruction could not be verified. Nothing was sent.', 503)
  }
  return parsed.data
}
export async function prepareFundPayment(client: SupabaseClient, actorId: string, input: {
  subscription_id: string; expected_obligation_revision: number; payer_address: string; operating_context: PortalOperatingContext;
}) {
  const { data, error } = await client.rpc('bx1_portal_prepare_fund_payment', input).abortSignal(AbortSignal.timeout(10000))
  const intent = checkedPayment(data, error, actorId)
  if (intent.subscription_id !== input.subscription_id || intent.obligation_revision !== input.expected_obligation_revision
    || intent.payer_address.toLowerCase() !== input.payer_address.toLowerCase()) throw new FundLifecycleError('PAYMENT_INSTRUCTION_CHANGED', 'The saved payment or payer wallet changed. Refresh the existing order.', 409)
  return { intent }
}
export async function claimFundPayment(client: SupabaseClient, actorId: string, input: { payment_id: string; operating_context: PortalOperatingContext }) {
  const { data, error } = await client.rpc('bx1_portal_submit_fund_payment', input).abortSignal(AbortSignal.timeout(10000))
  const intent = checkedPayment(data, error, actorId)
  if (intent.payment_id !== input.payment_id || intent.state !== 'UNKNOWN' || intent.transaction_hash) throw new FundLifecycleError('PAYMENT_SUBMISSION_NOT_LEASED', 'The existing payment submission is already claimed or unverified. Check its original outcome instead of paying again.', 409)
  return { intent }
}
export async function recordFundPayment(client: SupabaseClient, actorId: string, input: { payment_id: string; transaction_hash: string; operating_context: PortalOperatingContext }) {
  const { data, error } = await client.rpc('bx1_portal_record_fund_payment', input).abortSignal(AbortSignal.timeout(10000))
  const intent = checkedPayment(data, error, actorId)
  if (intent.payment_id !== input.payment_id || intent.state !== 'BROADCAST' || intent.transaction_hash?.toLowerCase() !== input.transaction_hash.toLowerCase()) throw new FundLifecycleError('PAYMENT_REFERENCE_UNCONFIRMED', 'The existing transfer reference was not confirmed. Retain its hash and refresh; do not send a second transfer.', 503)
  return { intent }
}
