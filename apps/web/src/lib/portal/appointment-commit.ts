import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalCommandSchema, type PortalCommand } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'

const id = z.string().uuid().refine(value => value !== '00000000-0000-0000-0000-000000000000')
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const appointmentCommands = [
  'request_product_service_appointment', 'review_product_service_appointment',
  'apply_product_service_appointment', 'revoke_product_service_appointment',
] as const
function isAppointmentCommand(command: string): boolean {
  return appointmentCommands.some(value => value === command)
}

/** A guarded writer's commit receipt, not a substitute for a current snapshot. */
export const appointmentCommitSchema = z.object({
  kind: z.literal('TEST_FUND_APPOINTMENT_COMMIT'), version: z.literal(1),
  environment: z.literal('TESTNET'), execution_mode: z.literal('TEST_ROLE_PLAY'), independence_proven: z.literal(false),
  actor_id: id, session_id: id,
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.enum(BX1_ROLES) }).strict(),
  policy_id: id, authority_epoch: positiveRevision, product_id: id, offering_revision_id: id,
  appointment_id: id, appointment_revision: positiveRevision,
  request: portalCommandSchema.refine(value => isAppointmentCommand(value.command), 'An appointment command is required.'),
  recorded_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const instruction = value.request
  if (instruction.command === 'request_product_service_appointment') {
    if (instruction.payload.product_id !== value.product_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ['product_id'], message: 'The committed product does not match the request.' })
  } else if (instruction.command === 'review_product_service_appointment' || instruction.command === 'apply_product_service_appointment'
    || instruction.command === 'revoke_product_service_appointment') {
    if (instruction.payload.appointment_id !== value.appointment_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ['appointment_id'], message: 'The committed appointment does not match the request.' })
  }
})
export type AppointmentCommit = z.infer<typeof appointmentCommitSchema>

/** Re-parse both instructions to compare schema-normalised objects rather than
 * PostgreSQL JSONB key order. A receipt never changes the caller's authority. */
export function matchesAppointmentCommit(value: unknown, expected: {
  actorId: string; context: PortalOperatingContext; request: PortalCommand; environment: PlatformEnvironment | undefined;
}): value is AppointmentCommit {
  if (expected.environment !== 'TESTNET' || expected.context.mode !== 'ROLE') return false
  const committed = appointmentCommitSchema.safeParse(value)
  const instruction = portalCommandSchema.safeParse(expected.request)
  return committed.success && instruction.success && isAppointmentCommand(instruction.data.command)
    && committed.data.actor_id === expected.actorId && portalContextMatches(committed.data.operating_context, expected.context)
    && JSON.stringify(committed.data.request) === JSON.stringify(instruction.data)
}
