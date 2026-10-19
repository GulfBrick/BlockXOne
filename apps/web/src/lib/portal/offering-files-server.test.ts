import type { SupabaseClient } from '@supabase/supabase-js'
import { DatabaseError } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
const commandQuery = vi.hoisted(() => vi.fn())
const commandConfig = vi.hoisted(() => vi.fn())
vi.mock('pg', async original => ({ ...await original<object>(), Pool: class {
  query(...args: unknown[]) { return commandQuery(...args) }
  on() { return this }
} }))
vi.mock('./document-receipts', () => ({ documentReceiptQuery: query, documentReceiptDatabaseConfig: commandConfig }))
import { executeOfferingDocumentCommand, OfferingFileReceiptError, readOfferingDocuments,
  registerOfferingFile, reserveOfferingFile, verifiedOfferingFileSession, OfferingDocumentCommandRollback, sha256Hex } from './offering-files-server'
import { offeringDocumentPayloadText } from './offering-files'

const actor = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const context = { mode: 'ROLE' as const, organisationId: productId, role: 'OfferingManager' as const }
const attestation = { iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor, session_id: sessionId,
  role: 'authenticated' as const, aal: 'aal1' as const, exp: 4102444800, is_anonymous: false as const,
  amr: [{ method: 'password', timestamp: 1700000000 }] }
const session = { id: sessionId, aal: 'aal1' as const, attestation }
const input = { actorId: actor, session, context, revisionId }
const current = { revision_id: revisionId, product_id: productId, profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'NOT_ADMITTED',
  manifest: null, files: [], document_access: { version: 1, actor_id: actor, environment: 'TESTNET', context, session_id: sessionId,
    revision_id: revisionId, product_id: productId, allowed_commands: [], can_upload: false, can_read_clean: false,
    approval_allowed: false, approval_blocker: 'signature-not-connected' } }

beforeEach(() => {
  query.mockReset()
  commandQuery.mockReset()
  commandConfig.mockReset()
  commandConfig.mockReturnValue({ host: 'synthetic-command-fixture.invalid', user: 'bx1_document_receipt_writer', database: 'postgres',
    max: 2, connectionTimeoutMillis: 3000, query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000 })
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    BLOCKXONE_APP_ORIGIN: 'https://block-x-one-offering-file-test.vercel.app', VERCEL_ENV: 'preview',
    SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
})
afterEach(() => vi.unstubAllEnvs())

function authClient(claims: unknown, returnedActor = actor) {
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: returnedActor } }, error: null })
  const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: token } }, error: null })
  return { client: { auth: { getSession, getUser } } as unknown as SupabaseClient, token, getUser }
}

