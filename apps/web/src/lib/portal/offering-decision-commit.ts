import { z } from 'zod'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalCommandSchema, type PortalCommand } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'

const id = z.string().uuid().refine(value => value !== '00000000-0000-0000-0000-000000000000')
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** A guarded TEST decision request was recorded. This is not a current package,
 * independent approval, publication, deployment, holding, or PortalSnapshot. */
export const offeringDecisionCommitSchema = z.object({
  kind: z.literal('TEST_FUND_OFFERING_DECISION_COMMIT'), version: z.literal(1),
  environment: z.literal('TESTNET'), execution_mode: z.literal('TEST_ROLE_PLAY'), independence_proven: z.literal(false),
  actor_id: id, session_id: id,
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: id,
    role: z.enum(['IssuerFundManager', 'ComplianceOfficer']) }).strict(),
  policy_id: id, authority_epoch: positiveRevision, product_id: id, offering_revision_id: id,
  decision_id: id, decision_kind: z.enum(['ISSUER', 'COMPLIANCE']),
  request: portalCommandSchema.refine(value => value.command === 'review_offering_issuer' || value.command === 'review_product',
    'An offering decision command is required.'),
  recorded_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.request.command !== 'review_offering_issuer' && value.request.command !== 'review_product') return
  const issuer = value.request.command === 'review_offering_issuer'
  if (value.decision_kind !== (issuer ? 'ISSUER' : 'COMPLIANCE')) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['decision_kind'], message: 'The decision kind does not match the request.' })
  if (value.operating_context.role !== (issuer ? 'IssuerFundManager' : 'ComplianceOfficer')) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['operating_context', 'role'], message: 'The decision role does not match the request.' })
  if (value.request.payload.product_id !== value.product_id) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['product_id'], message: 'The committed product does not match the request.' })
  if (value.request.payload.offering_revision_id !== value.offering_revision_id) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['offering_revision_id'], message: 'The committed offering does not match the request.' })
  if (!positiveRevision.safeParse(value.request.payload.expected_revision).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'payload', 'expected_revision'], message: 'A safe positive revision is required.' })
  if (!id.safeParse(value.request.key).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'key'], message: 'A nonzero request key is required.' })
})
export type OfferingDecisionCommit = z.infer<typeof offeringDecisionCommitSchema>

/** Match the exact schema-normalised original command, never JSONB key order.
 * Authority and actual decision evidence remain the canonical writer's job. */
export function matchesOfferingDecisionCommit(value: unknown, expected: {
  actorId: string; context: PortalOperatingContext; request: PortalCommand; environment: PlatformEnvironment | undefined;
}): value is OfferingDecisionCommit {
  if (expected.environment !== 'TESTNET' || expected.context.mode !== 'ROLE'
    || !['IssuerFundManager', 'ComplianceOfficer'].includes(expected.context.role)) return false
  const committed = offeringDecisionCommitSchema.safeParse(value)
  const instruction = portalCommandSchema.safeParse(expected.request)
  return committed.success && instruction.success
    && (instruction.data.command === 'review_offering_issuer' || instruction.data.command === 'review_product')
    && committed.data.actor_id === expected.actorId && portalContextMatches(committed.data.operating_context, expected.context)
    && JSON.stringify(committed.data.request) === JSON.stringify(instruction.data)
}
