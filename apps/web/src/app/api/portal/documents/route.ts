import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { applicationDocumentLookupSchema, applicationDocumentVersionsSchema, evidenceSchema } from '@/lib/portal/contracts'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { portalOperatingContextSchema, portalScopeHref } from '@/lib/portal/operating-context'
import { documentReceiptDatabaseConfig, documentReceiptId, registerDocumentReceipt } from '@/lib/portal/document-receipts'
import { acceptScannerMessage, documentScannerConfig, DocumentLifecycleError, quarantineDocument } from '@/lib/portal/document-lifecycle'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
const bucket = 'bx1-portal-documents'
const maxFile = 4_194_304
function detectedType(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-') return 'application/pdf'
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  return null
}
async function receiptPolicy(client: ReturnType<typeof createRequestSupabaseClient>): Promise<boolean> {
  const { data, error } = await client.rpc('bx1_document_receipts_required').abortSignal(AbortSignal.timeout(8000))
  // During the reviewed database-first rollout, the old synthetic-only schema
  // may not have this RPC yet. All other failures are fail-closed.
  if (error?.code === 'PGRST202') return false
  if (error || typeof data !== 'boolean') throw new PortalError('Private evidence policy is temporarily unavailable.', 503)
  return data
}
async function lifecycleMode(client: ReturnType<typeof createRequestSupabaseClient>): Promise<'SYNTHETIC_TEST_ONLY' | 'SCANNER_REQUIRED'> {
  const { data, error } = await client.rpc('bx1_document_lifecycle_mode').abortSignal(AbortSignal.timeout(8000))
  // Migration-first rollout must not change the existing TEST synthetic path.
  if (error?.code === 'PGRST202') return 'SYNTHETIC_TEST_ONLY'
  if (error || (data !== 'SYNTHETIC_TEST_ONLY' && data !== 'SCANNER_REQUIRED')) {
    throw new PortalError('Private document lifecycle policy is unavailable.', 503)
  }
  return data
}
async function currentSessionId(client: ReturnType<typeof createRequestSupabaseClient>, actorId: string): Promise<string> {
  const { data, error } = await client.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) throw new PortalError('Sign in again before uploading private evidence.', 401)
  const verified = await client.auth.getUser(token)
  if (verified.error || verified.data.user?.id !== actorId) throw new PortalError('The signed-in account changed.', 403)
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (claims.sub !== actorId || typeof claims.session_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)) throw new Error()
    return claims.session_id
  } catch { throw new PortalError('The signed-in session is unavailable.', 403) }
}
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid upload origin.', 403)
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.startsWith('multipart/form-data;')) throw new PortalError('Select a document to upload.', 415)
    let rawContext: unknown
    try { rawContext = JSON.parse(request.headers.get('x-bx1-operating-context') ?? 'null') } catch { throw new PortalError('Invalid operating context.', 403) }
    const context = portalOperatingContextSchema.safeParse(rawContext)
    if (!context.success) throw new PortalError('Select your operating context again.', 403)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before uploading.', 403)
    const client = createRequestSupabaseClient(jar.adapter)
    const { user } = await readPortal(client, context.data)
    if (user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before uploading.', 403)
    const strictReceipts = await receiptPolicy(client)
    const mode = await lifecycleMode(client)
    if (mode === 'SCANNER_REQUIRED' && !strictReceipts) throw new PortalError('Private document receipts are not enforced.', 503)
    // Check the server-only database credential before an irreversible Storage
    // upload. A missing credential never creates an unreceipted strict upload.
    if (strictReceipts) documentReceiptDatabaseConfig()
    if (mode === 'SCANNER_REQUIRED') documentScannerConfig()
    const body = await readPortalBody(request, maxFile + 16384)
    let form: FormData
    try { form = await new Response(Buffer.from(body), { headers: { 'Content-Type': contentType } }).formData() } catch { throw new PortalError('Invalid document upload.', 400) }
    if ([...form.keys()].some(k => !['file', 'kind', 'title'].includes(k)) || ['file', 'kind', 'title'].some(k => form.getAll(k).length !== 1)) throw new PortalError('Invalid document fields.', 400)
    const file = form.get('file')
    if (!file || typeof file === 'string' || !file.size || file.size > maxFile) throw new PortalError('Use a PDF, PNG or JPEG document up to 4 MiB.', 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = detectedType(bytes)
    if (!mime || mime !== file.type) throw new PortalError('The file contents do not match a supported PDF, PNG or JPEG document.', 400)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const kind = form.get('kind'), title = form.get('title')
    const id = strictReceipts && typeof kind === 'string' && typeof title === 'string'
      ? documentReceiptId(user.id, kind, title, sha256) : randomUUID()
    const document = evidenceSchema.safeParse({ id, kind, title, storage_path: `${user.id}/${id}`, sha256, size: bytes.length, mime_type: mime })
    if (!document.success) throw new PortalError('Check the document type and title.', 400)
    const uploadSessionId = strictReceipts ? await currentSessionId(client, user.id) : null
    if (mode === 'SCANNER_REQUIRED') {
      await quarantineDocument(user.id, uploadSessionId!, document.data, bytes)
      if (await currentSessionId(client, user.id) !== uploadSessionId) {
        throw new PortalError('The signed-in session changed while uploading.', 403)
      }
      return jar.finish(privateResponse(NextResponse.json({ document: document.data,
        validation_state: 'QUARANTINED', next: 'Await an independently verified scanner result before submitting this evidence.' },
      { status: 202 })))
    }
    const uploaded = await client.storage.from(bucket).upload(document.data.storage_path, bytes, { contentType: mime, cacheControl: '0', upsert: false, metadata: { sha256: document.data.sha256 } })
    if (!strictReceipts && uploaded.error) throw new PortalError('The private document could not be saved. Your application has not been submitted.', 503)
    if (strictReceipts) {
      // A retry may encounter the same immutable path. Accept it only if the
      // stored object is byte-for-byte the file in this authenticated request.
      const saved = await client.storage.from(bucket).download(document.data.storage_path)
      if (saved.error || !saved.data || saved.data.size !== bytes.length) throw new PortalError('The saved evidence bytes could not be verified. Do not submit this document.', 503)
      const storedBytes = new Uint8Array(await saved.data.arrayBuffer())
      if (detectedType(storedBytes) !== mime || !Buffer.from(storedBytes).equals(Buffer.from(bytes)))
        throw new PortalError('The saved evidence bytes differ from this upload. Do not submit this document.', 409)
      const sessionId = await currentSessionId(client, user.id)
      if (sessionId !== uploadSessionId) throw new PortalError('The signed-in session changed while uploading.', 403)
      await registerDocumentReceipt(user.id, sessionId, document.data)
    }
    return jar.finish(privateResponse(NextResponse.json({ document: document.data, validation_state: strictReceipts ? 'SYNTHETIC_UNSCANNED' : 'LEGACY_UNVERIFIED' }, { status: uploaded.error ? 200 : 201 })))
  } catch (error) { return jar.finish(portalFailure(error instanceof DocumentLifecycleError
    ? new PortalError(error.message, error.status) : error)) }
}

