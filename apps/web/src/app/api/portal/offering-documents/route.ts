import { NextRequest, NextResponse } from 'next/server'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { offeringFileBucket, offeringFileIntakeEnabled, offeringFileKindSchema,
  offeringFileLookupSchema, offeringFileMaxBytes, offeringFilePath, offeringFileReceiptSchema,
  offeringFileListItemSchema } from '@/lib/portal/offering-files'
import { isPdfHeader, offeringFileId, sha256Hex, registerOfferingFile, reserveOfferingFile,
  requireOfferingFileReceiptWriter, verifiedOfferingFileSession, OfferingFileReceiptError } from '@/lib/portal/offering-files-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireContext(request: NextRequest, fromHeader: boolean) {
  let raw: unknown
  if (fromHeader) {
    try { raw = JSON.parse(request.headers.get('x-bx1-operating-context') ?? 'null') }
    catch { throw new PortalError('Select your operating context again.', 403) }
  } else {
    const params = request.nextUrl.searchParams
    raw = params.get('mode') === 'applicant' && !params.has('organisation') && !params.has('role')
      ? { mode: 'APPLICANT' }
      : !params.has('mode') ? { mode: 'ROLE', organisationId: params.get('organisation'), role: params.get('role') } : null
  }
  const parsed = portalOperatingContextSchema.safeParse(raw)
  if (!parsed.success) throw new PortalError('Select your operating context again.', 403)
  return parsed.data
}

export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (!offeringFileIntakeEnabled) {
      throw new PortalError('Offering PDF intake is unavailable until independent file verification is connected.', 503)
    }
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid upload origin.', 403)
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.startsWith('multipart/form-data;')) throw new PortalError('Select a PDF to upload.', 415)
    const context = requireContext(request, true)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!uuid.test(expectedActor)) throw new PortalError('Refresh your signed-in account before uploading.', 403)
    const client = createRequestSupabaseClient(jar.adapter)
    const { user, snapshot } = await readPortal(client, context)
    if (user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before uploading.', 403)
    // A missing restricted cloud writer fails before Storage can create an
    // orphan. Neither a browser RPC nor client-selected digest can register it.
    requireOfferingFileReceiptWriter()
    const uploadSession = await verifiedOfferingFileSession(client, user.id)
    const raw = await readPortalBody(request, offeringFileMaxBytes + 16384)
    let form: FormData
    try { form = await new Response(Buffer.from(raw), { headers: { 'Content-Type': contentType } }).formData() }
    catch { throw new PortalError('Invalid document upload.', 400) }
    const keys = ['file', 'kind', 'title', 'product_id', 'revision_id']
    if ([...form.keys()].some(key => !keys.includes(key)) || keys.some(key => form.getAll(key).length !== 1)) {
      throw new PortalError('Invalid offering-file fields.', 400)
    }
    const file = form.get('file'), kind = form.get('kind'), title = form.get('title')
    const productId = form.get('product_id'), revisionId = form.get('revision_id')
    const kindResult = offeringFileKindSchema.safeParse(kind)
    if (!file || typeof file === 'string' || !file.size || file.size > offeringFileMaxBytes
      || file.type !== 'application/pdf' || !kindResult.success || typeof title !== 'string'
      || title.trim().length < 1 || title.trim().length > 160
      || typeof productId !== 'string' || !uuid.test(productId)
      || typeof revisionId !== 'string' || !uuid.test(revisionId)) {
      throw new PortalError('Choose a labelled PDF up to 4 MiB for a submitted package.', 400)
    }
    const product = snapshot.products.find(item => item.id === productId)
    if (!product || product.status !== 'IN_REVIEW' || product.offering_package?.id !== revisionId
      || product.offering_package.origin !== 'SUBMITTED') {
      throw new PortalError('This submitted package is not available in your current scope.', 403)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!isPdfHeader(bytes)) throw new PortalError('The file contents are not a supported PDF.', 400)
    const sha256 = sha256Hex(bytes)
    const id = offeringFileId(revisionId, user.id, kindResult.data, sha256)
    const path = offeringFilePath(revisionId, user.id, id)
    const writerInput = { actorId: user.id, sessionId: uploadSession.id, aal: uploadSession.aal,
      context, productId, revisionId, fileId: id, kind: kindResult.data,
      title: title.trim(), sha256, size: bytes.length }
    const reserved = await reserveOfferingFile(writerInput)
    if (!reserved || typeof reserved !== 'object'
      || (reserved as Record<string, unknown>).id !== id
      || (reserved as Record<string, unknown>).path !== path
      || (reserved as Record<string, unknown>).revision_id !== revisionId
      || (reserved as Record<string, unknown>).sha256 !== sha256
      || (reserved as Record<string, unknown>).size !== bytes.length) {
      throw new PortalError('The private upload reservation could not be verified.', 503)
    }
    const uploaded = await client.storage.from(offeringFileBucket).upload(path, bytes, {
      contentType: 'application/pdf', cacheControl: '0', upsert: false, metadata: { sha256 },
    })
    const saved = await client.storage.from(offeringFileBucket).download(path)
    if (saved.error || !saved.data || saved.data.size !== bytes.length) {
      throw new PortalError('The quarantined bytes could not be verified. Do not use this file.', 503)
    }
    const savedBytes = new Uint8Array(await saved.data.arrayBuffer())
    if (!isPdfHeader(savedBytes) || sha256Hex(savedBytes) !== sha256) {
      throw new PortalError('The quarantined file differs from the upload.', 409)
    }
    if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
      throw new PortalError('The private file could not be staged.', 503)
    }
    const second = await readPortal(client, context)
    if (second.user.id !== user.id || second.snapshot.products.find(item => item.id === productId)?.offering_package?.id !== revisionId) {
      throw new PortalError('Authority changed during upload; the file remains quarantined.', 403)
    }
    const currentSession = await verifiedOfferingFileSession(client, user.id)
    if (currentSession.id !== uploadSession.id || currentSession.aal !== uploadSession.aal) {
      throw new PortalError('The signed-in session changed during upload; the file remains quarantined.', 403)
    }
    const data = await registerOfferingFile(writerInput)
    const receipt = offeringFileReceiptSchema.safeParse(data)
    if (!receipt.success || receipt.data.id !== id || receipt.data.revision_id !== revisionId
      || receipt.data.sha256 !== sha256 || receipt.data.size !== bytes.length
      || receipt.data.kind !== kindResult.data) {
      throw new PortalError('The quarantine receipt could not be verified.', 503)
    }
    return jar.finish(privateResponse(NextResponse.json({ document: receipt.data,
      next: 'This file is quarantined and unscanned. It is not part of an approved or signed offering package.' }, { status: 202 })))
  } catch (error) { return jar.finish(portalFailure(error instanceof OfferingFileReceiptError
    ? new PortalError(error.message, 503) : error)) }
}

