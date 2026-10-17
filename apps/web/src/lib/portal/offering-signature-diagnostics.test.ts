import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { logOfferingSignatureDiagnostic, offeringSignatureDiagnostic } from './offering-signature-diagnostics'

// Synthetic data only: these checks create no provider observation or completion.
const operation = '11111111-1111-4111-8111-111111111111'
const envelope = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const now = Date.UTC(2026, 9, 15, 19, 34, 52)
function fixture() {
  return { environment: 'TESTNET', operationId: operation, envelopeId: envelope, generation: 7, assessmentReason: 'NOT_COMPLETED',
    expected: { operationId: operation, signer: { accountId: actor, personId: actor, clientUserId: actor,
      name: 'SYNTHETIC_PRIVATE_NAME', email: 'synthetic-private@example.invalid' } },
    envelope: { observedAt: now, value: { envelopeId: envelope, transactionId: operation, status: 'delivered',
      completedDateTime: undefined as unknown, privateUrl: 'https://private.invalid/sign?secret=MARKER' } },
    recipients: { observedAt: now + 10, value: { signers: [{ recipientId: '1', clientUserId: actor,
      name: 'SYNTHETIC_PRIVATE_NAME', email: 'synthetic-private@example.invalid', status: 'completed',
      signedDateTime: '2026-10-15T19:34:00+00:00', privateToken: 'PRIVATE_PROVIDER_TOKEN' }] } } }
}
afterEach(() => vi.restoreAllMocks())

