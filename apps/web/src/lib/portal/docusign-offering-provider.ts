import 'server-only'
import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { platformRelease } from '@/lib/platform-release'

/** TEST supplier transport only. Durable leases, dedupe and business authority live in SQL. */
export const DOCUSIGN_OFFERING_SANDBOX = Object.freeze({
  clientId: '25539c30-05f8-4b48-b1e1-bb1eaf205c46',
  userId: '8bc0b05e-2184-46cf-b1bb-025982a34ac1',
  accountId: '4af4aa20-5739-4d0e-bde2-d8e83f9cce67',
  baseUri: 'https://demo.docusign.net',
  mode: 'sandbox' as const,
})
export const DOCUSIGN_OFFERING_LIMITS = Object.freeze({
  json: 1_048_576, create: 18_000_000, pdf: 4_194_304, cover: 262_144,
  timeoutMs: 15_000, pollMs: 900_000, lookupMs: 7 * 24 * 60 * 60 * 1000,
})
const uuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value))
const signerSchema = z.object({ accountId: uuid, personId: uuid, name: text(100), email: z.string().email().max(100), clientUserId: uuid }).strict()
export type OfferingSigner = z.infer<typeof signerSchema>
export type DocusignOfferingConfig = typeof DOCUSIGN_OFFERING_SANDBOX & { privateKey: string }
export type DocusignOfferingErrorCode = 'NOT_CONFIGURED' | 'INVALID_INPUT' | 'AUTHENTICATION_UNAVAILABLE'
  | 'ACCOUNT_MISMATCH' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID' | 'CREATE_UNKNOWN'
  | 'LOOKUP_EXPIRED' | 'LOOKUP_AMBIGUOUS' | 'POLL_NOT_DUE' | 'THROTTLED' | 'EVIDENCE_TOO_LARGE'
export class DocusignOfferingError extends Error {
  constructor(public readonly code: DocusignOfferingErrorCode, public readonly retryAt: number | null = null) {
    super(`Offering signature provider: ${code}.`)
    this.name = 'DocusignOfferingError'
  }
}
function fail(code: DocusignOfferingErrorCode): never { throw new DocusignOfferingError(code) }
export const offeringSignatureSha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function validateConfig(config: DocusignOfferingConfig): DocusignOfferingConfig {
  for (const key of ['clientId', 'userId', 'accountId', 'baseUri', 'mode'] as const)
    if (config[key] !== DOCUSIGN_OFFERING_SANDBOX[key]) fail('NOT_CONFIGURED')
  if (!config.privateKey || config.privateKey.length > 16_384
    || !/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/.test(config.privateKey)
    || !/-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(config.privateKey)) fail('NOT_CONFIGURED')
  return config
}
/** Existing six names only. No mode aliases, secret discovery or MAIN fallback. */
export function docusignOfferingConfig(env: Record<string, string | undefined> = process.env): DocusignOfferingConfig {
  if (platformRelease(env)?.environment !== 'TESTNET') fail('NOT_CONFIGURED')
  return validateConfig({
    clientId: env.BLOCKXONE_DOCUSIGN_CLIENT_ID,
    userId: env.BLOCKXONE_DOCUSIGN_USER_ID,
    accountId: env.BLOCKXONE_DOCUSIGN_ACCOUNT_ID,
    baseUri: env.BLOCKXONE_DOCUSIGN_BASE_URI,
    mode: env.BLOCKXONE_DOCUSIGN_MODE,
    privateKey: env.BLOCKXONE_DOCUSIGN_PRIVATE_KEY,
  } as DocusignOfferingConfig)
}

const bindingSchema = z.object({ operationId: uuid, productId: uuid, revisionId: uuid, manifestId: uuid,
  manifestSha256: hash, authorisationId: uuid, issuerReference: uuid, termsSha256: hash, textSha256: hash,
  commonSha256: hash, configurationSha256: hash, signer: signerSchema,
  declarationRevision: z.number().int().positive(), declarationSha256: hash,
  appointmentId: uuid, appointmentReceiptId: uuid, actingOrganisationId: uuid, managerOrganisationId: uuid,
  validFrom: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }),
  sourceReference: text(1000).refine(value => value.length >= 20), sourceSha256: hash,
}).strict().refine(value => Date.parse(value.validUntil) > Date.parse(value.validFrom))
export type OfferingCoverBinding = z.infer<typeof bindingSchema>
export type OfferingOriginalDocument = { documentId: '1' | '2' | '3'; bytes: Uint8Array; sha256: string }
export type OfferingEnvelopeInput = OfferingCoverBinding & { documents: OfferingOriginalDocument[] }
export type OfferingEnvelopeExpectation = OfferingCoverBinding & {
  accountId: string; recipientId: '1'; customFields: Record<string, string>;
  documents: { documentId: string; name: string; sha256: string; size: number }[];
  createRequestSha256: string;
}
export type PreparedOfferingEnvelope = { body: string; sha256: string; expected: OfferingEnvelopeExpectation; cover: Uint8Array }

