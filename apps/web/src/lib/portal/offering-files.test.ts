import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { offeringFilePath, offeringFileReceiptSchema } from './offering-files'

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
