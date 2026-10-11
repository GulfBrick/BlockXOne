import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { CLAMAV_EXECUTABLE, CLAMAV_EXECUTABLE_SHA256, CLAMAV_VERSION, RunnerError, TEST_ORIGIN, interpretClamavResult,
  recoverResult, runClamavProcess, runPinnedClamavProcess, runOnce, runnerConfig, sendSigned, signedRequest,
  validateManifest, verifyDocumentBytes } from './document-scanner-runner.mjs'

// HTTP/subprocess mocks prove boundary negatives, NOT hosted Storage or malware detection.
const now = Date.UTC(2026, 9, 11, 12)
const clock = () => now
const bytes = Buffer.from('%PDF-1.4\n% Synthetic transport fixture only\n%%EOF\n')
const hash = value => createHash('sha256').update(value).digest('hex')
const ids = { document: '00000000-0000-4000-8000-000000000001', attempt: '00000000-0000-4000-8000-000000000002',
  actor: '00000000-0000-4000-8000-000000000003', request: '00000000-0000-4000-8000-000000000004' }
const env = { BLOCKXONE_ENVIRONMENT: 'TESTNET', BLOCKXONE_APP_ORIGIN: TEST_ORIGIN,
  BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'fictional-ci-worker', BLOCKXONE_DOCUMENT_SCANNER_ID: 'fictional-ci-scanner',
  BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BX1_SCANNER_DATABASE_PATH: '/fictional-ci/fixture.ndb', BX1_SCANNER_DATABASE_SHA256: 'a'.repeat(64) }
const config = runnerConfig(env)
const manifest = () => ({ document_id: ids.document, attempt_id: ids.attempt, authority_epoch: 1, attempt_number: 1,
  worker_id: config.workerId, scanner_id: config.scannerId, reference: `bx1-scan:${ids.attempt}`,
  lease_expires_at: new Date(now + 119_000).toISOString(), actor_id: ids.actor,
  storage_path: `${ids.actor}/${ids.document}`, sha256: hash(bytes), size: bytes.length, mime_type: 'application/pdf' })
const json = (value, extra = {}) => new Response(JSON.stringify(value), { headers: {
  'content-type': 'application/json', 'cache-control': 'private, no-store', ...extra } })
const binary = (value = bytes) => new Response(value, { headers: {
  'content-type': 'application/octet-stream', 'content-length': String(value.length), 'cache-control': 'private, no-store' } })
const engine = async value => ({ verdict: 'CLEAN', engineVersion: CLAMAV_VERSION, engineSha256: CLAMAV_EXECUTABLE_SHA256,
  databaseSha256: config.databaseSha256, sha256: hash(value) })
const errorCode = expected => error => error instanceof RunnerError && error.code === expected
const resultBody = verdict => ({ document_id: ids.document, sha256: hash(bytes), verdict,
  reference: `bx1-scan:${ids.attempt}`, observed_at: new Date(now).toISOString() })
function mockTransport({ job = manifest(), byteReply = () => binary(), callback, failReply } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body.toString())
    calls.push({ url, init, body })
    if (init.method === 'PATCH') return callback ? callback(calls) : json({ id: ids.document, state: 'SCANNED_CLEAN' })
    if (body.command === 'CLAIM') return json({ job })
    if (body.command === 'BYTES') return byteReply()
    if (body.command === 'FAIL') return failReply ? failReply(body) : json({ document_id: ids.document,
      attempt_id: ids.attempt, state: ['HASH_MISMATCH', 'INVALID_DOCUMENT'].includes(body.code) ? 'EXHAUSTED' : 'RETRY_WAIT',
      attempt_number: 1, next_attempt_at: ['HASH_MISMATCH', 'INVALID_DOCUMENT'].includes(body.code) ? null : new Date(now + 30_000).toISOString() })
    assert.fail('Unexpected command')
  }
  return { calls, fetchImpl }
}