function checkPdf(bytes: Uint8Array, maximum: number) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > maximum) fail('EVIDENCE_TOO_LARGE')
  if (!Buffer.from(bytes.subarray(0, 8)).toString('ascii').startsWith('%PDF-')
    || !/%%EOF\s*$/.test(Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString('ascii'))) fail('PROVIDER_RESPONSE_INVALID')
}
/** Deterministic, ASCII-only cover: identifiers/hashes, never unescaped caller text or names. */
export function generateOfferingExecutionCover(binding: OfferingCoverBinding,
  documents: Pick<OfferingOriginalDocument, 'documentId' | 'sha256'>[]): Uint8Array {
  const parsed = bindingSchema.safeParse(binding)
  if (!parsed.success || documents.length !== 3) fail('INVALID_INPUT')
  const lines = [
    'BlockXOne - SYNTHETIC TEST issuer package execution',
    'Purpose: ISSUER_PACKAGE_EXECUTION. Not live issuer admission.',
    'Signing this cover commits to the retained originals identified below.',
    `Operation: ${binding.operationId}`, `Product: ${binding.productId}`, `Revision: ${binding.revisionId}`,
    `Manifest: ${binding.manifestId}`, `Manifest SHA256: ${binding.manifestSha256}`,
    `Issuer declaration: ${binding.issuerReference}`, `Purpose authority: ${binding.authorisationId}`,
    `Declaration revision: ${binding.declarationRevision}`, `Declaration SHA256: ${binding.declarationSha256}`,
    `Appointment: ${binding.appointmentId}`, `Appointment receipt: ${binding.appointmentReceiptId}`,
    `Acting organisation: ${binding.actingOrganisationId}`, `Manager organisation: ${binding.managerOrganisationId}`,
    `Authority valid from: ${binding.validFrom}`, `Authority valid until: ${binding.validUntil}`,
    `Source reference SHA256: ${offeringSignatureSha256(binding.sourceReference)}`, `Source evidence SHA256: ${binding.sourceSha256}`,
    `Signer account: ${binding.signer.accountId}`, `Signer person: ${binding.signer.personId}`,
    `Terms SHA256: ${binding.termsSha256}`, `Text SHA256: ${binding.textSha256}`,
    `Common SHA256: ${binding.commonSha256}`, `Configuration SHA256: ${binding.configurationSha256}`,
    ...documents.map((document, index) => {
      if (document.documentId !== String(index + 1) || !hash.safeParse(document.sha256).success) fail('INVALID_INPUT')
      return `Original ${document.documentId} SHA256: ${document.sha256}`
    }),
    'Original documents remain separately retained and unchanged.',
    'This signature does not approve, publish, fund or issue the product.',
  ]
  const stream = `BT /F1 8 Tf 36 756 Td 14 TL\n${lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n')}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'ascii')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(Buffer.from(pdf, 'ascii'))
  checkPdf(bytes, DOCUSIGN_OFFERING_LIMITS.cover)
  return bytes
}

export function buildOfferingEnvelope(input: OfferingEnvelopeInput): PreparedOfferingEnvelope {
  const { documents, ...candidate } = input
  const parsed = bindingSchema.safeParse(candidate)
  if (!parsed.success || !Array.isArray(documents) || documents.length !== 3) fail('INVALID_INPUT')
  const binding = parsed.data
  documents.forEach((document, index) => {
    if (document.documentId !== String(index + 1) || !hash.safeParse(document.sha256).success) fail('INVALID_INPUT')
    checkPdf(document.bytes, DOCUSIGN_OFFERING_LIMITS.pdf)
    if (offeringSignatureSha256(document.bytes) !== document.sha256) fail('INVALID_INPUT')
  })
  const cover = generateOfferingExecutionCover(binding, documents)
  const all = [...documents.map(document => ({ ...document, name: `original-${document.documentId}.pdf` })),
    { documentId: '4', name: 'execution-cover.pdf', bytes: cover, sha256: offeringSignatureSha256(cover) }]
  const customFields = { bx1_operation: binding.operationId, bx1_product: binding.productId, bx1_revision: binding.revisionId,
    bx1_manifest: binding.manifestId, bx1_manifest_sha256: binding.manifestSha256, bx1_authorisation: binding.authorisationId,
    bx1_issuer: binding.issuerReference, bx1_purpose: 'ISSUER_PACKAGE_EXECUTION', bx1_cover_sha256: offeringSignatureSha256(cover) }
  const body = JSON.stringify({ transactionId: binding.operationId, status: 'sent', emailSubject: 'BlockXOne synthetic issuer package execution',
    recipientsLock: 'true', allowReassign: 'false', allowMarkup: 'false', enableWetSign: 'false',
    documents: all.map(document => ({ documentId: document.documentId, name: document.name, fileExtension: 'pdf',
      documentBase64: Buffer.from(document.bytes).toString('base64') })),
    customFields: { textCustomFields: Object.entries(customFields).map(([name, value]) => ({ name, value, show: 'false', required: 'true' })) },
    recipients: { signers: [{ recipientId: '1', routingOrder: '1', name: binding.signer.name, email: binding.signer.email,
      clientUserId: binding.signer.clientUserId, tabs: { signHereTabs: [{ documentId: '4', pageNumber: '1',
        xPosition: '72', yPosition: '650', tabLabel: 'bx1_issuer_execution', optional: 'false' }] } }] },
  })
  if (Buffer.byteLength(body, 'utf8') > DOCUSIGN_OFFERING_LIMITS.create) fail('INVALID_INPUT')
  const sha256 = offeringSignatureSha256(body)
  return { body, sha256, cover, expected: { ...binding, accountId: DOCUSIGN_OFFERING_SANDBOX.accountId, recipientId: '1',
    customFields, documents: all.map(document => ({ documentId: document.documentId, name: document.name,
      sha256: document.sha256, size: document.bytes.length })), createRequestSha256: sha256 } }
}

export type FrozenOfferingBinding = Omit<OfferingCoverBinding, 'signer'> & {
  signer: Pick<OfferingSigner, 'accountId' | 'personId' | 'clientUserId'>;
  documents: Pick<OfferingOriginalDocument, 'documentId' | 'sha256'>[];
}

/** Recovery reads labels ONLY from the committed transport bytes, never mutable profile data.
 * The independent immutable purpose/manifest bindings must still come from the leased worker.
 * Rebuilding here checks exact bytes; it is not permission to submit CREATE a second time.
 */
export function offeringEnvelopeExpectationFromFrozenRequest(body: string, sha256: string,
  binding: FrozenOfferingBinding): OfferingEnvelopeExpectation {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > DOCUSIGN_OFFERING_LIMITS.create
    || !hash.safeParse(sha256).success || offeringSignatureSha256(body) !== sha256
    || !Array.isArray(binding.documents) || binding.documents.length !== 3) fail('INVALID_INPUT')
  let candidate: unknown
  try { candidate = JSON.parse(body) } catch { fail('INVALID_INPUT') }
  const frozen = z.object({
    documents: z.array(z.object({ documentId: z.string(), documentBase64: z.string() })).length(4),
    recipients: z.object({ signers: z.array(z.object({ name: text(100), email: z.string().email().max(100),
      clientUserId: uuid, recipientId: z.literal('1') })).length(1) }),
  }).safeParse(candidate)
  if (!frozen.success || frozen.data.recipients.signers[0].clientUserId !== binding.signer.clientUserId) fail('INVALID_INPUT')
  const { documents: immutableDocuments, signer: immutableSigner, ...immutablePurpose } = binding
  const documents = frozen.data.documents.slice(0, 3).map((document, index): OfferingOriginalDocument => {
    const immutable = immutableDocuments[index]
    if (document.documentId !== String(index + 1) || immutable.documentId !== document.documentId
      || !hash.safeParse(immutable.sha256).success
      || document.documentBase64.length > 4 * Math.ceil(DOCUSIGN_OFFERING_LIMITS.pdf / 3)) fail('INVALID_INPUT')
    const bytes = Buffer.from(document.documentBase64, 'base64')
    if (bytes.toString('base64') !== document.documentBase64 || offeringSignatureSha256(bytes) !== immutable.sha256) fail('INVALID_INPUT')
    return { documentId: immutable.documentId, sha256: immutable.sha256, bytes: new Uint8Array(bytes) }
  })
  const frozenSigner = frozen.data.recipients.signers[0]
  const rebuilt = buildOfferingEnvelope({ ...immutablePurpose, documents,
    signer: { ...immutableSigner, name: frozenSigner.name, email: frozenSigner.email } })
  // Covers flags, recipient identity, doc4 bytes/hash, tabs, fields, order and all purpose bindings.
  if (rebuilt.body !== body || rebuilt.sha256 !== sha256) fail('INVALID_INPUT')
  return rebuilt.expected
}

export type OfferingProviderBinding = { envelopeId: string; operationId: string }
export type OfferingProviderResource = 'envelope' | 'recipients' | 'documents' | 'custom_fields' | 'audit_events' | 'tabs'
export type OfferingProviderRead = { value: Record<string, unknown>; observedAt: number; nextAllowedAt: number; sha256: string }
const objectSchema = z.record(z.unknown())

async function boundedBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) fail('EVIDENCE_TOO_LARGE')
  if (!response.body) fail('PROVIDER_RESPONSE_INVALID')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      if (signal.aborted) fail('PROVIDER_UNAVAILABLE')
      const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(new DocusignOfferingError('PROVIDER_UNAVAILABLE'))
        signal.addEventListener('abort', abort, { once: true })
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
      if (chunk.done) break
      size += chunk.value.length
      if (size > maximum) fail('EVIDENCE_TOO_LARGE')
      chunks.push(chunk.value)
    }
    if (length !== null && Number(length) !== size) fail('PROVIDER_RESPONSE_INVALID')
    return new Uint8Array(Buffer.concat(chunks, size))
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** A fresh instance never substitutes for permanent SQL dedupe or persisted polling reservations. */
export function createDocusignOfferingProvider(config: DocusignOfferingConfig,
  dependencies: { fetch?: typeof globalThis.fetch; now?: () => number } = {}) {
  validateConfig(config)
  const fetcher = dependencies.fetch ?? globalThis.fetch, now = dependencies.now ?? Date.now
  const base = `${config.baseUri}/restapi/v2.1/accounts/${config.accountId}`
  let credential: { token: string; expiresAt: number } | undefined
  const localPolls = new Map<string, number>()
  const createsAttempted = new Set<string>()

  async function request(url: string, method: string, body?: string, token?: string, pdf = false) {
    const signal = AbortSignal.timeout(DOCUSIGN_OFFERING_LIMITS.timeoutMs)
    try {
      const response = await fetcher(url, { method, body, redirect: 'error', cache: 'no-store', signal,
        headers: { Accept: pdf ? 'application/pdf' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': url.endsWith('/oauth/token') ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) } })
      if (response.redirected || response.url && response.url !== url) fail('PROVIDER_RESPONSE_INVALID')
      if (response.status === 429) {
        const retry = response.headers.get('retry-after'), reset = response.headers.get('x-ratelimit-reset')
        const retryTime = retry && /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN
        const resetTime = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : NaN
        throw new DocusignOfferingError('THROTTLED', Math.max(now() + DOCUSIGN_OFFERING_LIMITS.pollMs,
          Number.isFinite(retryTime) ? retryTime : 0, Number.isFinite(resetTime) ? resetTime : 0))
      }
      if (!response.ok) fail('PROVIDER_UNAVAILABLE')
      const media = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (media !== (pdf ? 'application/pdf' : 'application/json')) fail('PROVIDER_RESPONSE_INVALID')
      const bytes = await boundedBytes(response, pdf ? DOCUSIGN_OFFERING_LIMITS.pdf : DOCUSIGN_OFFERING_LIMITS.json, signal)
      if (pdf) { checkPdf(bytes, DOCUSIGN_OFFERING_LIMITS.pdf); return { bytes, value: {} as Record<string, unknown> } }
      const parsed = objectSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (!parsed.success) fail('PROVIDER_RESPONSE_INVALID')
      return { bytes, value: parsed.data }
    } catch (error) {
      if (error instanceof DocusignOfferingError) throw error
      // Never return provider body, request data, SDK exceptions, URLs or credentials.
      fail('PROVIDER_UNAVAILABLE')
    }
  }
  async function authenticate() {
    if (credential && credential.expiresAt > now() + 60_000) return
    credential = undefined
    let assertion: string
    try { assertion = jwt.sign({ iss: config.clientId, sub: config.userId, aud: 'account-d.docusign.com',
      iat: Math.floor(now() / 1000), exp: Math.floor(now() / 1000) + 3600, scope: 'signature impersonation' },
    config.privateKey, { algorithm: 'RS256' }) } catch { fail('AUTHENTICATION_UNAVAILABLE') }
    const { value } = await request('https://account-d.docusign.com/oauth/token', 'POST',
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString())
    const auth = z.object({ access_token: z.string().min(1).max(8192), token_type: z.literal('Bearer'),
      expires_in: z.number().int().positive().max(3600) }).safeParse(value)
    if (!auth.success) fail('AUTHENTICATION_UNAVAILABLE')
    const user = await request('https://account-d.docusign.com/oauth/userinfo', 'GET', undefined, auth.data.access_token)
    const info = z.object({ sub: uuid, accounts: z.array(z.object({ account_id: uuid, base_uri: z.string() })).max(100) }).safeParse(user.value)
    if (!info.success || info.data.sub !== config.userId) fail('ACCOUNT_MISMATCH')
    const accounts = info.data.accounts.filter(account => account.account_id === config.accountId)
    if (accounts.length !== 1 || accounts[0].base_uri !== config.baseUri) fail('ACCOUNT_MISMATCH')
    credential = { token: auth.data.access_token, expiresAt: now() + auth.data.expires_in * 1000 }
  }
  async function authorised(url: string, method: string, body?: string, pdf = false) {
    await authenticate()
    return request(url, method, body, credential!.token, pdf)
  }
  function checkedBinding(binding: OfferingProviderBinding) {
    if (!uuid.safeParse(binding.envelopeId).success || !uuid.safeParse(binding.operationId).success) fail('INVALID_INPUT')
    return `${base}/envelopes/${binding.envelopeId}`
  }
  function reservePoll(resource: string, nextAllowedAt: number) {
    if (!Number.isFinite(nextAllowedAt) || nextAllowedAt < 0) fail('INVALID_INPUT')
    const due = Math.max(nextAllowedAt, localPolls.get(resource) ?? 0)
    if (now() < due) throw new DocusignOfferingError('POLL_NOT_DUE', due)
    // Reserve BEFORE I/O; a timeout is not permission to poll again immediately.
    localPolls.set(resource, now() + DOCUSIGN_OFFERING_LIMITS.pollMs)
  }
  return {
    authenticate,
    async createEnvelope(prepared: PreparedOfferingEnvelope) {
      if (!hash.safeParse(prepared.sha256).success || prepared.sha256 !== offeringSignatureSha256(prepared.body)
        || prepared.expected.createRequestSha256 !== prepared.sha256 || prepared.expected.accountId !== config.accountId
        || Buffer.byteLength(prepared.body) > DOCUSIGN_OFFERING_LIMITS.create) fail('INVALID_INPUT')
      let requestIdentity: unknown
      try { requestIdentity = JSON.parse(prepared.body) } catch { fail('INVALID_INPUT') }
      const identity = z.object({ transactionId: uuid, status: z.literal('sent') }).safeParse(requestIdentity)
      if (!identity.success || identity.data.transactionId !== prepared.expected.operationId) fail('INVALID_INPUT')
      if (createsAttempted.has(prepared.expected.operationId)) fail('CREATE_UNKNOWN')
      // Caller must have committed CREATE_INFLIGHT; no automatic retry under any outcome.
      await authenticate()
      createsAttempted.add(prepared.expected.operationId)
      try {
        const { value, bytes } = await request(`${base}/envelopes`, 'POST', prepared.body, credential!.token)
        const created = z.object({ envelopeId: uuid, status: z.literal('sent') }).safeParse(value)
        if (!created.success) fail('CREATE_UNKNOWN')
        return { ...created.data, requestSha256: prepared.sha256, responseSha256: offeringSignatureSha256(bytes) }
      } catch (error) {
        throw new DocusignOfferingError('CREATE_UNKNOWN', error instanceof DocusignOfferingError ? error.retryAt : null)
      }
    },
    async lookupEnvelope(operationId: string, firstAttemptAt: number, nextAllowedAt: number) {
      if (!uuid.safeParse(operationId).success || !Number.isFinite(firstAttemptAt) || firstAttemptAt > now()) fail('INVALID_INPUT')
      if (now() - firstAttemptAt >= DOCUSIGN_OFFERING_LIMITS.lookupMs) fail('LOOKUP_EXPIRED')
      const path = `${base}/envelopes/status?transaction_ids=${operationId}`
      reservePoll(path, nextAllowedAt)
      const { value, bytes } = await authorised(path, 'PUT', '{}')
      const result = z.object({ envelopes: z.array(z.object({ envelopeId: uuid, status: text(40), transactionId: uuid.optional() })).max(2) }).safeParse(value)
      if (!result.success || result.data.envelopes.length > 1) fail('LOOKUP_AMBIGUOUS')
      const envelope = result.data.envelopes[0]
      if (envelope?.transactionId && envelope.transactionId !== operationId) fail('LOOKUP_AMBIGUOUS')
      return { envelope: envelope ?? null, observedAt: now(), nextAllowedAt: localPolls.get(path)!,
        responseSha256: offeringSignatureSha256(bytes) }
    },
    async readEnvelopeResource(binding: OfferingProviderBinding, resource: OfferingProviderResource, nextAllowedAt: number): Promise<OfferingProviderRead> {
      const paths: Record<OfferingProviderResource, string> = { envelope: '', recipients: '/recipients', documents: '/documents',
        custom_fields: '/custom_fields', audit_events: '/audit_events?locale=en', tabs: '/recipients/1/tabs' }
      if (!Object.prototype.hasOwnProperty.call(paths, resource)) fail('INVALID_INPUT')
      const path = checkedBinding(binding) + paths[resource]
      reservePoll(path, nextAllowedAt)
      const result = await authorised(path, 'GET')
      return { value: result.value, observedAt: now(), nextAllowedAt: localPolls.get(path)!, sha256: offeringSignatureSha256(result.bytes) }
    },
    async downloadArtifact(binding: OfferingProviderBinding, documentId: '1' | '2' | '3' | '4' | 'certificate', nextAllowedAt: number) {
      if (!['1', '2', '3', '4', 'certificate'].includes(documentId)) fail('INVALID_INPUT')
      const path = `${checkedBinding(binding)}/documents/${documentId}`
      reservePoll(path, nextAllowedAt)
      const { bytes } = await authorised(path, 'GET', undefined, true)
      return { bytes, documentId, sha256: offeringSignatureSha256(bytes), size: bytes.length,
        mimeType: 'application/pdf' as const, observedAt: now(), nextAllowedAt: localPolls.get(path)! }
    },
    async createSigningView(binding: OfferingProviderBinding, signer: OfferingSigner) {
      const parsed = signerSchema.safeParse(signer)
      if (!parsed.success) fail('INVALID_INPUT')
      const { value } = await authorised(`${checkedBinding(binding)}/views/recipient`, 'POST', JSON.stringify({
        recipientId: '1', clientUserId: signer.clientUserId, userName: signer.name, email: signer.email,
        authenticationMethod: 'Password', returnUrl: 'https://testnet.bx1.co.za/portal',
      }))
      if (typeof value.url !== 'string' || value.url.length > 4096) fail('PROVIDER_RESPONSE_INVALID')
      let url: URL
      try { url = new URL(value.url) } catch { fail('PROVIDER_RESPONSE_INVALID') }
      if (url.protocol !== 'https:' || url.hostname !== 'demo.docusign.net' || !url.pathname.startsWith('/Signing/')
        || url.port || url.username || url.password || url.hash) fail('PROVIDER_RESPONSE_INVALID')
      // Only the originating actor response may receive url. Persist metadata ONLY.
      return { url: url.href, urlSha256: offeringSignatureSha256(url.href), expiresAt: now() + 300_000 }
    },
    async voidEnvelope(binding: OfferingProviderBinding) {
      await authorised(checkedBinding(binding), 'PUT', JSON.stringify({ status: 'voided', voidedReason: 'BlockXOne execution authority is no longer current.' }))
      // The mutation response is not a fresh authenticated voided-status observation.
      return { outcome: 'VOID_REQUEST_ACCEPTED' as const, requiresReconciliation: true as const }
    },
  }
}

export type OfferingCompletionSnapshot = Record<OfferingProviderResource, Record<string, unknown>>
export type OfferingIntegrityAssessment = { integrity: 'CURRENT_CANDIDATE' | 'UNRESOLVED' | 'NON_CURRENT'; reason: string }
const unresolved = (reason: string): OfferingIntegrityAssessment => ({ integrity: 'UNRESOLVED', reason })
const noncurrent = (reason: string): OfferingIntegrityAssessment => ({ integrity: 'NON_CURRENT', reason })

/** Only authenticated resource reads may be supplied. Still NOT artifact retention or business admission. */
export function assessOfferingCompletion(expected: OfferingEnvelopeExpectation, binding: OfferingProviderBinding,
  snapshot: OfferingCompletionSnapshot): OfferingIntegrityAssessment {
  if (expected.accountId !== DOCUSIGN_OFFERING_SANDBOX.accountId || expected.operationId !== binding.operationId) return noncurrent('BINDING_MISMATCH')
  const envelope = z.object({ envelopeId: uuid, status: text(40), transactionId: uuid.optional(),
    sentDateTime: z.string().datetime({ offset: true }), completedDateTime: z.string().datetime({ offset: true }).optional() }).safeParse(snapshot.envelope)
  if (!envelope.success) return unresolved('ENVELOPE_INVALID')
  if (envelope.data.envelopeId !== binding.envelopeId || envelope.data.transactionId && envelope.data.transactionId !== binding.operationId) return noncurrent('ENVELOPE_MISMATCH')
  if (['declined', 'voided'].includes(envelope.data.status)) return noncurrent(envelope.data.status.toUpperCase())
  if (envelope.data.status !== 'completed' || !envelope.data.completedDateTime) return unresolved('NOT_COMPLETED')
  const recipients = z.object({ signers: z.array(z.object({ recipientId: z.string(), clientUserId: z.string(), name: z.string(),
    email: z.string(), status: z.string(), signedDateTime: z.string().datetime({ offset: true }) })).length(1) }).passthrough().safeParse(snapshot.recipients)
  if (!recipients.success) return unresolved('RECIPIENTS_INVALID')
  if (Object.entries(recipients.data).some(([key, value]) => key !== 'signers' && Array.isArray(value) && value.length)) return noncurrent('EXTRA_RECIPIENT')
  const signer = recipients.data.signers[0]
  const exactName = signer.name === expected.signer.name
  // Only the exact frozen verified-email fallback may acquire a display name.
  // It remains a candidate until the embedded audit and signed-tab proof below.
  const adoptedPlaceholderName = expected.signer.name === expected.signer.email && text(100).safeParse(signer.name).success
  if (signer.recipientId !== '1' || signer.clientUserId !== expected.signer.clientUserId || (!exactName && !adoptedPlaceholderName)
    || signer.email !== expected.signer.email || signer.status !== 'completed') return noncurrent('RECIPIENT_MISMATCH')
  const docs = z.object({ envelopeId: uuid.optional(), envelopeDocuments: z.array(z.object({ documentId: z.string(), name: z.string(), type: z.string().optional() })).max(5) }).safeParse(snapshot.documents)
  if (!docs.success || docs.data.envelopeId && docs.data.envelopeId !== binding.envelopeId) return unresolved('DOCUMENTS_INVALID')
  const content = docs.data.envelopeDocuments.filter(document => document.documentId !== 'certificate')
  if (content.length !== 4 || new Set(content.map(document => document.documentId)).size !== 4
    || expected.documents.some(document => !content.some(actual => actual.documentId === document.documentId && actual.name === document.name))) return noncurrent('DOCUMENT_INVENTORY_CHANGED')
  const fields = z.object({ textCustomFields: z.array(z.object({ name: z.string(), value: z.string() })).max(100) }).safeParse(snapshot.custom_fields)
  if (!fields.success) return unresolved('CUSTOM_FIELDS_INVALID')
  for (const [name, value] of Object.entries(expected.customFields)) {
    const matching = fields.data.textCustomFields.filter(field => field.name === name)
    if (matching.length !== 1 || matching[0].value !== value) return noncurrent('CUSTOM_FIELDS_CHANGED')
  }
  const tabs = z.object({ signHereTabs: z.array(z.object({ documentId: z.string(), pageNumber: z.string(), xPosition: z.string(),
    yPosition: z.string(), tabLabel: z.string(), optional: z.string().optional() }).passthrough()).length(1) }).passthrough().safeParse(snapshot.tabs)
  if (!tabs.success) return unresolved('TABS_INVALID')
  const tab = tabs.data.signHereTabs[0]
  if (tab.documentId !== '4' || tab.pageNumber !== '1' || tab.xPosition !== '72' || tab.yPosition !== '650'
    || tab.tabLabel !== 'bx1_issuer_execution' || tab.optional !== 'false'
    || Object.entries(tabs.data).some(([key, value]) => key !== 'signHereTabs' && Array.isArray(value) && value.length)) return noncurrent('TABS_CHANGED')
  const audit = z.object({ auditEvents: z.array(z.object({ eventFields: z.array(z.object({ name: z.string(), value: z.string() })).max(100) })).min(1).max(1000) }).safeParse(snapshot.audit_events)
  if (!audit.success) return unresolved('AUDIT_MISSING')
  const benign = new Set(['Created', 'Sent', 'Delivered', 'Viewed', 'Signed', 'Completed', 'Printable Copy Delivered', 'Archive Delivered'])
  const embedded = new Set(['Registered', 'Opened', 'Viewed In-Session', 'Signed'])
  const delivery = new Set(['Printable Copy Delivered', 'Archive Delivered'])
  const actions = new Set<string>()
  const progression: { action: string; at: number; timestamp: string; states: string[] }[] = []
  const sent = Date.parse(envelope.data.sentDateTime), completed = Date.parse(envelope.data.completedDateTime)
  if (completed < sent || Date.parse(signer.signedDateTime) < sent || Date.parse(signer.signedDateTime) > completed) return unresolved('TIMELINE_INVALID')
  for (const event of audit.data.auditEvents) {
    const names = event.eventFields.filter(field => field.name === 'Action'), times = event.eventFields.filter(field => field.name === 'logTime')
    if (names.length !== 1 || times.length !== 1 || !Number.isFinite(Date.parse(times[0].value))) return unresolved('AUDIT_INVALID')
    const action = names[0].value
    if (/correct|reassign|replace|change|void|declin/i.test(action)) return noncurrent('PROVIDER_INTEGRITY_CHANGED')
    if (!benign.has(action) && !embedded.has(action)) return unresolved('AUDIT_UNKNOWN_ACTION')
    actions.add(action)
    progression.push({ action, at: Date.parse(times[0].value), timestamp: times[0].value,
      states: event.eventFields.filter(field => field.name === 'EnvelopeStatus').map(field => field.value) })
  }
  if (progression.every(event => benign.has(event.action))) {
    // Preserve the legacy audit vocabulary and its original acceptance rules.
    if (!['Sent', 'Signed', 'Completed'].every(action => actions.has(action))) return unresolved('AUDIT_INCOMPLETE')
    if (!exactName) return noncurrent('RECIPIENT_MISMATCH')
  } else {
    // The observed embedded ceremony has no invented Sent/Completed audit rows.
    // Do not mix its vocabulary with another partially recognised event flow.
    if (progression.some(event => !embedded.has(event.action) && !delivery.has(event.action))) return unresolved('AUDIT_UNKNOWN_ACTION')
    if (progression.filter(event => event.action === 'Registered').length !== 1
      || progression.filter(event => event.action === 'Signed').length !== 1) return unresolved('AUDIT_INCOMPLETE')
    if (tab.status !== 'signed' || tab.recipientId !== '1' || tab.stampType !== 'signature' || tab.tabType !== 'signhere') return noncurrent('TABS_CHANGED')
    let stage = 0, previous = Number.NEGATIVE_INFINITY
    for (const event of progression) {
      const isDelivery = delivery.has(event.action)
      if (!z.string().datetime({ offset: true }).safeParse(event.timestamp).success
        || event.at < previous || (!isDelivery && event.at > completed) || event.states.length !== 1) return unresolved('AUDIT_INVALID')
      previous = event.at
      if (isDelivery) {
        if (stage !== 4 || event.states[0] !== 'completed' || event.at < completed) return unresolved('AUDIT_INCOMPLETE')
        continue
      }
      if (event.action === 'Registered') {
        if (stage !== 0 || event.states[0] !== 'created') return unresolved('AUDIT_INCOMPLETE')
        stage = 1
      } else if (event.action === 'Opened') {
        if (stage < 1 || stage >= 4 || event.at < sent || !['sent', 'delivered'].includes(event.states[0])) return unresolved('AUDIT_INCOMPLETE')
        stage = Math.max(stage, 2)
      } else if (event.action === 'Viewed In-Session') {
        if (stage < 2 || stage >= 4 || event.at < sent || event.states[0] !== 'delivered') return unresolved('AUDIT_INCOMPLETE')
        stage = 3
      } else {
        if (stage !== 3 || event.states[0] !== 'completed') return unresolved('AUDIT_INCOMPLETE')
        if (event.at !== Date.parse(signer.signedDateTime)) return unresolved('TIMELINE_INVALID')
        stage = 4
      }
    }
    if (stage !== 4) return unresolved('AUDIT_INCOMPLETE')
  }
  return { integrity: 'CURRENT_CANDIDATE', reason: 'AUTHENTICATED_COMPLETION_REQUIRES_RETAINED_ARTIFACTS_AND_CURRENT_AUTHORITY' }
}
