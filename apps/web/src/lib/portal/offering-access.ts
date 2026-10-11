import { z } from 'zod'
import type { PortalOperatingContext } from './operating-context'
import { isTestPasswordAdmission, validatedStage2Access } from './stage2-access'

/** Package preparation only. This projection is not record or signing authority. */
export const OFFERING_COMMANDS = [
  'create_product', 'save_product', 'submit_product', 'begin_offering_amendment',
  'reopen_offering_review', 'request_product_service_appointment', 'review_offering_issuer',
  'review_product', 'review_product_service_appointment', 'apply_product_service_appointment',
] as const
export type OfferingCommand = typeof OFFERING_COMMANDS[number]
const offeringRoles = ['OfferingManager', 'IssuerFundManager', 'ComplianceOfficer', 'SuperAdmin'] as const
const roleCommands: Record<typeof offeringRoles[number], readonly OfferingCommand[]> = {
  OfferingManager: ['create_product', 'save_product', 'submit_product', 'begin_offering_amendment', 'reopen_offering_review', 'request_product_service_appointment'],
  IssuerFundManager: ['review_offering_issuer'],
  ComplianceOfficer: ['review_product', 'review_product_service_appointment'],
  SuperAdmin: ['apply_product_service_appointment'],
}
export const offeringAccessSchema = z.object({
  version: z.literal(1), environment: z.literal('TESTNET'), actor_id: z.string().uuid(),
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: z.string().uuid(), role: z.enum(offeringRoles) }).strict(),
  session_mode: z.literal('TEST_PASSWORD'), allowed_commands: z.array(z.enum(OFFERING_COMMANDS)),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.allowed_commands).size !== value.allowed_commands.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate package command.' })
  if (value.allowed_commands.some(command => !roleCommands[value.operating_context.role].includes(command))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Package commands do not match the operating context.' })
})
export type OfferingAccess = z.infer<typeof offeringAccessSchema>
type OfferingSnapshot = {
  actor: { id: string }; operating_context?: PortalOperatingContext;
  offering_access?: unknown; stage2_access?: unknown; rehearsal?: unknown;
}
function sameContext(left: PortalOperatingContext, right: PortalOperatingContext): boolean {
  return left.mode === 'APPLICANT' ? right.mode === 'APPLICANT'
    : right.mode === 'ROLE' && left.organisationId === right.organisationId && left.role === right.role
}
export function validatedOfferingAccess(snapshot: OfferingSnapshot, context?: PortalOperatingContext, environment?: 'TESTNET' | 'MAINNET'): OfferingAccess | null {
  if ('rehearsal' in snapshot) return null
  const parsed = offeringAccessSchema.safeParse(snapshot.offering_access)
  if (!parsed.success || parsed.data.actor_id !== snapshot.actor.id
    || environment !== undefined && parsed.data.environment !== environment
    || context !== undefined && !sameContext(parsed.data.operating_context, context)
    || snapshot.operating_context !== undefined && !sameContext(parsed.data.operating_context, snapshot.operating_context)) return null
  if (snapshot.stage2_access !== undefined) {
    const admission = validatedStage2Access(snapshot, parsed.data.operating_context, parsed.data.environment)
    if (!admission || admission.session_mode !== parsed.data.session_mode) return null
  }
  return parsed.data
}
export function hasOfferingCommandAccess(snapshot: OfferingSnapshot, command: string, context?: PortalOperatingContext): boolean {
  return validatedOfferingAccess(snapshot, context)?.allowed_commands.some(item => item === command) ?? false
}
export function isTestPasswordOffering(snapshot: OfferingSnapshot): boolean {
  return validatedOfferingAccess(snapshot)?.session_mode === 'TEST_PASSWORD'
}
export function isTestPasswordWorkflow(snapshot: OfferingSnapshot): boolean {
  return isTestPasswordAdmission(snapshot) || isTestPasswordOffering(snapshot)
}