describe('offering document verified session transport', () => {
  it('transports an actually verified enrolled AAL1 password token without stripping its issuer/expiry/AMR or inventing AAL2', async () => {
    const auth = authClient(attestation)
    auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor, factors: [{ id: productId, status: 'verified' }] } }, error: null })
    expect(await verifiedOfferingFileSession(auth.client, actor)).toEqual(session)
    expect(auth.getUser).toHaveBeenCalledWith(auth.token)
    // This verifies transport only. Current factor/session/manager authority
    // is independently checked by the canonical restricted SQL writer.
  })

  it('uses actual getUser(token) before claims and preserves the exact native AMR rather than inventing password assurance', async () => {
    const claims = { ...attestation, aal: 'aal2', amr: [{ method: 'password', timestamp: 1700000000 }, { method: 'totp', timestamp: 1700000001 }] }
    const auth = authClient(claims)
    const result = await verifiedOfferingFileSession(auth.client, actor)
    expect(auth.getUser).toHaveBeenCalledWith(auth.token)
    expect(result.attestation).toEqual(claims)
    expect(result).toEqual({ id: sessionId, aal: 'aal2', attestation: claims })
  })

  it('rejects the malformed 8-4-4-12 session shape after verifying the token instead of accepting it as a UUID', async () => {
    const auth = authClient({ ...attestation, session_id: '22222222-2222-4222-222222222222' })
    await expect(verifiedOfferingFileSession(auth.client, actor)).rejects.toBeInstanceOf(OfferingFileReceiptError)
    expect(auth.getUser).toHaveBeenCalledWith(auth.token)
  })

  it('denies unverified, wrong-issuer, expired, anonymous or malformed claims without trusting user metadata', async () => {
    const unverified = authClient(attestation, productId)
    await expect(verifiedOfferingFileSession(unverified.client, actor)).rejects.toBeInstanceOf(OfferingFileReceiptError)
    for (const change of [{ iss: 'https://example.invalid/auth/v1' }, { exp: 1 }, { exp: '4102444800' }, { sub: productId },
      { is_anonymous: true }, { role: 'service_role' }, { session_id: '' }, { aal: 'aal3' }, { amr: [] },
      { amr: [{ method: 'password', timestamp: '1700000000' }] }]) {
      await expect(verifiedOfferingFileSession(authClient({ ...attestation, ...change, user_metadata: { role: 'OfferingManager' } }).client, actor))
        .rejects.toBeInstanceOf(OfferingFileReceiptError)
    }
  })

  it('uses only twelve-argument restricted reserve/register writers and the full verified attestation', async () => {
    query.mockResolvedValue({})
    const file = { actorId: actor, sessionId, aal: session.aal, context, productId, revisionId, fileId: actor,
      kind: 'MEMORANDUM', title: 'Fictional exact PDF', sha256: 'a'.repeat(64), size: 50, attestation }
    await reserveOfferingFile(file); await registerOfferingFile(file)
    for (const [sql, values] of query.mock.calls) {
      expect(sql).toContain('$12::jsonb')
      expect(values).toHaveLength(12)
      expect(JSON.parse(values[11])).toEqual(attestation)
      expect(sql).not.toContain('insert into')
    }
  })

  it('rejects catalogue responses not bound to current actor/session/environment/context/revision', async () => {
    query.mockResolvedValue(current)
    expect(await readOfferingDocuments(input)).toEqual(current)
    for (const change of [{ actor_id: productId }, { session_id: actor }, { environment: 'MAINNET' },
      { context: { ...context, organisationId: actor } }, { revision_id: actor }, { approval_allowed: true }]) {
      query.mockResolvedValue({ ...current, document_access: { ...current.document_access, ...change } })
      await expect(readOfferingDocuments(input)).rejects.toBeInstanceOf(OfferingFileReceiptError)
    }
    query.mockResolvedValue({ ...current, revision_id: actor })
    await expect(readOfferingDocuments(input)).rejects.toBeInstanceOf(OfferingFileReceiptError)
  })

  it('preserves complete command identity and attestation; malformed readback is never a success', async () => {
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'An abandoned immutable intent is deliberately excluded.' } }
    commandQuery.mockResolvedValue({ rows: [{ result: { ...current, files: [{ id: actor, revision_id: revisionId, kind: 'MEMORANDUM', title: 'Fictional abandoned intent',
      sha256: 'a'.repeat(64), size: 50, validation_state: 'QUARANTINED', uploaded_at: null, can_download: false,
      intent_state: 'EXCLUDED', processing_state: null, clean_receipt_id: null, selected: false }] } }] })
    await executeOfferingDocumentCommand(input, command)
    expect(commandQuery.mock.calls[0][0]).toContain('execute_offering_document_command')
    expect(commandQuery.mock.calls[0][1]).toEqual([actor, sessionId, 'aal1', JSON.stringify(context), command.command,
      command.key, JSON.stringify(command.payload), JSON.stringify(attestation)])
    commandQuery.mockResolvedValue({ rows: [{ result: { ...current, signed: true } }] })
    await expect(executeOfferingDocumentCommand(input, command)).rejects.toBeInstanceOf(OfferingFileReceiptError)
  })

  it('classifies only a trusted PostgreSQL23514/offering_document_stale as exact no-effect rollback; all other failures stay unknown', async () => {
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'An abandoned immutable intent is deliberately excluded.' } }
    const failure = (code: string, message: string) => { const error = new DatabaseError(message, 0, 'error'); error.code = code; return error }
    commandQuery.mockRejectedValue(failure('23514', 'offering_document_stale'))
    await expect(executeOfferingDocumentCommand(input, command)).rejects.toMatchObject({
      name: 'OfferingDocumentCommandRollback', rollback: { outcome: 'DEFINITE_ROLLBACK', reason: 'STALE_PRODUCT_REVISION', effects: 'NONE',
        code: '23514', command: command.command, key: command.key, actor_id: actor, product_id: productId, revision_id: revisionId,
        expected_revision: 3, context, payload_sha256: sha256Hex(new TextEncoder().encode(offeringDocumentPayloadText(command))) } })
    for (const error of [failure('23514', 'offering_document_manifest_not_ready'), failure('23505', 'offering_document_stale'),
      failure('57014', 'canceling statement due to statement timeout'), new Error('transport outcome unknown'),
      Object.assign(new Error('offering_document_stale'), { code: '23514' })]) {
      commandQuery.mockRejectedValue(error)
      await expect(executeOfferingDocumentCommand(input, command)).rejects.toBeInstanceOf(OfferingFileReceiptError)
      await expect(executeOfferingDocumentCommand(input, command)).rejects.not.toBeInstanceOf(OfferingDocumentCommandRollback)
    }
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts an exact committed original-key result even after current revision advances, without manufacturing rollback', async () => {
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'An abandoned immutable intent is deliberately excluded.' } }
    const committed = { ...current, state: 'REJECTED_OR_EXCLUDED', files: [{ id: actor, revision_id: revisionId, kind: 'MEMORANDUM',
      title: 'Already committed abandoned intent', sha256: 'a'.repeat(64), size: 50, validation_state: 'QUARANTINED', uploaded_at: null,
      can_download: false, intent_state: 'EXCLUDED', processing_state: null, clean_receipt_id: null, selected: false }] }
    commandQuery.mockResolvedValue({ rows: [{ result: committed }] })
    expect(await executeOfferingDocumentCommand(input, command)).toEqual(committed)
    expect(JSON.parse(commandQuery.mock.calls[0][1][6])).toEqual(command.payload)
  })

  it('revalidates and refuses a changed private connection binding before reusing the command cache', async () => {
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'An abandoned immutable intent is deliberately excluded.' } }
    commandQuery.mockResolvedValue({ rows: [{ result: { ...current, files: [{ id: actor, revision_id: revisionId, kind: 'MEMORANDUM',
      title: 'Committed immutable intent', sha256: 'a'.repeat(64), size: 50, validation_state: 'QUARANTINED', uploaded_at: null,
      can_download: false, intent_state: 'EXCLUDED', processing_state: null, clean_receipt_id: null, selected: false }] } }] })
    await executeOfferingDocumentCommand(input, command)
    commandQuery.mockClear(); commandConfig.mockClear()
    commandConfig.mockReturnValueOnce({ host: 'changed-fixture.invalid', user: 'bx1_document_receipt_writer', database: 'postgres',
      max: 2, connectionTimeoutMillis: 3000, query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000 })
    await expect(executeOfferingDocumentCommand(input, command)).rejects.toBeInstanceOf(OfferingFileReceiptError)
    expect(commandConfig).toHaveBeenCalledOnce()
    expect(commandQuery).not.toHaveBeenCalled()
  })
})
