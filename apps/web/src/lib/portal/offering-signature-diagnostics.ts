import 'server-only'
import { z } from 'zod'
import type { OfferingEnvelopeExpectation, OfferingProviderRead } from './docusign-offering-provider'

const identitySchema = z.object({
  environment: z.literal('TESTNET'), operation_id: z.string().uuid(), envelope_id: z.string().uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()
const timestamp = z.string().max(64).datetime({ offset: true })
const envelopeStatuses = new Set(['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided'])
const signerStatuses = new Set(['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'autoresponded'])
const assessmentReasons = new Set(['BINDING_MISMATCH', 'ENVELOPE_INVALID', 'ENVELOPE_MISMATCH', 'DECLINED', 'VOIDED',
  'NOT_COMPLETED', 'RECIPIENTS_INVALID', 'EXTRA_RECIPIENT', 'RECIPIENT_MISMATCH', 'DOCUMENTS_INVALID',
  'DOCUMENT_INVENTORY_CHANGED', 'CUSTOM_FIELDS_INVALID', 'CUSTOM_FIELDS_CHANGED', 'TABS_INVALID', 'TABS_CHANGED',
  'AUDIT_MISSING', 'TIMELINE_INVALID', 'AUDIT_INVALID', 'PROVIDER_INTEGRITY_CHANGED', 'AUDIT_UNKNOWN_ACTION',
  'AUDIT_INCOMPLETE', 'AUTHENTICATED_COMPLETION_REQUIRES_RETAINED_ARTIFACTS_AND_CURRENT_AUTHORITY'])
type DiagnosticResource = Pick<OfferingProviderRead, 'value' | 'observedAt'>
type DiagnosticInput = {
  environment: string; operationId: string; envelopeId: string; generation: number;
  assessmentReason: string;
  expected: Pick<OfferingEnvelopeExpectation, 'operationId' | 'signer'>;
  envelope: DiagnosticResource; recipients: DiagnosticResource;
}
function status(value: unknown, allowed: Set<string>) {
  return value === undefined || value === null ? 'MISSING'
    : typeof value === 'string' && allowed.has(value) ? value : 'UNRECOGNISED'
}
function instant(value: unknown): string | null {
  const parsed = timestamp.safeParse(value)
  return parsed.success ? new Date(parsed.data).toISOString() : null
}
function observed(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Diagnostic only: no provider request, durable evidence or permission is created. */
export function offeringSignatureDiagnostic(input: DiagnosticInput) {
  try {
    const identity = identitySchema.safeParse({ environment: input.environment, operation_id: input.operationId,
      envelope_id: input.envelopeId, generation: input.generation })
    if (!identity.success || input.expected.operationId !== input.operationId) return null
    const envelope = input.envelope.value, recipients = input.recipients.value
    const signers = Array.isArray(recipients.signers) ? recipients.signers : null
    const signer = signers?.length === 1 ? record(signers[0]) : null
    return {
      event: 'bx1_offering_signature_reconciliation_diagnostic', version: 1,
      ...identity.data,
      provider_envelope_status: status(envelope.status, envelopeStatuses),
      provider_signer_status: status(signer?.status, signerStatuses),
      assessment_reason: assessmentReasons.has(input.assessmentReason) ? input.assessmentReason : 'OTHER',
      signer_count: signers && signers.length <= 1000 ? signers.length : null,
      envelope_identity_matches: envelope.envelopeId === input.envelopeId
        && (envelope.transactionId === undefined || envelope.transactionId === input.operationId),
      signer_identity_matches: signer !== null && signer.recipientId === '1'
        && signer.clientUserId === input.expected.signer.clientUserId
        && signer.name === input.expected.signer.name && signer.email === input.expected.signer.email,
      provider_signed_at: instant(signer?.signedDateTime), provider_completed_at: instant(envelope.completedDateTime),
      envelope_observed_at: observed(input.envelope.observedAt), recipients_observed_at: observed(input.recipients.observedAt),
    }
  } catch { return null }
}

/** A single bounded structured line. Logging failure never changes reconciliation. */
export function logOfferingSignatureDiagnostic(input: DiagnosticInput): void {
  try {
    const diagnostic = offeringSignatureDiagnostic(input)
    if (diagnostic) console.info(JSON.stringify(diagnostic))
  } catch { /* Observability is not a business-result dependency. */ }
}
