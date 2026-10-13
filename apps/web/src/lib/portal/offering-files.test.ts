import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { offeringFilePath, offeringFileReceiptSchema, offeringDocumentSnapshotSchema, offeringDocumentCommandSchema,
  offeringDocumentEvidenceSchema, offeringFileLookupSchema, readOfferingDocumentRetry, saveOfferingDocumentRetry, clearOfferingDocumentRetry,
  offeringDocumentPayloadText, offeringDocumentRollbackMatches } from './offering-files'

import { isPdfHeader, offeringFileId, sha256Hex } from './offering-files-server'

const revision = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'

describe('offering-file quarantine identity', () => {
  it('gives an exact retry the same immutable file path, but a changed byte or kind a different path', () => {
    const a = offeringFileId(revision, actor, 'MEMORANDUM', 'a'.repeat(64))
    expect(a).toBe(offeringFileId(revision, actor, 'MEMORANDUM', 'a'.repeat(64)))
    expect(a).not.toBe(offeringFileId(revision, actor, 'MEMORANDUM', 'b'.repeat(64)))
    expect(a).not.toBe(offeringFileId(revision, actor, 'RISKS', 'a'.repeat(64)))
    expect(offeringFilePath(revision, actor, a)).toBe(`${revision}/${actor}/${a}`)
  })

  it('checks actual bytes and never treats a PDF header or receipt as a scan verdict', () => {
    const bytes = Buffer.from('%PDF-1.7\nfictional unscanned file')
    expect(isPdfHeader(bytes)).toBe(true)
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/)
    const receipt = { id: offeringFileId(revision, actor, 'MEMORANDUM', sha256Hex(bytes)),
      revision_id: revision, kind: 'MEMORANDUM', title: 'Fictional test', sha256: sha256Hex(bytes),
      size: bytes.length, validation_state: 'QUARANTINED', uploaded_at: '2026-09-28T00:00:00Z' }
    expect(offeringFileReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(offeringFileReceiptSchema.safeParse({ ...receipt, validation_state: 'SCANNED_CLEAN' }).success).toBe(false)
  })
})

