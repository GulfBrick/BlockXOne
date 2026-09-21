import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { evidenceSchema } from '@/lib/portal/contracts'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { portalOperatingContextSchema, portalScopeHref } from '@/lib/portal/operating-context'

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
    const body = await readPortalBody(request, maxFile + 16384)
    let form: FormData
    try { form = await new Response(Buffer.from(body), { headers: { 'Content-Type': contentType } }).formData() } catch { throw new PortalError('Invalid document upload.', 400) }
    if ([...form.keys()].some(k => !['file', 'kind', 'title'].includes(k)) || ['file', 'kind', 'title'].some(k => form.getAll(k).length !== 1)) throw new PortalError('Invalid document fields.', 400)
    const file = form.get('file')
    if (!file || typeof file === 'string' || !file.size || file.size > maxFile) throw new PortalError('Use a PDF, PNG or JPEG document up to 4 MiB.', 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = detectedType(bytes)
    if (!mime || mime !== file.type) throw new PortalError('The file contents do not match a supported PDF, PNG or JPEG document.', 400)
    const id = randomUUID()
    const document = evidenceSchema.safeParse({ id, kind: form.get('kind'), title: form.get('title'), storage_path: `${user.id}/${id}`, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime_type: mime })
    if (!document.success) throw new PortalError('Check the document type and title.', 400)
    const uploaded = await client.storage.from(bucket).upload(document.data.storage_path, bytes, { contentType: mime, cacheControl: '0', upsert: false, metadata: { sha256: document.data.sha256 } })
    if (uploaded.error) throw new PortalError('The private document could not be saved. Your application has not been submitted.', 503)
    return jar.finish(privateResponse(NextResponse.json({ document: document.data }, { status: 201 })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PortalError('Open this document from your portal.', 403)
    const params = request.nextUrl.searchParams
    const id = params.get('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id) || params.getAll('id').length !== 1 || [...params.keys()].some(k => !['id', 'download', 'mode', 'organisation', 'role'].includes(k)) || ['download','mode','organisation','role'].some(k => params.getAll(k).length > 1) || (params.has('download') && params.get('download') !== '1')) throw new PortalError('Invalid document reference.', 400)
    const context = portalOperatingContextSchema.safeParse(params.get('mode') === 'applicant' && !params.has('organisation') && !params.has('role') ? { mode: 'APPLICANT' } : !params.has('mode') ? { mode: 'ROLE', organisationId: params.get('organisation'), role: params.get('role') } : null)
    if (!context.success) throw new PortalError('Invalid operating context.', 403)
    const client = createRequestSupabaseClient(jar.adapter)
    const { snapshot } = await readPortal(client, context.data)
    const document = snapshot.applications.flatMap(application => application.details.documents).find(item => item.id === id)
    if (!document || !evidenceSchema.safeParse(document).success) throw new PortalError('Document unavailable for this session.', 404)
    if (!params.has('download')) return jar.finish(privateResponse(NextResponse.json({ url: portalScopeHref(`/api/portal/documents?id=${id}&download=1`, context.data) })))
    const downloaded = await client.storage.from(bucket).download(document.storage_path)
    if (downloaded.error || !downloaded.data || downloaded.data.size !== document.size || downloaded.data.size > maxFile) throw new PortalError('The saved document could not be verified.', 409)
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256 || detectedType(bytes) !== document.mime_type) throw new PortalError('Document integrity verification failed.', 409)
    const ext = document.mime_type === 'application/pdf' ? 'pdf' : document.mime_type === 'image/png' ? 'png' : 'jpg'
    return jar.finish(privateResponse(new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="bx1-evidence-${id}.${ext}"`, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' } })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
