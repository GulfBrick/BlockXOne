import { z } from 'zod'
import { portalOperatingContextSchema } from './operating-context'

const id = z.string().uuid()
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(value => !/^0x0{64}$/.test(value))
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value))
const uintPattern = /^(0|[1-9][0-9]{0,77})$/
const uint = z.string().regex(uintPattern).refine(value => uintPattern.test(value) && BigInt(value) < 2n ** 256n)
// Public evidence identifiers only. RPC transport remains the existing server
// adapter; credential-bearing or configurable endpoints must not be disclosed.
const observer = z.enum(['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'])

/** Only a saved order identity is accepted. No browser receipt, hash or amount. */
export const fundPaymentReceiptRequestSchema = z.object({
  subscription_id: id, operating_context: portalOperatingContextSchema,
}).strict()

/** Read-only handoff data, NOT payment acceptance or a signed payer claim. */
export const fundPaymentReceiptPrefillSchema = z.object({
  version: z.literal(1), status: z.literal('READY_FOR_PAYER_CLAIM'),
  payment_id: id, subscription_id: id, obligation_id: id, obligation_revision: z.number().int().positive(),
  route_id: id, route_revision: z.number().int().positive(), investment_account_id: id, actor_id: id,
  chain_id: z.literal(80002), currency: z.literal('TST'), token_decimals: z.literal(6),
  token_address: address, token_runtime_hash: hash, beneficiary_address: address,
  payer_address: address, transaction_hash: hash, log_index: z.number().int().min(0).max(2147483647),
  amount_base_units: uint.refine(value => uintPattern.test(value) && BigInt(value) > 0n),
  block_number: uint, block_hash: hash, block_timestamp: z.string().datetime({ offset: true }),
  providers: z.array(z.object({ url: observer, finalized_block_number: uint, finalized_block_hash: hash }).strict()).length(2)
    .refine(providers => new Set(providers.map(provider => provider.url)).size === 2),
}).strict()
export const fundPaymentReceiptResponseSchema = z.object({ prefill: fundPaymentReceiptPrefillSchema }).strict()
export type FundPaymentReceiptRequest = z.infer<typeof fundPaymentReceiptRequestSchema>
export type FundPaymentReceiptPrefill = z.infer<typeof fundPaymentReceiptPrefillSchema>
