import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { canonicalAppOrigin } from '@/lib/supabase/server'
import { offeringFileBucket, offeringCleanFileBucket, offeringFileKindSchema, offeringDocumentCommandSchema,
  offeringFileLookupSchema, offeringFileMaxBytes, offeringFilePath, offeringFileReceiptSchema,
  offeringFileReservationSchema } from '@/lib/portal/offering-files'
import { isPdfHeader, offeringFileId, sha256Hex, registerOfferingFile, reserveOfferingFile,
  requireOfferingFileReceiptWriter, verifiedOfferingFileSession, OfferingFileReceiptError,
  readOfferingDocuments, executeOfferingDocumentCommand, OfferingDocumentCommandRollback } from '@/lib/portal/offering-files-server'
import { acceptOfferingScannerMessage, downloadCleanOfferingDocument, OfferingDocumentProcessingError } from '@/lib/portal/offering-document-processing'

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
    // This is current, server-derived policy/manager authority, not a release
    // constant or a browser-selected document status.
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
    const documents = await readOfferingDocuments({ actorId: user.id, session: uploadSession, context, revisionId })
    if (documents.product_id !== productId || !documents.document_access.can_upload
      || documents.profile !== 'PDF_SIGNATURE_REQUIRED_V1') throw new PortalError(
      documents.state === 'NOT_ADMITTED' ? 'Offering PDF intake is not admitted. The configured document-processing owner must admit this offering scope.'
        : 'This manager cannot stage a PDF in the current revision. Resolve current intents or create a permitted same-terms correction revision.', 403)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!isPdfHeader(bytes)) throw new PortalError('The file contents are not a supported PDF.', 400)
    const sha256 = sha256Hex(bytes)
    const id = offeringFileId(revisionId, user.id, kindResult.data, sha256)
    const path = offeringFilePath(revisionId, user.id, id)
    const writerInput = { actorId: user.id, sessionId: uploadSession.id, aal: uploadSession.aal,
      attestation: uploadSession.attestation,
      context, productId, revisionId, fileId: id, kind: kindResult.data,
      title: title.trim(), sha256, size: bytes.length }
    const reserved = offeringFileReservationSchema.safeParse(await reserveOfferingFile(writerInput))
    if (!reserved.success || reserved.data.id !== id || reserved.data.path !== path
      || reserved.data.revision_id !== revisionId || reserved.data.sha256 !== sha256 || reserved.data.size !== bytes.length) {
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
    const currentDocuments = await readOfferingDocuments({ actorId: user.id, session: currentSession, context, revisionId })
    if (currentDocuments.product_id !== productId || !currentDocuments.document_access.can_upload) {
      throw new PortalError('Document authority changed during upload; the immutable intent remains quarantined for its manager to resolve.', 403)
    }
    const data = await registerOfferingFile({ ...writerInput, attestation: currentSession.attestation })
    const receipt = offeringFileReceiptSchema.safeParse(data)
    if (!receipt.success || receipt.data.id !== id || receipt.data.revision_id !== revisionId
      || receipt.data.sha256 !== sha256 || receipt.data.size !== bytes.length
      || receipt.data.kind !== kindResult.data || receipt.data.title !== title.trim()) {
      throw new PortalError('The quarantine receipt could not be verified.', 503)
    }
    return jar.finish(privateResponse(NextResponse.json({ document: receipt.data,
      next: 'The scanner must verify these exact quarantined bytes. Refresh processing state; this is not approval or signature evidence.' }, { status: 202 })))
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
    const session = await verifiedOfferingFileSession(client, user.id)
    const documents = await readOfferingDocuments({ actorId: user.id, session, context, revisionId })
    if (!params.has('download')) {
      return jar.finish(privateResponse(NextResponse.json(documents)))
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
        || result.data.product_id !== documents.product_id) {
        throw new PortalError('The offering-file receipt could not be verified.', 503)
      }
      if (result.data.bucket === offeringFileBucket && result.data.uploader_id !== user.id) {
        throw new PortalError('Quarantine is available only to its current authorised owner.', 404)
      }
      if (result.data.bucket === offeringCleanFileBucket && (!documents.document_access.can_read_clean
        || !documents.manifest
        || !snapshot.products.some(product => product.id === documents.product_id && product.offering_package?.id === revisionId)
        || documents.manifest?.id !== result.data.manifest_id || documents.manifest?.hash !== result.data.manifest_hash
        || !documents.manifest.file_ids.includes(id))) throw new PortalError('Current selected clean evidence is unavailable.', 404)
      return result.data
    }
    const file = await lookup()
    let bytes: Uint8Array
    if (file.bucket === offeringCleanFileBucket) bytes = await downloadCleanOfferingDocument({
      id: file.id, revision_id: file.revision_id, uploader_id: file.uploader_id, storage_path: file.storage_path,
      sha256: file.sha256, size: file.size, mime_type: file.mime_type,
    })
    else {
      const stored = await client.storage.from(offeringFileBucket).download(file.storage_path)
      if (stored.error || !stored.data || stored.data.size !== file.size) throw new PortalError('The saved offering file could not be verified.', 409)
      bytes = new Uint8Array(await stored.data.arrayBuffer())
    }
    if (bytes.length !== file.size || !isPdfHeader(bytes) || sha256Hex(bytes) !== file.sha256) {
      throw new PortalError('Offering-file integrity verification failed.', 409)
    }
    const second = await readPortal(client, context)
    if (second.user.id !== user.id || !second.snapshot.products.some(item => item.offering_package?.id === revisionId
      || item.offering_history?.some(revision => revision.id === revisionId))) {
      throw new PortalError('Authority changed before this download completed.', 403)
    }
    const afterSession = await verifiedOfferingFileSession(client, user.id)
    if (afterSession.id !== session.id || afterSession.aal !== session.aal) throw new PortalError('The signed-in session changed before byte release.', 403)
    const after = await readOfferingDocuments({ actorId: user.id, session: afterSession, context, revisionId })
    if (file.bucket === offeringCleanFileBucket && (!after.document_access.can_read_clean
      || !after.manifest
      || after.manifest?.id !== file.manifest_id || after.manifest?.hash !== file.manifest_hash
      || !after.manifest.file_ids.includes(id)
      || !second.snapshot.products.some(product => product.id === file.product_id && product.offering_package?.id === revisionId))) {
      throw new PortalError('Current reviewer or manifest authority changed before byte release.', 403)
    }
    if (JSON.stringify(await lookup()) !== JSON.stringify(file)) throw new PortalError('The offering-file receipt changed.', 409)
    return jar.finish(privateResponse(new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="bx1-${file.bucket === offeringCleanFileBucket ? 'clean' : 'unscanned'}-${id}.pdf"`,
      'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff',
    } })))
  } catch (error) { return jar.finish(portalFailure(error instanceof OfferingFileReceiptError
    ? new PortalError(error.message, 503) : error instanceof OfferingDocumentProcessingError ? new PortalError(error.message, error.status) : error)) }
}

const commandRequest = z.object({ expected_actor: z.string().uuid(), operating_context: portalOperatingContextSchema,
  request: offeringDocumentCommandSchema }).strict()

export async function PUT(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid document-action origin.', 403)
    if (request.headers.get('content-type') !== 'application/json') throw new PortalError('Invalid document action.', 415)
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPortalBody(request, 8192))) }
    catch (error) { if (error instanceof PortalError) throw error; throw new PortalError('Invalid document action.', 400) }
    const parsed = commandRequest.safeParse(raw)
    if (!parsed.success) throw new PortalError('Invalid document action fields.', 400)
    const { expected_actor: actorId, operating_context: context, request: command } = parsed.data
    const client = createRequestSupabaseClient(jar.adapter)
    const { user, snapshot } = await readPortal(client, context)
    const product = snapshot.products.find(item => item.id === command.payload.product_id)
    // Current authority/package is checked here. Revision freshness belongs to
    // the canonical writer, after its exact already-committed request branch;
    // otherwise a later review could strand an original-key retry.
    if (user.id !== actorId || !product
      || product.offering_package?.id !== command.payload.offering_revision_id) throw new PortalError('Refresh the exact current actor and package before retrying this action.', 403)
    const session = await verifiedOfferingFileSession(client, actorId)
    const input = { actorId, session, context, revisionId: command.payload.offering_revision_id }
    const current = await readOfferingDocuments(input)
    if (current.product_id !== product.id || !current.document_access.allowed_commands.includes(command.command)) {
      throw new PortalError('A current authorised manager must perform this document action.', 403)
    }
    const result = await executeOfferingDocumentCommand(input, command)
    return jar.finish(privateResponse(NextResponse.json(result)))
  } catch (error) {
    if (error instanceof OfferingDocumentCommandRollback) return jar.finish(privateResponse(NextResponse.json({ error: error.message,
      rollback: error.rollback }, { status: 409 })))
    return jar.finish(portalFailure(error instanceof OfferingFileReceiptError ? new PortalError(error.message, 503) : error))
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const origin = canonicalAppOrigin()
    if (request.nextUrl.origin !== origin || request.headers.get('host') !== new URL(origin).host
      || request.headers.has('origin') || request.nextUrl.search || request.headers.get('content-type') !== 'application/json') {
      throw new PortalError('Invalid offering scanner message.', 400)
    }
    const result = await acceptOfferingScannerMessage(await readPortalBody(request, 4096),
      request.headers.get('x-bx1-scanner-timestamp'), request.headers.get('x-bx1-scanner-signature'))
    return privateResponse(NextResponse.json(result))
  } catch (error) { return portalFailure(error instanceof OfferingDocumentProcessingError ? new PortalError(error.message, error.status) : error) }
}