export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PortalError('Open this file from your portal.', 403)
    const params = request.nextUrl.searchParams
    const keys = ['revision_id', 'id', 'download', 'mode', 'organisation', 'role']
    if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1)
      || !uuid.test(params.get('revision_id') ?? '')
      || (params.has('download') && params.get('download') !== '1')
      || (params.has('id') && (!uuid.test(params.get('id') ?? '') || !params.has('download')))
      || (params.has('download') && !params.has('id'))) throw new PortalError('Invalid offering-file reference.', 400)
    const context = requireContext(request, false)
    const revisionId = params.get('revision_id')!
    const client = createRequestSupabaseClient(jar.adapter)
    const { user, snapshot } = await readPortal(client, context)
    if (!snapshot.products.some(item => item.offering_package?.id === revisionId
      || item.offering_history?.some(revision => revision.id === revisionId))) {
      throw new PortalError('Offering files are unavailable in this scope.', 404)
    }
    if (!params.has('download')) {
      const { data, error } = await client.rpc('bx1_offering_file_list', {
        operating_context: context, target_revision: revisionId,
      }).abortSignal(AbortSignal.timeout(12000))
      if (error?.code === '42501') throw new PortalError('Offering files are unavailable in this scope.', 404)
      if (error || !Array.isArray(data)) throw new PortalError('The offering-file list is temporarily unavailable.', 503)
      const records = offeringFileListItemSchema.array().safeParse(data)
      if (!records.success || records.data.some(item => item.revision_id !== revisionId)) {
        throw new PortalError('The offering-file list could not be verified.', 503)
      }
      return jar.finish(privateResponse(NextResponse.json({ documents: records.data,
        notice: 'Uploaded PDFs are quarantined and unscanned; they are not approved or signed disclosures.' })))
    }
    const id = params.get('id')!
    const lookup = async () => {
      const { data, error } = await client.rpc('bx1_offering_file_lookup', {
        operating_context: context, target_revision: revisionId, file_id: id,
      }).abortSignal(AbortSignal.timeout(12000))
      if (error?.code === '42501' || error?.code === 'P0002') throw new PortalError('Offering file unavailable for this session.', 404)
      if (error) throw new PortalError('The offering file is temporarily unavailable.', 503)
      const result = offeringFileLookupSchema.safeParse(data)
      if (!result.success || result.data.id !== id || result.data.revision_id !== revisionId
        || result.data.storage_path !== offeringFilePath(revisionId, user.id, id)) {
        throw new PortalError('The offering-file receipt could not be verified.', 503)
      }
      return result.data
    }
    const file = await lookup()
    const stored = await client.storage.from(offeringFileBucket).download(file.storage_path)
    if (stored.error || !stored.data || stored.data.size !== file.size) {
      throw new PortalError('The saved offering file could not be verified.', 409)
    }
    const bytes = new Uint8Array(await stored.data.arrayBuffer())
    if (!isPdfHeader(bytes) || sha256Hex(bytes) !== file.sha256) {
      throw new PortalError('Offering-file integrity verification failed.', 409)
    }
    const second = await readPortal(client, context)
    if (second.user.id !== user.id || !second.snapshot.products.some(item => item.offering_package?.id === revisionId
      || item.offering_history?.some(revision => revision.id === revisionId))) {
      throw new PortalError('Authority changed before this download completed.', 403)
    }
    if (JSON.stringify(await lookup()) !== JSON.stringify(file)) throw new PortalError('The offering-file receipt changed.', 409)
    return jar.finish(privateResponse(new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="bx1-unscanned-${id}.pdf"`,
      'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff',
    } })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