test('configuration is canonical TEST only with fixed identities and canonical private key', () => {
  for (const delta of [{ BLOCKXONE_ENVIRONMENT: 'MAINNET' }, { BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' },
    { BLOCKXONE_APP_ORIGIN: `${TEST_ORIGIN}/` }, { BLOCKXONE_APP_ORIGIN: 'http://testnet.bx1.co.za' },
    { BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za.evil.invalid' }, { BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'X' },
    { BLOCKXONE_DOCUMENT_SCANNER_ID: '' }, { BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: 'secret' },
    { BX1_SCANNER_DATABASE_PATH: 'relative.ndb' }, { BX1_SCANNER_DATABASE_SHA256: 'unknown' }]) {
    assert.throws(() => runnerConfig({ ...env, ...delta }), errorCode('INVALID_CONFIGURATION'))
  }
})

test('strict manifest validates every authority, path, byte and live lease binding', () => {
  assert.deepEqual(validateManifest(manifest(), config, now), manifest())
  for (const delta of [{ extra: true }, { document_id: 'wrong' }, { actor_id: 'wrong' }, { attempt_id: 'wrong' },
    { authority_epoch: 0 }, { authority_epoch: Number.MAX_SAFE_INTEGER + 1 }, { attempt_number: 6 },
    { worker_id: 'other-worker' }, { scanner_id: 'other-scanner' }, { reference: `bx1-scan:${ids.document}` },
    { storage_path: `${ids.actor}/../${ids.document}` }, { size: 0 }, { size: 4_194_305 },
    { sha256: 'A'.repeat(64) }, { mime_type: 'text/plain' }, { lease_expires_at: new Date(now).toISOString() },
    { lease_expires_at: new Date(now + 121_000).toISOString() }, { lease_expires_at: 'tomorrow' }]) {
    assert.throws(() => validateManifest({ ...manifest(), ...delta }, config, now), errorCode('INVALID_MANIFEST'))
  }
  const missing = manifest(); delete missing.actor_id
  assert.throws(() => validateManifest(missing, config, now), errorCode('INVALID_MANIFEST'))
})

test('bytes require exact full hash/length and matching accepted magic/type', () => {
  assert.deepEqual(verifyDocumentBytes(bytes, manifest()), bytes)
  assert.throws(() => verifyDocumentBytes(Buffer.from('changed'), manifest()), errorCode('HASH_MISMATCH'))
  for (const mime of ['image/png', 'image/jpeg']) {
    assert.throws(() => verifyDocumentBytes(bytes, { ...manifest(), mime_type: mime }), errorCode('INVALID_DOCUMENT'))
  }
  const plain = Buffer.from('plain text')
  assert.throws(() => verifyDocumentBytes(plain, { ...manifest(), size: plain.length, sha256: hash(plain) }), errorCode('INVALID_DOCUMENT'))
})

test('processing and result HMACs authenticate exact raw bytes with different domains', () => {
  const body = { command: 'CLAIM', request_id: ids.request }
  const a = signedRequest(body, config, 'processing', now)
  const b = signedRequest(body, config, 'result', now)
  assert.equal(a.timestamp, String(now / 1000))
  assert.equal(a.signature, `sha256=${createHmac('sha256', config.signingKey).update(`bx1-document-processing-v1:${a.timestamp}.`).update(a.raw).digest('hex')}`)
  assert.equal(b.signature, `sha256=${createHmac('sha256', config.signingKey).update(`${b.timestamp}.`).update(b.raw).digest('hex')}`)
  assert.notEqual(a.signature, b.signature)
  assert.throws(() => signedRequest(body, config, 'wrong', now), errorCode('INVALID_PROTOCOL'))
})

test('HTTP forbids redirect and credentials, requires private bounded exact replies', async () => {
  const request = signedRequest({ command: 'CLAIM', request_id: ids.request }, config, 'processing', now)
  await sendSigned(config, request, 'processing', { fetchImpl: async (url, init) => {
    assert.equal(url, `${TEST_ORIGIN}/api/portal/documents/processing`)
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store')
    assert.equal(init.headers['x-bx1-scanner-signature'], request.signature)
    assert.equal(init.body, request.raw); return json({ job: null })
  } })
  for (const reply of [new Response('', { status: 302, headers: { location: 'https://evil.invalid' } }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    json({}, { 'set-cookie': 'unexpected=1' }), json({}, { 'content-length': '5000' }),
    json({}, { 'content-type': 'text/html' }), json({}, { 'content-length': '3' }),
    json({ text: 'x'.repeat(4096) }), new Response(Uint8Array.from([255]), { headers: {
      'content-type': 'application/json', 'cache-control': 'no-store' } })]) {
    await assert.rejects(sendSigned(config, request, 'processing', { fetchImpl: async () => reply }), RunnerError)
  }
  await assert.rejects(sendSigned({ ...config, origin: 'https://bx1.co.za' }, request, 'processing'), errorCode('INVALID_DESTINATION'))
  await assert.rejects(sendSigned(config, request, 'processing', { fetchImpl: async () => { throw new Error('secret URL private') } }), errorCode('DELIVERY_FAILED'))
})

test('empty queue is not scan acceptance and consumes no bytes or engine', async () => {
  const fixture = mockTransport({ job: null })
  assert.deepEqual(await runOnce(config, { ...fixture, engine: async () => assert.fail('engine'), clock, requestId: ids.request }), { outcome: 'EMPTY_QUEUE' })
  assert.equal(fixture.calls.length, 1)
})

test('successful mocked orchestration binds real manifest fields and exact accepted callback', async () => {
  const fixture = mockTransport()
  let scans = 0
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request, engine: async value => { scans++; return engine(value) } })
  assert.equal(result.outcome, 'RESULT_ACCEPTED'); assert.equal(result.verdict, 'CLEAN'); assert.equal(scans, 1)
  assert.deepEqual(fixture.calls.map(x => x.body.command ?? x.body.verdict), ['CLAIM', 'BYTES', 'CLEAN'])
  assert.deepEqual(fixture.calls[2].body, resultBody('CLEAN'))
  assert.equal(result.engine.byteSha256, manifest().sha256)
})

test('detection callback requires REJECTED, not CLEAN or generic HTTP success', async () => {
  const fixture = mockTransport({ callback: () => json({ id: ids.document, state: 'REJECTED' }) })
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request,
    engine: async value => ({ ...await engine(value), verdict: 'MALICIOUS' }) })
  assert.equal(result.outcome, 'RESULT_ACCEPTED'); assert.equal(result.verdict, 'MALICIOUS')
})