// Scanner adapters post a raw-body HMAC. This endpoint is not a browser action,
// and never accepts a client-selected role or an unsigned clean verdict.
export async function PATCH(request: NextRequest) {
  try {
    if (request.nextUrl.search || request.headers.get('content-type') !== 'application/json') {
      throw new PortalError('Invalid scanner message.', 400)
    }
    const body = await readPortalBody(request, 4096)
    const result = await acceptScannerMessage(body,
      request.headers.get('x-bx1-scanner-timestamp'), request.headers.get('x-bx1-scanner-signature'))
    return privateResponse(NextResponse.json(result))
  } catch (error) { return portalFailure(error instanceof DocumentLifecycleError
    ? new PortalError(error.message, error.status) : error) }
}
export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PortalError('Open this document from your portal.', 403)
    const params = request.nextUrl.searchParams
    if (params.has('queue')) {
      if (params.get('queue') !== '1' || [...params.keys()].length !== 1) {
        throw new PortalError('Invalid document reference.', 400)
      }
      const client = createRequestSupabaseClient(jar.adapter)
      await readPortal(client, { mode: 'APPLICANT' })
      const { data, error } = await client.rpc('bx1_document_scan_queue').abortSignal(AbortSignal.timeout(8000))
      if (error || !Array.isArray(data) || data.some(item => !item || typeof item.id !== 'string'
        || typeof item.title !== 'string' || !['QUARANTINED','SCANNED_CLEAN','REJECTED'].includes(item.state))) {
        throw new PortalError('Document scan queue is temporarily unavailable.', 503)
      }
      return jar.finish(privateResponse(NextResponse.json({ documents: data })))
    }
    if (params.has('status')) {
      const statusId = params.get('status') ?? ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(statusId)
        || [...params.keys()].length !== 1) throw new PortalError('Invalid document reference.', 400)
      const client = createRequestSupabaseClient(jar.adapter)
      await readPortal(client, { mode: 'APPLICANT' })
      const { data, error } = await client.rpc('bx1_document_scan_status', { document_id: statusId })
        .abortSignal(AbortSignal.timeout(8000))
      if (error?.code === '42501' || error?.code === 'P0002') throw new PortalError('Document unavailable for this session.', 404)
      if (error || !data || data.id !== statusId || !['QUARANTINED','SCANNED_CLEAN','REJECTED'].includes(data.state)) {
        throw new PortalError('Document scan status is temporarily unavailable.', 503)
      }
      if (data.state === 'SCANNED_CLEAN' && !evidenceSchema.safeParse(data.document).success) {
        throw new PortalError('Scanned document receipt could not be verified.', 503)
      }
      return jar.finish(privateResponse(NextResponse.json(data)))
    }
    const id = params.get('id') ?? '', applicationId = params.get('application_id') ?? ''
    const revisionText = params.get('revision') ?? ''
    const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    const keys = ['id', 'application_id', 'revision', 'history', 'download', 'mode', 'organisation', 'role']
    if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1)
      || (params.has('download') && params.get('download') !== '1')
      || (params.has('history') && params.get('history') !== '1')) throw new PortalError('Invalid document reference.', 400)
    const history = validId(applicationId) && params.has('history') && !params.has('revision') && !params.has('id') && !params.has('download')
    const historicalDocument = validId(applicationId) && validId(id) && !params.has('history') && /^[1-9][0-9]{0,8}$/.test(revisionText)
    const currentDocument = validId(id) && !params.has('application_id') && !params.has('revision') && !params.has('history')
    if (!history && !historicalDocument && !currentDocument) throw new PortalError('Invalid document reference.', 400)
    const context = portalOperatingContextSchema.safeParse(params.get('mode') === 'applicant' && !params.has('organisation') && !params.has('role') ? { mode: 'APPLICANT' } : !params.has('mode') ? { mode: 'ROLE', organisationId: params.get('organisation'), role: params.get('role') } : null)
    if (!context.success) throw new PortalError('Invalid operating context.', 403)
    const client = createRequestSupabaseClient(jar.adapter)
    const { snapshot } = await readPortal(client, context.data)
    const visibleApplication = history || historicalDocument ? snapshot.applications.find(application => application.id === applicationId) : undefined
    if ((history || historicalDocument) && !visibleApplication) throw new PortalError('Document unavailable for this session.', 404)
    if (history) {
      const { data, error } = await client.rpc('bx1_application_document_versions', { application_id: applicationId, operating_context: context.data }).abortSignal(AbortSignal.timeout(12000))
      if (error?.code === '42501' || error?.code === 'P0002') throw new PortalError('Document unavailable for this session.', 404)
      if (error) throw new PortalError('Document history is temporarily unavailable.', 503)
      const versions = applicationDocumentVersionsSchema.safeParse(data)
      if (!versions.success || versions.data.application_id !== applicationId) throw new PortalError('Document history could not be verified.', 503)
      return jar.finish(privateResponse(NextResponse.json(versions.data)))
    }
    const revision = historicalDocument ? Number(revisionText) : undefined
    let document: { id: string; storage_path: string; sha256: string; size: number; mime_type: string } | undefined
    if (historicalDocument) {
      const { data, error } = await client.rpc('bx1_application_document_lookup', { application_id: applicationId, revision, document_id: id, operating_context: context.data }).abortSignal(AbortSignal.timeout(12000))
      if (error?.code === '42501' || error?.code === 'P0002') throw new PortalError('Document unavailable for this session.', 404)
      if (error) throw new PortalError('The saved document is temporarily unavailable.', 503)
      const lookup = applicationDocumentLookupSchema.safeParse(data)
      if (!lookup.success || lookup.data.application_id !== applicationId || lookup.data.revision !== revision || lookup.data.id !== id) throw new PortalError('Document lookup could not be verified.', 503)
      document = { id, storage_path: lookup.data.storage_path, sha256: lookup.data.claimed_sha256, size: lookup.data.size, mime_type: lookup.data.mime_type }
    } else {
      const current = snapshot.applications.flatMap(application => application.details.documents ?? []).find(item => item.id === id)
      const checked = evidenceSchema.safeParse(current)
      if (checked.success) document = checked.data
    }
    if (!document
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(document.storage_path)
      || !document.storage_path.endsWith(`/${document.id}`)
      || (historicalDocument && document.storage_path.split('/')[0] !== visibleApplication?.user_id)) throw new PortalError('Document unavailable for this session.', 404)
    if (!params.has('download')) {
      const target = historicalDocument ? `/api/portal/documents?application_id=${applicationId}&revision=${revision}&id=${id}&download=1` : `/api/portal/documents?id=${id}&download=1`
      return jar.finish(privateResponse(NextResponse.json({ url: portalScopeHref(target, context.data) })))
    }
    const downloaded = await client.storage.from(bucket).download(document.storage_path)
    if (downloaded.error || !downloaded.data || downloaded.data.size !== document.size || downloaded.data.size > maxFile) throw new PortalError('The saved document could not be verified.', 409)
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256 || detectedType(bytes) !== document.mime_type) throw new PortalError('Document integrity verification failed.', 409)
    const ext = document.mime_type === 'application/pdf' ? 'pdf' : document.mime_type === 'image/png' ? 'png' : 'jpg'
    return jar.finish(privateResponse(new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="bx1-evidence-${id}.${ext}"`, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' } })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