describe('strict offering document authority and immutable manifest', () => {
  const product = '33333333-3333-4333-8333-333333333333'
  const context = { mode: 'ROLE', organisationId: product, role: 'OfferingManager' }
  const ids = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666']
  const files = ['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'].map((kind, index) => ({ id: ids[index], revision_id: revision,
    kind, title: 'Exact independently scanned fictional PDF', sha256: 'a'.repeat(64), size: 50,
    validation_state: 'QUARANTINED', uploaded_at: '2026-10-12T00:00:00Z', can_download: true,
    intent_state: 'PROMOTED_CLEAN', processing_state: 'COMPLETED', clean_receipt_id: ids[index], selected: true }))
  const sealed = { revision_id: revision, product_id: product, profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'SEALED_SIGNATURE_REQUIRED',
    files, manifest: { id: product, hash: 'b'.repeat(64), sealed_at: '2026-10-12T00:00:00Z', file_ids: ids,
      correspondence_statement: 'The selected exact PDF bytes correspond to these submitted text disclosures; this is a declaration only.' },
    document_access: { version: 1, actor_id: actor, environment: 'TESTNET', context, session_id: actor,
      revision_id: revision, product_id: product, allowed_commands: ['resolve_offering_file_intent', 'seal_offering_document_manifest'],
      can_upload: false, can_read_clean: true, approval_allowed: false, approval_blocker: 'signature-not-connected' } }

  it('accepts canonical selected clean evidence without relabelling the original quarantine row or granting approval', () => {
    expect(offeringDocumentSnapshotSchema.parse(sealed)).toEqual(sealed)
    expect(offeringDocumentEvidenceSchema.safeParse({ profile: 'PDF_SIGNATURE_REQUIRED_V1', state: sealed.state,
      manifest_id: product, manifest_hash: 'b'.repeat(64), signature_status: 'NOT_CONNECTED', approval_allowed: false }).success).toBe(true)
  })

  it('rejects coerced, added, stale, duplicate, missing and reordered document authority/bindings', () => {
    const access = sealed.document_access
    const mutations = [
      { ...sealed, status: 'APPROVED' }, { ...sealed, profile: null }, { ...sealed, manifest: null },
      { ...sealed, document_access: { ...access, approval_allowed: true } },
      { ...sealed, document_access: { ...access, can_upload: true } },
      { ...sealed, document_access: { ...access, actor_id: 123 } },
      { ...sealed, document_access: { ...access, product_id: actor } },
      { ...sealed, document_access: { ...access, allowed_commands: ['seal_offering_document_manifest', 'seal_offering_document_manifest'] } },
      { ...sealed, document_access: { ...access, context: { ...context, role: 'Administrator' } } },
      { ...sealed, manifest: { ...sealed.manifest, file_ids: [ids[1], ids[0], ids[2]] } },
      { ...sealed, manifest: { ...sealed.manifest, file_ids: [ids[0], ids[0], ids[2]] } },
      { ...sealed, files: files.slice(0, 2) }, { ...sealed, files: [files[0], files[0], files[2]] },
      { ...sealed, files: [{ ...files[0], clean_receipt_id: null }, ...files.slice(1)] },
      { ...sealed, files: [{ ...files[0], revision_id: actor }, ...files.slice(1)] },
      { ...sealed, files: [{ ...files[0], uploaded_at: null }, ...files.slice(1)] },
    ]
    for (const value of mutations) expect(offeringDocumentSnapshotSchema.safeParse(value).success).toBe(false)
  })

  it('retains abandoned reservations with nullable upload time and explicit pending resolution', () => {
    const pending = { ...sealed, state: 'PENDING_SCAN', manifest: null,
      files: [{ ...files[0], uploaded_at: null, intent_state: 'PENDING', processing_state: null, clean_receipt_id: null, selected: false, can_download: false }],
      document_access: { ...sealed.document_access, can_upload: true, can_read_clean: false } }
    expect(offeringDocumentSnapshotSchema.safeParse(pending).success).toBe(true)
    const legacy = { ...pending, profile: null, state: 'LEGACY_TEXT_ONLY', document_access: { ...pending.document_access,
      can_upload: false, allowed_commands: [], approval_blocker: null } }
    expect(offeringDocumentSnapshotSchema.safeParse(legacy).success).toBe(true)
  })

  it('only transports the two immutable manager commands, not a scan or approval status setter', () => {
    const command = { command: 'seal_offering_document_manifest', key: actor, payload: { product_id: product,
      offering_revision_id: revision, expected_revision: 3, file_ids: ids, correspondence_statement: sealed.manifest.correspondence_statement } }
    expect(offeringDocumentCommandSchema.safeParse(command).success).toBe(true)
    for (const change of [{ file_ids: [ids[0], ids[0], ids[2]] }, { expected_revision: '3' }, { expected_revision: 0 },
      { correspondence_statement: 'short' }, { status: 'CLEAN' }, { bucket: 'public' }, { storage_path: 'arbitrary' }]) {
      expect(offeringDocumentCommandSchema.safeParse({ ...command, payload: { ...command.payload, ...change } }).success).toBe(false)
    }
    expect(offeringDocumentCommandSchema.safeParse({ ...command, command: 'mark_clean' }).success).toBe(false)
    const raw = { ...command, payload: { ...command.payload, correspondence_statement: `  ${command.payload.correspondence_statement}  ` } }
    expect(offeringDocumentCommandSchema.parse(raw)).toEqual(raw)
  })

  it('journals exact document commands separately by actor/context/product/revision and refuses overwrite or corrupted recovery', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    const scope = { actorId: actor, productId: product, revisionId: revision, context: context as { mode: 'ROLE'; organisationId: string; role: 'OfferingManager' } }
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: product,
      offering_revision_id: revision, expected_revision: 3, intent_id: ids[0], reason: 'An abandoned immutable intent is deliberately excluded.' } }
    saveOfferingDocumentRetry(storage, scope, command)
    expect(readOfferingDocumentRetry(storage, scope)).toEqual(command)
    expect(readOfferingDocumentRetry(storage, { ...scope, actorId: product })).toBeNull()
    expect(readOfferingDocumentRetry(storage, { ...scope, revisionId: product })).toBeNull()
    expect(() => saveOfferingDocumentRetry(storage, scope, { ...command, key: ids[1] })).toThrow('earlier document request')
    expect(() => clearOfferingDocumentRetry(storage, scope, { ...command, key: ids[1] })).toThrow('changed during reconciliation')
    clearOfferingDocumentRetry(storage, scope, command)
    expect(values.size).toBe(0)
    saveOfferingDocumentRetry(storage, scope, command)
    const key = [...values.keys()][0]
    values.set(key, '{bad')
    expect(() => readOfferingDocumentRetry(storage, scope)).toThrow('cannot be verified')
    expect(() => saveOfferingDocumentRetry(storage, scope, command)).toThrow()
    expect(values.get(key)).toBe('{bad')
  })

  it('binds a definite-rollback receipt to the complete attempted payload hash, key/command and exact actor/context/package', () => {
    const scope = { actorId: actor, productId: product, revisionId: revision, context: context as { mode: 'ROLE'; organisationId: string; role: 'OfferingManager' } }
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: product,
      offering_revision_id: revision, expected_revision: 3, intent_id: ids[0], reason: 'An abandoned immutable intent is deliberately excluded.' } }
    const fingerprint = sha256Hex(new TextEncoder().encode(offeringDocumentPayloadText(command)))
    const rollback = { outcome: 'DEFINITE_ROLLBACK', reason: 'STALE_PRODUCT_REVISION', effects: 'NONE', code: '23514',
      command: command.command, key: actor, actor_id: actor, product_id: product, revision_id: revision, expected_revision: 3,
      context, payload_sha256: fingerprint }
    expect(offeringDocumentRollbackMatches(rollback, scope, command, fingerprint)).toBe(true)
    for (const change of [{ outcome: 'UNKNOWN' }, { effects: 'COMMITTED' }, { code: '57014' }, { key: product }, { actor_id: product },
      { command: 'seal_offering_document_manifest' }, { product_id: actor }, { revision_id: product }, { expected_revision: 4 },
      { context: { ...context, organisationId: actor } }, { payload_sha256: 'b'.repeat(64) }, { status: 'CLEAN' }]) {
      expect(offeringDocumentRollbackMatches({ ...rollback, ...change }, scope, command, fingerprint)).toBe(false)
    }
  })

  it('requires current clean-manifest binding and the exact uploader path; no arbitrary bucket/URL', () => {
    const lookup = { id: ids[0], revision_id: revision, product_id: product, uploader_id: actor,
      storage_path: `${revision}/${actor}/${ids[0]}`, sha256: 'a'.repeat(64), size: 50, mime_type: 'application/pdf', validation_state: 'QUARANTINED',
      bucket: 'bx1-offering-documents', intent_state: 'PROMOTED_CLEAN', clean_receipt_id: ids[0], manifest_id: product, manifest_hash: 'b'.repeat(64) }
    expect(offeringFileLookupSchema.safeParse(lookup).success).toBe(true)
    for (const change of [{ bucket: 'public' }, { storage_path: `${revision}/${product}/${ids[0]}` }, { manifest_hash: null },
      { intent_state: 'PENDING' }, { clean_receipt_id: null }, { url: 'https://example.invalid/private.pdf' }]) {
      expect(offeringFileLookupSchema.safeParse({ ...lookup, ...change }).success).toBe(false)
    }
  })
})