describe('same-attempt sanitized DocuSign reconciliation diagnostic', () => {
  it('distinguishes delivered envelope and completed signer without changing completion', () => {
    expect(offeringSignatureDiagnostic(fixture())).toEqual({
      event: 'bx1_offering_signature_reconciliation_diagnostic', version: 1, environment: 'TESTNET',
      operation_id: operation, envelope_id: envelope, generation: 7,
      provider_envelope_status: 'delivered', provider_signer_status: 'completed', signer_count: 1,
      assessment_reason: 'NOT_COMPLETED',
      envelope_identity_matches: true, signer_identity_matches: true,
      signer_stable_identity_matches: true, signer_display_name_matches: true,
      provider_signed_at: '2026-10-15T19:34:00.000Z', provider_completed_at: null,
      envelope_observed_at: now, recipients_observed_at: now + 10,
    })
  })

  it('matches only the frozen signer identity and exact saved envelope/operation', () => {
    const changes = [
      (value: ReturnType<typeof fixture>) => { value.envelope.value.envelopeId = actor },
      (value: ReturnType<typeof fixture>) => { value.envelope.value.transactionId = actor },
      (value: ReturnType<typeof fixture>) => { value.recipients.value.signers[0].recipientId = '2' },
      (value: ReturnType<typeof fixture>) => { value.recipients.value.signers[0].clientUserId = envelope },
      (value: ReturnType<typeof fixture>) => { value.recipients.value.signers[0].name = 'DIFFERENT_PRIVATE_NAME' },
      (value: ReturnType<typeof fixture>) => { value.recipients.value.signers[0].email = 'different@example.invalid' },
    ]
    changes.forEach((change, index) => {
      const value = fixture(); change(value)
      const result = offeringSignatureDiagnostic(value)
      expect(index < 2 ? result?.envelope_identity_matches : result?.signer_identity_matches).toBe(false)
      if (index === 4) expect(result).toMatchObject({ signer_stable_identity_matches: true, signer_display_name_matches: false })
      if ([2, 3, 5].includes(index)) expect(result?.signer_stable_identity_matches).toBe(false)
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_NAME|example\.invalid/)
    })
    const foreign = fixture(); foreign.expected.operationId = actor
    expect(offeringSignatureDiagnostic(foreign)).toBeNull()
  })

  it('does not log PII, arbitrary provider fields, URIs, tokens or injected status/timestamps', () => {
    const value = fixture()
    value.envelope.value.status = 'completed\nPRIVATE_STATUS_MARKER'
    value.envelope.value.completedDateTime = 'https://private.invalid/PRIVATE_TIMESTAMP_MARKER'
    value.recipients.value.signers[0].status = 'PRIVATE_SIGNER_MARKER'
    value.recipients.value.signers[0].signedDateTime = 'PRIVATE_DATE_MARKER'
    value.assessmentReason = 'PRIVATE_REASON_MARKER'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOfferingSignatureDiagnostic(value)
    expect(info).toHaveBeenCalledTimes(1)
    const line = info.mock.calls[0][0] as string
    expect(line).not.toMatch(/PRIVATE_|MARKER|https?:|example\.invalid|clientUserId|"name"|"email"|privateToken/)
    expect(line).not.toContain(actor)
    expect(line.length).toBeLessThan(1200)
    expect(JSON.parse(line)).toMatchObject({ provider_envelope_status: 'UNRECOGNISED',
      provider_signer_status: 'UNRECOGNISED', assessment_reason: 'OTHER', provider_signed_at: null, provider_completed_at: null })
  })

  it('reports stable identity separately from an adopted placeholder display name without logging either name', () => {
    const value = fixture()
    value.expected.signer.name = value.expected.signer.email
    const result = offeringSignatureDiagnostic(value)
    expect(result).toMatchObject({ signer_identity_matches: false, signer_stable_identity_matches: true,
      signer_display_name_matches: false })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_NAME|example\.invalid|clientUserId|"name"|"email"/)
  })

  it('has bounded signer count and never treats a multiple-signer list as the frozen signer', () => {
    const value = fixture()
    value.recipients.value.signers.push({ ...value.recipients.value.signers[0] })
    expect(offeringSignatureDiagnostic(value)).toMatchObject({ signer_count: 2, signer_identity_matches: false,
      provider_signer_status: 'MISSING', provider_signed_at: null })
    value.recipients.value.signers = Array.from({ length: 1001 }, () => value.recipients.value.signers[0])
    expect(offeringSignatureDiagnostic(value)).toMatchObject({ signer_count: null, signer_identity_matches: false })
  })

  it('drops non-TEST, malformed identity/generation and cannot obstruct reconciliation if logging fails', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('PRIVATE_LOGGING_FAILURE') })
    for (const change of [{ environment: 'MAINNET' }, { operationId: 'PRIVATE_ID_MARKER' },
      { envelopeId: 'https://private.invalid' }, { generation: 0 }, { generation: Number.NaN }]) {
      expect(() => logOfferingSignatureDiagnostic({ ...fixture(), ...change })).not.toThrow()
    }
    expect(info).not.toHaveBeenCalled()
    expect(() => logOfferingSignatureDiagnostic(fixture())).not.toThrow()
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('is mounted only in the existing authenticated RECONCILE read and leaves status/payload/timing intact', () => {
    const source = readFileSync(new URL('./offering-signatures-server.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(source.match(/logOfferingSignatureDiagnostic\(\{/g)).toHaveLength(1)
    const start = source.indexOf('// Different resources run together;')
    const end = source.indexOf("if (item.action === 'RETAIN')", start)
    const reconcile = source.slice(start, end)
    expect(reconcile.indexOf('await live()')).toBeLessThan(reconcile.indexOf('logOfferingSignatureDiagnostic({'))
    expect(reconcile.indexOf('completionSchema.parse(evidence)')).toBeLessThan(reconcile.indexOf('logOfferingSignatureDiagnostic({'))
    expect(reconcile).toContain('generation: item.generation, assessmentReason: assessment.reason, expected, envelope: parsed.envelope, recipients: parsed.recipients')
    expect(reconcile).toContain("const status = providerState === 'completed' ? 'COMPLETED' : providerState === 'declined' ? 'DECLINED'")
    expect(reconcile).toContain(": providerState === 'voided' ? 'VOIDED' : ['sent','delivered','signed'].includes(String(providerState)) ? 'SENT' : 'UNKNOWN'")
    expect(reconcile).toContain("return await record(action, 'RECONCILE_RESULT', { status, envelope_id: envelopeId,")
    expect(reconcile).toContain('next_check_at: new Date(Date.now() + 900_000).toISOString()')
    expect(reconcile).toContain("...(status === 'COMPLETED' ? { evidence_json: evidenceJson } : {})")
    const diagnostic = readFileSync(new URL('./offering-signature-diagnostics.ts', import.meta.url), 'utf8')
    expect(diagnostic).not.toMatch(/\bfetch\(|client\.rpc|workerQuery|setTimeout|setInterval|process\.env/)
    expect(diagnostic.match(/console\.info\(/g)).toHaveLength(1)
  })
})