test('bad bytes send fatal existing FAIL only and cannot call engine or result', async () => {
  const fixture = mockTransport({ byteReply: () => binary(Buffer.from('wrong')) })
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request, engine: async () => assert.fail('engine') })
  assert.equal(result.outcome, 'PROCESSING_FAILED'); assert.equal(result.code, 'HASH_MISMATCH'); assert.equal(result.state, 'EXHAUSTED')
  assert.equal(fixture.calls.some(x => x.init.method === 'PATCH'), false)
  assert.deepEqual(fixture.calls.at(-1).body, { command: 'FAIL', document_id: ids.document, attempt_id: ids.attempt, authority_epoch: 1, sha256: hash(bytes), code: 'HASH_MISMATCH' })
})

test('engine error is retryable processing failure, never either verdict', async () => {
  const fixture = mockTransport()
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request,
    engine: async () => { throw new Error('raw private engine output') } })
  assert.equal(result.outcome, 'PROCESSING_FAILED'); assert.equal(result.code, 'ENGINE_UNAVAILABLE')
  assert.equal(fixture.calls.some(x => x.init.method === 'PATCH'), false)
})

test('a fabricated engine executable receipt cannot send a result callback', async () => {
  const fixture = mockTransport()
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request,
    engine: async value => ({ ...await engine(value), engineSha256: 'b'.repeat(64) }) })
  assert.equal(result.outcome, 'PROCESSING_FAILED'); assert.equal(result.code, 'ENGINE_UNAVAILABLE')
  assert.equal(fixture.calls.some(x => x.init.method === 'PATCH'), false)
})

