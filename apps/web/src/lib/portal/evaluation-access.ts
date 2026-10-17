import { z } from 'zod'
import type { PortalOperatingContext } from './operating-context'

/** A server-owned TEST workspace grant, not customer admission or signing authority. */
export const EVALUATION_COMMANDS = ['create_product', 'save_product', 'submit_product', 'request_product_service_appointment'] as const
const managerViews = ['/portal', '/portal/products', '/portal/products/new', '/portal/products/detail'] as const
const investorViews = ['/portal', '/portal/opportunities', '/portal/opportunities/detail', '/portal/portfolio'] as const
export const evaluationAccessSchema = z.object({
  version: z.literal(1), environment: z.literal('TESTNET'), mode: z.literal('TEST_EVALUATION'),
  actor_id: z.string().uuid(), entitlement_id: z.string().uuid(), revision: z.number().int().positive(),
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: z.string().uuid(), role: z.enum(['OfferingManager', 'Investor']) }).strict(),
  product_organisation_id: z.string().uuid().nullable(), expires_at: z.string().datetime({ offset: true }),
  allowed_commands: z.array(z.enum(EVALUATION_COMMANDS)),
  allowed_views: z.array(z.enum(['/portal', '/portal/products', '/portal/products/new', '/portal/products/detail', '/portal/opportunities', '/portal/opportunities/detail', '/portal/portfolio'])),
}).strict().superRefine((value, ctx) => {
  const manager = value.operating_context.role === 'OfferingManager'
  const views: readonly string[] = manager ? managerViews : investorViews
  if (manager !== (value.product_organisation_id !== null)
    || !manager && value.allowed_commands.length !== 0
    || new Set(value.allowed_commands).size !== value.allowed_commands.length
    || new Set(value.allowed_views).size !== value.allowed_views.length
    || value.allowed_views.some(view => !views.includes(view))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TEST workspace scope is invalid.' })
  }
})
export type EvaluationAccess = z.infer<typeof evaluationAccessSchema>
type Snapshot = { actor: { id: string }; operating_context?: PortalOperatingContext; evaluation_access?: unknown; rehearsal?: unknown }
export function evaluationContextMatches(access: EvaluationAccess, context: PortalOperatingContext): boolean {
  return context.mode === 'ROLE' && access.operating_context.organisationId === context.organisationId && access.operating_context.role === context.role
}
export function validatedEvaluationAccess(snapshot: Snapshot, context?: PortalOperatingContext, environment?: 'TESTNET' | 'MAINNET'): EvaluationAccess | null {
  if ('rehearsal' in snapshot) return null
  const parsed = evaluationAccessSchema.safeParse(snapshot.evaluation_access)
  if (!parsed.success || parsed.data.actor_id !== snapshot.actor.id || Date.parse(parsed.data.expires_at) <= Date.now()
    || environment !== undefined && parsed.data.environment !== environment
    || context !== undefined && !evaluationContextMatches(parsed.data, context)
    || snapshot.operating_context !== undefined && !evaluationContextMatches(parsed.data, snapshot.operating_context)) return null
  return parsed.data
}
export function hasEvaluationCommandAccess(snapshot: Snapshot, command: string, context?: PortalOperatingContext): boolean {
  return validatedEvaluationAccess(snapshot, context)?.allowed_commands.some(item => item === command) ?? false
}
export function sameEvaluationGrant(left: EvaluationAccess, right: EvaluationAccess): boolean {
  return left.entitlement_id === right.entitlement_id && left.revision === right.revision && left.actor_id === right.actor_id
    && left.product_organisation_id === right.product_organisation_id && left.expires_at === right.expires_at
    && evaluationContextMatches(left, right.operating_context)
}
