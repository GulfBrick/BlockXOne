import 'server-only'
import { createHash } from 'node:crypto'

export function offeringFileId(revisionId: string, actorId: string, kind: string, sha256: string): string {
  const digest = createHash('sha256').update(['bx1-offering-file-v1', revisionId, actorId, kind, sha256].join('\u0000')).digest('hex').slice(0, 32)
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`
}

/** A signature check only. Quarantine is never a malware verdict. */
export function isPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-'
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
