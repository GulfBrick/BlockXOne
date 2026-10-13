import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const signing = vi.hoisted(() => ({ sign: vi.fn(() => 'synthetic-jwt-assertion') }))
vi.mock('jsonwebtoken', () => ({ default: { sign: signing.sign } }))
import { DOCUSIGN_OFFERING_LIMITS, DOCUSIGN_OFFERING_SANDBOX, assessOfferingCompletion,
  buildOfferingEnvelope, createDocusignOfferingProvider, docusignOfferingConfig, offeringSignatureSha256,
  offeringEnvelopeExpectationFromFrozenRequest,
  type FrozenOfferingBinding, type OfferingCompletionSnapshot, type OfferingEnvelopeInput } from './docusign-offering-provider'

// Entirely synthetic. No provider authentication, real identity, network or signing proof.
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
const clock = Date.parse('2026-10-13T12:00:00Z')
const config = { ...DOCUSIGN_OFFERING_SANDBOX, privateKey: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_ONLY\n-----END PRIVATE KEY-----' }
const bytes = new Uint8Array(Buffer.from('%PDF-1.4\nSYNTHETIC FIXTURE ONLY\n%%EOF\n'))
const input = (): OfferingEnvelopeInput => ({ operationId: id(1), productId: id(2), revisionId: id(3), manifestId: id(4),
  manifestSha256: 'a'.repeat(64), authorisationId: id(5), issuerReference: id(6), termsSha256: 'b'.repeat(64),
  textSha256: 'c'.repeat(64), commonSha256: 'd'.repeat(64), configurationSha256: 'e'.repeat(64),
  declarationRevision: 1, declarationSha256: 'f'.repeat(64), appointmentId: id(11), appointmentReceiptId: id(12),
  actingOrganisationId: id(13), managerOrganisationId: id(14), validFrom: '2026-10-13T00:00:00Z',
  validUntil: '2026-10-14T00:00:00Z', sourceReference: 'Synthetic approval source only', sourceSha256: '1'.repeat(64),
  signer: { accountId: id(7), personId: id(8), name: 'Synthetic Signer', email: 'synthetic@example.invalid', clientUserId: id(9) },
  documents: (['1', '2', '3'] as const).map(documentId => ({ documentId, bytes, sha256: offeringSignatureSha256(bytes) })),
})
const binding = { envelopeId: id(10), operationId: id(1) }
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json', ...headers } })
function providerFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/oauth/token')) return json({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 })
    if (String(url).endsWith('/oauth/userinfo')) return json({ sub: config.userId, accounts: [{ account_id: config.accountId, base_uri: config.baseUri }] })
    return handler(String(url), init)
  })
}
function snapshot(): OfferingCompletionSnapshot {
  const expected = buildOfferingEnvelope(input()).expected
  return {
    envelope: { envelopeId: binding.envelopeId, transactionId: binding.operationId, status: 'completed',
      sentDateTime: '2026-10-13T10:00:00Z', completedDateTime: '2026-10-13T10:05:00Z' },
    recipients: { signers: [{ ...input().signer, recipientId: '1', status: 'completed', signedDateTime: '2026-10-13T10:04:00Z' }] },
    documents: { envelopeId: binding.envelopeId, envelopeDocuments: expected.documents.map(document => ({ documentId: document.documentId, name: document.name })) },
    custom_fields: { textCustomFields: Object.entries(expected.customFields).map(([name, value]) => ({ name, value })) },
    tabs: { signHereTabs: [{ documentId: '4', pageNumber: '1', xPosition: '72', yPosition: '650', tabLabel: 'bx1_issuer_execution', optional: 'false' }] },
    audit_events: { auditEvents: ['Sent', 'Signed', 'Completed'].map(Action => ({ eventFields: [
      { name: 'Action', value: Action }, { name: 'logTime', value: '2026-10-13T10:05:00Z' },
    ] })) },
  }
}
beforeEach(() => { signing.sign.mockClear() })

function frozenBinding(): FrozenOfferingBinding {
  const { signer, documents, ...purpose } = input()
  return { ...purpose, signer: { accountId: signer.accountId, personId: signer.personId, clientUserId: signer.clientUserId },
    documents: documents.map(({ documentId, sha256 }) => ({ documentId, sha256 })) }
}

