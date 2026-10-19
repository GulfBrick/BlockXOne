import { z } from 'zod'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalCommandSchema, type PortalCommand } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'

const id = z.string().uuid().refine(value => value !== '00000000-0000-0000-0000-000000000000')
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** The guarded TEST writer committed this request; this is not current product
 * state, independent approval, deployment readiness, or a PortalSnapshot. */
export const fundPublicationCommitSchema = z.object({
  kind: z.literal('TEST_FUND_PUBLICATION_COMMIT'), version: z.literal(1),
  environment: z.literal('TESTNET'), execution_mode: z.literal('TEST_ROLE_PLAY'), independence_proven: z.literal(false),
  actor_id: id, session_id: id,
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.literal('OfferingManager') }).strict(),
  policy_id: id, authority_epoch: positiveRevision, product_id: id, offering_revision_id: id,
  product_revision: positiveRevision,
  request: portalCommandSchema.refine(value => value.command === 'publish_product', 'A publication command is required.'),
  recorded_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.request.command !== 'publish_product') return
  if (value.request.payload.product_id !== value.product_id) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['product_id'], message: 'The committed product does not match the request.' })
  if (!positiveRevision.safeParse(value.request.payload.expected_revision).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'payload', 'expected_revision'], message: 'A safe positive revision is required.' })
  if (value.product_revision <= value.request.payload.expected_revision) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['product_revision'], message: 'The current revision must follow the published request revision.' })
  if (!id.safeParse(value.request.key).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'key'], message: 'A nonzero request key is required.' })
})
export type FundPublicationCommit = z.infer<typeof fundPublicationCommitSchema>

/** Compare schema-normalised requests, not PostgreSQL JSONB property order.
 * Only the actual writer determines authority and publication eligibility. */
export function matchesFundPublicationCommit(value: unknown, expected: {
  actorId: string; context: PortalOperatingContext; request: PortalCommand; environment: PlatformEnvironment | undefined;
}): value is FundPublicationCommit {
  if (expected.environment !== 'TESTNET' || expected.context.mode !== 'ROLE' || expected.context.role !== 'OfferingManager') return false
  const committed = fundPublicationCommitSchema.safeParse(value)
  const instruction = portalCommandSchema.safeParse(expected.request)
  return committed.success && instruction.success && instruction.data.command === 'publish_product'
    && committed.data.actor_id === expected.actorId && portalContextMatches(committed.data.operating_context, expected.context)
    && JSON.stringify(committed.data.request) === JSON.stringify(instruction.data)
}
