import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { documentReceiptDatabaseConfig, documentReceiptQuery } from './document-receipts'

export class OfferingFileReceiptError extends Error {
  constructor() { super('The trusted offering-file receipt is unavailable. The file remains quarantined.'); this.name = 'OfferingFileReceiptError' }
}

export function requireOfferingFileReceiptWriter(): void {
  try { documentReceiptDatabaseConfig() }
  catch { throw new OfferingFileReceiptError() }
}

/** Verified against Supabase Auth before any JWT claims are used for the restricted writer. */
export async function verifiedOfferingFileSession(client: SupabaseClient, actorId: string): Promise<{ id: string; aal: 'aal1' | 'aal2' }> {
  const { data, error } = await client.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) throw new OfferingFileReceiptError()
  const verified = await client.auth.getUser(token)
  if (verified.error || verified.data.user?.id !== actorId) throw new OfferingFileReceiptError()
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (claims.sub !== actorId || typeof claims.session_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)
      || (claims.aal !== 'aal1' && claims.aal !== 'aal2')) throw new Error()
    return { id: claims.session_id, aal: claims.aal }
  } catch { throw new OfferingFileReceiptError() }
}

/** The restricted role has no browser-exposed register RPC or raw table grants. */
export async function registerOfferingFile(input: {
  actorId: string; sessionId: string; aal: 'aal1' | 'aal2'; context: object;
  productId: string; revisionId: string; fileId: string; kind: string; title: string;
  sha256: string; size: number;
}): Promise<unknown> {
  try {
    return await documentReceiptQuery<unknown>(
      `select bx1_private.register_offering_file($1::uuid,$2::uuid,$3::text,$4::jsonb,
        $5::uuid,$6::uuid,$7::uuid,$8::text,$9::text,$10::text,$11::integer) as result`,
      [input.actorId, input.sessionId, input.aal, JSON.stringify(input.context),
        input.productId, input.revisionId, input.fileId, input.kind, input.title, input.sha256, input.size],
    )
  } catch { throw new OfferingFileReceiptError() }
}

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