test('expired or too-short lease never releases a new result and expiry cannot FAIL', async () => {
  const stale = mockTransport({ job: { ...manifest(), lease_expires_at: new Date(now - 1).toISOString() } })
  await assert.rejects(runOnce(config, { ...stale, clock, engine, requestId: ids.request }), errorCode('INVALID_MANIFEST'))
  assert.equal(stale.calls.length, 1)
  const fixture = mockTransport()
  let current = now
  const result = await runOnce(config, { ...fixture, clock: () => current, requestId: ids.request,
    engine: async value => { current += 120_000; return engine(value) } })
  assert.equal(result.outcome, 'LEASE_EXPIRED'); assert.equal(fixture.calls.length, 2)
})

test('uncertain PATCH retries identical body/timestamp/signature only; recovery never FAIL or rescan', async () => {
  const fixture = mockTransport({ callback: () => { throw new Error('ack lost after commit') } })
  let scans = 0
  const result = await runOnce(config, { ...fixture, clock, requestId: ids.request, engine: async value => { scans++; return engine(value) } })
  assert.equal(result.outcome, 'RESULT_RECOVERY_REQUIRED'); assert.equal(scans, 1)
  const patches = fixture.calls.filter(x => x.init.method === 'PATCH')
  assert.equal(patches.length, 3)
  for (const patch of patches) {
    assert.equal(patch.init.body, patches[0].init.body)
    assert.equal(patch.init.headers['x-bx1-scanner-timestamp'], patches[0].init.headers['x-bx1-scanner-timestamp'])
    assert.equal(patch.init.headers['x-bx1-scanner-signature'], patches[0].init.headers['x-bx1-scanner-signature'])
  }
  assert.equal(fixture.calls.some(x => x.body.command === 'FAIL'), false)
  const recovered = await recoverResult(result.recovery, config, { clock,
    fetchImpl: async (_url, init) => { assert.equal(init.body, patches[0].init.body); return json({ id: ids.document, state: 'SCANNED_CLEAN' }) } })
  assert.equal(recovered.outcome, 'RESULT_ACCEPTED'); assert.equal(scans, 1)
})

test('wrong id/state/extra callback fields remain uncertain, not a successful receipt', async () => {
  for (const value of [{ id: ids.actor, state: 'SCANNED_CLEAN' }, { id: ids.document, state: 'PROMOTED' },
    { id: ids.document, state: 'SCANNED_CLEAN', extra: true }, { ok: true }]) {
    const fixture = mockTransport({ callback: () => json(value) })
    const result = await runOnce(config, { ...fixture, clock, requestId: ids.request, engine })
    assert.equal(result.outcome, 'RESULT_RECOVERY_REQUIRED')
    assert.equal(fixture.calls.some(x => x.body.command === 'FAIL'), false)
  }
})

test('claim uncertainty uses the same immutable request and never consumes a second UUID', async () => {
  const requests = []
  const result = await runOnce(config, { clock, requestId: ids.request, engine, fetchImpl: async (_url, init) => {
    requests.push(init); throw new Error('unknown claim commit')
  } })
  assert.equal(result.outcome, 'CLAIM_RECOVERY_REQUIRED'); assert.equal(requests.length, 3)
  assert.equal(requests.every(x => x.body === requests[0].body), true)
  assert.equal(JSON.parse(requests[0].body).request_id, ids.request)
})

test('recovery rejects expired authentication or tampered private state without any HTTP', async () => {
  const recovery = { kind: 'RESULT_RECOVERY', request: signedRequest(resultBody('CLEAN'), config, 'result', now),
    documentId: ids.document, verdict: 'CLEAN' }
  for (const value of [{ ...recovery, documentId: ids.actor }, { ...recovery, verdict: 'MALICIOUS' },
    { ...recovery, request: { ...recovery.request, raw: Buffer.from('{}') } },
    { ...recovery, request: { ...recovery.request, timestamp: 'NaN' } }]) {
    await assert.rejects(recoverResult(value, config, { clock, fetchImpl: async () => assert.fail('HTTP') }), errorCode('INVALID_RECOVERY'))
  }
  await assert.rejects(recoverResult(recovery, config, { clock: () => now + 301_000, fetchImpl: async () => assert.fail('HTTP') }), errorCode('INVALID_RECOVERY'))
})

