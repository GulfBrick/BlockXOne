import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { PortalOperatingContext } from './operating-context'

/** Existing admission commands only. This projection never grants command authority. */
export const STAGE2_COMMANDS = [
  'start_application', 'submit_application', 'review_application',
  'create_investment_account', 'create_entity_investment_account',
  'request_representative_mandate', 'review_representative_mandate', 'apply_representative_mandate',
  'request_investing_representative_mandate', 'review_investing_representative_mandate', 'apply_investing_representative_mandate',
  'respond_investing_representative_proposal',
] as const
export type Stage2Command = typeof STAGE2_COMMANDS[number]
const contextSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('APPLICANT') }).strict(),
  z.object({ mode: z.literal('ROLE'), organisationId: z.string().uuid(), role: z.enum(BX1_ROLES) }).strict(),
])
const applicantCommands: readonly Stage2Command[] = ['start_application', 'submit_application', 'create_investment_account', 'create_entity_investment_account', 'request_representative_mandate', 'request_investing_representative_mandate', 'respond_investing_representative_proposal']
const reviewCommands: readonly Stage2Command[] = ['review_application', 'review_representative_mandate', 'review_investing_representative_mandate']
const applyCommands: readonly Stage2Command[] = ['apply_representative_mandate', 'apply_investing_representative_mandate']
export const stage2AccessSchema = z.object({
  version: z.literal(1), environment: z.enum(['TESTNET', 'MAINNET']), actor_id: z.string().uuid(),
  operating_context: contextSchema, session_mode: z.enum(['STANDARD', 'TEST_PASSWORD']),
  allowed_commands: z.array(z.enum(STAGE2_COMMANDS)),
}).strict().superRefine((value, ctx) => {
  if (value.session_mode === 'TEST_PASSWORD' && value.environment !== 'TESTNET') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password admission is TEST only.' })
  if (new Set(value.allowed_commands).size !== value.allowed_commands.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate admission command.' })
  const allowed = value.operating_context.mode === 'APPLICANT' ? applicantCommands
    : value.operating_context.role === 'ComplianceOfficer' ? reviewCommands
      : value.operating_context.role === 'SuperAdmin' ? applyCommands : []
  if (value.allowed_commands.some(command => !allowed.includes(command))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Admission commands do not match the operating context.' })
})
export type Stage2Access = z.infer<typeof stage2AccessSchema>
type AdmissionSnapshot = { actor: { id: string }; operating_context?: PortalOperatingContext; stage2_access?: unknown; rehearsal?: unknown }
function sameContext(left: PortalOperatingContext, right: PortalOperatingContext): boolean {
  return left.mode === 'APPLICANT' ? right.mode === 'APPLICANT'
    : right.mode === 'ROLE' && left.organisationId === right.organisationId && left.role === right.role
}
export function validatedStage2Access(snapshot: AdmissionSnapshot, context?: PortalOperatingContext, environment?: 'TESTNET' | 'MAINNET'): Stage2Access | null {
  if ('rehearsal' in snapshot) return null
  const parsed = stage2AccessSchema.safeParse(snapshot.stage2_access)
  if (!parsed.success || parsed.data.actor_id !== snapshot.actor.id
    || environment !== undefined && parsed.data.environment !== environment
    || context !== undefined && !sameContext(parsed.data.operating_context, context)
    || snapshot.operating_context !== undefined && !sameContext(parsed.data.operating_context, snapshot.operating_context)) return null
  return parsed.data
}
export function hasStage2CommandAccess(snapshot: AdmissionSnapshot, command: string, context?: PortalOperatingContext): boolean {
  return validatedStage2Access(snapshot, context)?.allowed_commands.some(item => item === command) ?? false
}
export function isTestPasswordAdmission(snapshot: AdmissionSnapshot): boolean {
  return validatedStage2Access(snapshot)?.session_mode === 'TEST_PASSWORD'
}