describe('DocuSign offering adapter: synthetic transport contract', () => {
  it('uses only exact existing configuration and rejects MAIN, wrong IDs and mode aliases', () => {
    const env = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
      SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za',
      BLOCKXONE_DOCUSIGN_CLIENT_ID: config.clientId, BLOCKXONE_DOCUSIGN_USER_ID: config.userId,
      BLOCKXONE_DOCUSIGN_ACCOUNT_ID: config.accountId, BLOCKXONE_DOCUSIGN_BASE_URI: config.baseUri,
      BLOCKXONE_DOCUSIGN_MODE: 'sandbox', BLOCKXONE_DOCUSIGN_PRIVATE_KEY: config.privateKey }
    expect(docusignOfferingConfig(env)).toEqual(config)
    for (const changed of [{ VERCEL_ENV: 'production' }, { BLOCKXONE_DOCUSIGN_MODE: 'developer-sandbox' },
      { BLOCKXONE_DOCUSIGN_ACCOUNT_ID: id(99) }, { BLOCKXONE_DOCUSIGN_BASE_URI: 'https://na1.docusign.net' },
      { BLOCKXONE_DOCUSIGN_PRIVATE_KEY: '' }]) expect(() => docusignOfferingConfig({ ...env, ...changed })).toThrow('NOT_CONFIGURED')
  })

  it('builds deterministic four-document input and a separate immutable cover, preserving original bytes', () => {
    const original = input(), before = original.documents.map(document => Buffer.from(document.bytes).toString('hex'))
    const prepared = buildOfferingEnvelope(original), repeat = buildOfferingEnvelope(input())
    expect(prepared.body).toBe(repeat.body)
    expect(prepared.sha256).toBe(offeringSignatureSha256(prepared.body))
    const request = JSON.parse(prepared.body)
    expect(request).toMatchObject({ transactionId: original.operationId, recipientsLock: 'true',
      allowReassign: 'false', allowMarkup: 'false', enableWetSign: 'false', status: 'sent' })
    expect(request.documents.map((document: { documentId: string }) => document.documentId)).toEqual(['1', '2', '3', '4'])
    expect(prepared.expected.documents).toHaveLength(4)
    expect(Buffer.from(prepared.cover).toString()).toContain('ISSUER_PACKAGE_EXECUTION')
    expect(Buffer.from(prepared.cover).toString()).toContain(original.signer.personId)
    expect(Buffer.from(prepared.cover).toString()).toContain(original.documents[0].sha256)
    expect(Buffer.from(prepared.cover).toString()).toContain(original.appointmentReceiptId)
    expect(Buffer.from(prepared.cover).toString()).toContain(original.declarationSha256)
    expect(Buffer.from(prepared.cover).toString()).toContain(offeringSignatureSha256(original.sourceReference))
    expect(prepared.cover.length).toBeLessThanOrEqual(DOCUSIGN_OFFERING_LIMITS.cover)
    expect(request.customFields.textCustomFields.every((field: { value: string }) => field.value.length <= 100)).toBe(true)
    expect(request.recipients.signers[0].tabs.signHereTabs[0]).toMatchObject({ documentId: '4', optional: 'false' })
    expect(original.documents.map(document => Buffer.from(document.bytes).toString('hex'))).toEqual(before)
  })

  it('rejects changed hashes, reordered/missing documents and invalid cover/signing identities before HTTP', () => {
    const original = input()
    expect(() => buildOfferingEnvelope({ ...original, documents: original.documents.slice(1) })).toThrow('INVALID_INPUT')
    expect(() => buildOfferingEnvelope({ ...original, documents: [...original.documents].reverse() })).toThrow('INVALID_INPUT')
    expect(() => buildOfferingEnvelope({ ...original, documents: original.documents.map(document => ({ ...document, sha256: 'f'.repeat(64) })) })).toThrow('INVALID_INPUT')
    expect(() => buildOfferingEnvelope({ ...original, signer: { ...original.signer, clientUserId: 'x'.repeat(101) } })).toThrow('INVALID_INPUT')
    expect(() => buildOfferingEnvelope({ ...original, issuerReference: '(forged PDF content)' })).toThrow('INVALID_INPUT')
    expect(() => buildOfferingEnvelope({ ...original, validUntil: original.validFrom })).toThrow('INVALID_INPUT')
  })

  it('binds exact purpose evidence, including the full source reference, without printing arbitrary text', () => {
    const original = input(), reference = `${'x'.repeat(997)}(x)`
    const prepared = buildOfferingEnvelope({ ...original, sourceReference: reference })
    expect(Buffer.from(prepared.cover).toString()).toContain(offeringSignatureSha256(reference))
    expect(Buffer.from(prepared.cover).toString()).not.toContain(reference)
    expect(prepared.sha256).not.toBe(buildOfferingEnvelope(original).sha256)
    expect(buildOfferingEnvelope({ ...original, appointmentReceiptId: id(99) }).sha256).not.toBe(buildOfferingEnvelope(original).sha256)
    expect(() => buildOfferingEnvelope({ ...original, sourceReference: 'x'.repeat(1001) })).toThrow('INVALID_INPUT')
  })

  it('recovers expectation from exact frozen request labels and immutable bindings without mutable labels', () => {
    const original = input()
    original.signer = { ...original.signer, name: 'Original Frozen Name', email: 'frozen@example.invalid' }
    const prepared = buildOfferingEnvelope(original)
    const expected = offeringEnvelopeExpectationFromFrozenRequest(prepared.body, prepared.sha256, frozenBinding())
    expect(expected).toEqual(prepared.expected)
    expect(expected.signer.name).toBe('Original Frozen Name')
    expect(expected.signer.email).toBe('frozen@example.invalid')
    expect(signing.sign).not.toHaveBeenCalled()
  })

  it.each(['digest', 'authority', 'person', 'client-user', 'source', 'original', 'cover', 'flags', 'extra-field', 'serialization'] as const)(
    'rejects %s changes while recovering a frozen request', change => {
      const prepared = buildOfferingEnvelope(input()), immutable = frozenBinding()
      let body = prepared.body, digest = prepared.sha256
      if (change === 'digest') digest = '0'.repeat(64)
      if (change === 'authority') immutable.authorisationId = id(99)
      if (change === 'person') immutable.signer.personId = id(99)
      if (change === 'client-user') immutable.signer.clientUserId = id(99)
      if (change === 'source') immutable.sourceReference = 'Different immutable source reference'
      if (change === 'original') immutable.documents[0].sha256 = '0'.repeat(64)
      if (['cover', 'flags', 'extra-field', 'serialization'].includes(change)) {
        const request = JSON.parse(body)
        if (change === 'cover') request.documents[3].documentBase64 = Buffer.from(bytes).toString('base64')
        if (change === 'flags') request.allowReassign = 'true'
        if (change === 'extra-field') request.unexpected = 'must not be accepted'
        body = JSON.stringify(request, null, change === 'serialization' ? 2 : undefined)
        digest = offeringSignatureSha256(body)
      }
      expect(() => offeringEnvelopeExpectationFromFrozenRequest(body, digest, immutable)).toThrow('INVALID_INPUT')
    })

  it('authenticates the exact user/account with bounded JWT and never exposes the token', async () => {
    const fetcher = providerFetch(() => json({ envelopeId: binding.envelopeId, status: 'sent' }))
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    expect(await provider.authenticate()).toBeUndefined()
    expect(signing.sign).toHaveBeenCalledWith(expect.objectContaining({ iss: config.clientId, sub: config.userId,
      aud: 'account-d.docusign.com', scope: 'signature impersonation', iat: clock / 1000, exp: clock / 1000 + 3600 }),
    config.privateKey, { algorithm: 'RS256' })
    const result = await provider.createEnvelope(buildOfferingEnvelope(input()))
    expect(result).toMatchObject({ envelopeId: binding.envelopeId, status: 'sent' })
    expect(result.responseSha256).toBe(offeringSignatureSha256(JSON.stringify({ envelopeId: binding.envelopeId, status: 'sent' })))
    expect(JSON.stringify(result)).not.toContain('synthetic-access-token')
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' })
  })

  it.each(['subject', 'account', 'host', 'duplicate'] as const)('rejects %s userinfo mismatch without creating an envelope', async kind => {
    const accounts = [{ account_id: kind === 'account' ? id(20) : config.accountId,
      base_uri: kind === 'host' ? 'https://evil.example.invalid' : config.baseUri }]
    if (kind === 'duplicate') accounts.push({ ...accounts[0] })
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/oauth/token')
      ? json({ access_token: 'synthetic', token_type: 'Bearer', expires_in: 3600 })
      : json({ sub: kind === 'subject' ? id(21) : config.userId, accounts }))
    await expect(createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
      .createEnvelope(buildOfferingEnvelope(input()))).rejects.toThrow('ACCOUNT_MISMATCH')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('marks a lost creation outcome unknown and never automatically resends, even on an explicit instance retry', async () => {
    const fetcher = providerFetch(() => { throw new Error('secret provider internals and bearer token') })
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    const prepared = buildOfferingEnvelope(input())
    await expect(provider.createEnvelope(prepared)).rejects.toThrow('CREATE_UNKNOWN')
    await expect(provider.createEnvelope(prepared)).rejects.toThrow('CREATE_UNKNOWN')
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/envelopes'))).toHaveLength(1)
  })

  it('looks up only the same operation using PUT/body and rejects expiry or ambiguous matches', async () => {
    const fetcher = providerFetch(() => json({ envelopes: [{ envelopeId: binding.envelopeId, status: 'sent', transactionId: binding.operationId }] }))
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    const lookup = await provider.lookupEnvelope(binding.operationId, clock - 1000, 0)
    expect(lookup.envelope?.envelopeId).toBe(binding.envelopeId)
    expect(lookup.responseSha256).toBe(offeringSignatureSha256(JSON.stringify({ envelopes: [
      { envelopeId: binding.envelopeId, status: 'sent', transactionId: binding.operationId },
    ] })))
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/envelopes/status?transaction_ids=${binding.operationId}`), expect.objectContaining({ method: 'PUT', body: '{}' }))
    await expect(provider.lookupEnvelope(binding.operationId, clock - 1000, 0)).rejects.toThrow('POLL_NOT_DUE')
    await expect(provider.lookupEnvelope(binding.operationId, clock - DOCUSIGN_OFFERING_LIMITS.lookupMs, 0)).rejects.toThrow('LOOKUP_EXPIRED')
    const ambiguous = createDocusignOfferingProvider(config, { now: () => clock,
      fetch: providerFetch(() => json({ envelopes: [{ envelopeId: id(10), status: 'sent' }, { envelopeId: id(11), status: 'sent' }] })) })
    await expect(ambiguous.lookupEnvelope(binding.operationId, clock, 0)).rejects.toThrow('LOOKUP_AMBIGUOUS')
    const absent = createDocusignOfferingProvider(config, { now: () => clock, fetch: providerFetch(() => json({ envelopes: [] })) })
    expect((await absent.lookupEnvelope(binding.operationId, clock, 0)).envelope).toBeNull()
  })

  it('reserves poll time before failure and honours persisted time and provider throttling', async () => {
    const fetcher = providerFetch(() => json({}, 429, { 'retry-after': '1200' }))
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    await expect(provider.readEnvelopeResource(binding, 'envelope', clock + 1000)).rejects.toMatchObject({ code: 'POLL_NOT_DUE', retryAt: clock + 1000 })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(provider.readEnvelopeResource(binding, 'envelope', 0)).rejects.toMatchObject({ code: 'THROTTLED', retryAt: clock + 1_200_000 })
    await expect(provider.readEnvelopeResource(binding, 'envelope', 0)).rejects.toThrow('POLL_NOT_DUE')
  })

  it('returns an ephemeral view and separate metadata only; return events are never completion', async () => {
    const fetcher = providerFetch(() => json({ url: 'https://demo.docusign.net/Signing/MTRedeem/v1/synthetic' }))
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    const result = await provider.createSigningView(binding, input().signer)
    expect(result.expiresAt).toBe(clock + 300_000)
    expect(result.urlSha256).toBe(offeringSignatureSha256(result.url))
    const sent = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)
    expect(sent).toMatchObject({ recipientId: '1', authenticationMethod: 'Password', returnUrl: 'https://testnet.bx1.co.za/portal' })
    expect(sent.returnUrl.length).toBeLessThanOrEqual(470)
    expect(result).not.toHaveProperty('completed')
  })

  it.each(['https://evil.invalid/Signing/x', 'https://demo.docusign.net.evil.invalid/Signing/x',
    'https://demo.docusign.net/not-signing', 'https://user@demo.docusign.net/Signing/x',
    'https://demo.docusign.net/Signing/x#secret'])('rejects an unsafe signing URL %s', async url => {
    const provider = createDocusignOfferingProvider(config, { now: () => clock, fetch: providerFetch(() => json({ url })) })
    await expect(provider.createSigningView(binding, input().signer)).rejects.toThrow('PROVIDER_RESPONSE_INVALID')
  })

  it('downloads individual raw PDFs and the separate certificate, never combined/base64 data', async () => {
    const fetcher = providerFetch(() => new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) } }))
    const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
    for (const documentId of ['1', '2', '3', '4', 'certificate'] as const) {
      const artifact = await provider.downloadArtifact(binding, documentId, 0)
      expect(artifact).toMatchObject({ documentId, sha256: offeringSignatureSha256(bytes), size: bytes.length, mimeType: 'application/pdf' })
    }
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/documents/'))).toHaveLength(5)
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Content-Transfer-Encoding')
  })

  it.each(['oversize-length', 'truncated', 'wrong-media', 'not-pdf', 'chunked-overflow'] as const)(
    'refuses %s evidence without returning a retained result', async kind => {
      const fetcher = providerFetch(() => {
        if (kind === 'chunked-overflow') return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new Uint8Array(DOCUSIGN_OFFERING_LIMITS.pdf)); controller.enqueue(new Uint8Array(1)); controller.close()
        } }), { headers: { 'content-type': 'application/pdf' } })
        return new Response(kind === 'not-pdf' ? 'not a PDF' : bytes, { headers: {
          'content-type': kind === 'wrong-media' ? 'text/html' : 'application/pdf',
          'content-length': String(kind === 'oversize-length' ? DOCUSIGN_OFFERING_LIMITS.pdf + 1 : kind === 'truncated' ? bytes.length + 10 : kind === 'not-pdf' ? 9 : bytes.length),
        } })
      })
      const provider = createDocusignOfferingProvider(config, { fetch: fetcher, now: () => clock })
      await expect(provider.downloadArtifact(binding, 'certificate', 0)).rejects.toThrow(/EVIDENCE_TOO_LARGE|PROVIDER_RESPONSE_INVALID/)
    })

  it('treats a void response as requiring later reconciliation, not a confirmed terminal status', async () => {
    const provider = createDocusignOfferingProvider(config, { now: () => clock, fetch: providerFetch(() => json({ envelopeId: binding.envelopeId })) })
    expect(await provider.voidEnvelope(binding)).toEqual({ outcome: 'VOID_REQUEST_ACCEPTED', requiresReconciliation: true })
  })
})

describe('authenticated completion assessment fixtures, not provider acceptance', () => {
  it('requires full identity, document, binding, tab and audit evidence before a candidate, not approval', () => {
    const result = assessOfferingCompletion(buildOfferingEnvelope(input()).expected, binding, snapshot())
    expect(result.integrity).toBe('CURRENT_CANDIDATE')
    expect(result.reason).toContain('REQUIRES_RETAINED_ARTIFACTS_AND_CURRENT_AUTHORITY')
  })
  it.each(['declined', 'voided', 'sent'] as const)('does not accept envelope status %s', status => {
    const value = snapshot(); value.envelope.status = status
    expect(assessOfferingCompletion(buildOfferingEnvelope(input()).expected, binding, value).integrity).not.toBe('CURRENT_CANDIDATE')
  })
  it.each(['account', 'envelope', 'signer', 'document', 'cover', 'tab', 'purpose'] as const)('rejects changed %s binding', change => {
    const expected = buildOfferingEnvelope(input()).expected, value = snapshot()
    if (change === 'account') expected.accountId = id(44)
    if (change === 'envelope') value.envelope.envelopeId = id(44)
    if (change === 'signer') (value.recipients.signers as Record<string, unknown>[])[0].clientUserId = id(44)
    if (change === 'document') (value.documents.envelopeDocuments as Record<string, unknown>[])[0].documentId = '99'
    if (change === 'cover' || change === 'purpose') {
      const fields = value.custom_fields.textCustomFields as { name: string; value: string }[]
      fields.find(field => field.name === (change === 'cover' ? 'bx1_cover_sha256' : 'bx1_purpose'))!.value = 'changed'
    }
    if (change === 'tab') (value.tabs.signHereTabs as Record<string, unknown>[])[0].documentId = '1'
    expect(assessOfferingCompletion(expected, binding, value).integrity).toBe('NON_CURRENT')
  })
  it('rejects a same-ID replacement despite unchanged document IDs and tabs when the audit records correction', () => {
    const value = snapshot()
    ;(value.audit_events.auditEvents as unknown[]).push({ eventFields: [{ name: 'Action', value: 'Corrected' }, { name: 'logTime', value: '2026-10-13T10:02:00Z' }] })
    expect(assessOfferingCompletion(buildOfferingEnvelope(input()).expected, binding, value))
      .toEqual({ integrity: 'NON_CURRENT', reason: 'PROVIDER_INTEGRITY_CHANGED' })
  })
  it.each(['missing', 'unknown', 'duplicate-field', 'invalid-time'] as const)('leaves %s audit evidence unresolved', change => {
    const value = snapshot()
    if (change === 'missing') value.audit_events = {}
    else {
      const eventFields = [{ name: 'Action', value: change === 'unknown' ? 'Unrecognised consequential action' : 'Signed' },
        { name: 'logTime', value: change === 'invalid-time' ? 'unparseable' : '2026-10-13T10:04:00Z' }]
      if (change === 'duplicate-field') eventFields.push({ name: 'Action', value: 'Signed' })
      ;(value.audit_events.auditEvents as unknown[]).push({ eventFields })
    }
    expect(assessOfferingCompletion(buildOfferingEnvelope(input()).expected, binding, value).integrity).toBe('UNRESOLVED')
  })
})