const report = (code = 0, detail = code ? 'stdin: Test.Bx1Fixture.UNOFFICIAL FOUND' : 'stdin: OK') => ({ code, signal: null, stderr: '',
  stdout: `${detail}\n----------- SCAN SUMMARY -----------\nKnown viruses: 1\nEngine version: 1.4.6\nScanned files: 1\nInfected files: ${code}\n` })
test('engine report interpretation requires one complete scan, rejecting errors/encryption/limits', () => {
  assert.equal(interpretClamavResult(report()), 'CLEAN')
  assert.equal(interpretClamavResult(report(1)), 'MALICIOUS')
  for (const value of [{ ...report(), code: 2 }, { ...report(), signal: 'SIGKILL' }, { ...report(), stderr: 'warning private' },
    report(1, 'stdin: Heuristics.Encrypted.PDF FOUND'), report(1, 'stdin: Heuristics.Limits.Exceeded FOUND'),
    { ...report(), stdout: report().stdout.replace('Scanned files: 1', 'Scanned files: 0') },
    { ...report(), stdout: report().stdout.replace('1.4.6', '1.4.5') },
    { ...report(), stdout: report().stdout.replace('Infected files: 0', 'Infected files: 1') },
    { ...report(), stdout: `${report().stdout}\nWARNING: private path` },
    { ...report(), stdout: 'stdin: OK' }, report(0, 'stdin: OK\nsecond: OK')]) {
    assert.throws(() => interpretClamavResult(value), RunnerError)
  }
})

test('subprocess uses fixed executable without a shell, bounded private stdout and exact stdin', async () => {
  let killed = false
  const fake = (executable, args, options) => {
    assert.equal(executable, CLAMAV_EXECUTABLE); assert.deepEqual(args, ['-'])
    assert.equal(options.shell, false); assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
    assert.equal('BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY' in options.env, false)
    const child = new EventEmitter()
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { killed = true }
    const chunks = []; child.stdin.on('data', chunk => chunks.push(chunk))
    child.stdin.on('finish', () => { assert.deepEqual(Buffer.concat(chunks), bytes)
      child.stdout.write('private bounded output'); child.emit('close', 0, null) })
    return child
  }
  const result = await runClamavProcess(['-'], bytes, { spawnImpl: fake })
  assert.equal(result.stdout, 'private bounded output'); assert.equal(killed, false)
})

test('subprocess timeout/output overflow kill the child and never yield a verdict', async () => {
  for (const overflow of [false, true]) {
    let killed = false
    const fake = () => {
      const child = new EventEmitter()
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
      child.kill = () => { killed = true }
      if (overflow) child.stdin.on('finish', () => child.stdout.write('x'.repeat(17)))
      return child
    }
    await assert.rejects(runClamavProcess(['-'], bytes, { spawnImpl: fake, timeoutMs: 10, outputLimit: 16 }), errorCode('ENGINE_UNAVAILABLE'))
    assert.equal(killed, true)
  }
})

test('executable hash mismatch denies both version and scan before any child launch', async () => {
  for (const args of [['--version'], ['-']]) {
    let launches = 0
    await assert.rejects(runPinnedClamavProcess(args, bytes, {
      readExecutable: async executable => { assert.equal(executable, CLAMAV_EXECUTABLE); return Buffer.from('not the pinned ELF') },
      spawnImpl: () => { launches++; assert.fail('Unpinned executable must not launch') },
    }), errorCode('ENGINE_HASH_MISMATCH'))
    assert.equal(launches, 0)
  }
})
