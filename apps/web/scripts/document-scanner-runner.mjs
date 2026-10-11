import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const TEST_ORIGIN = 'https://testnet.bx1.co.za'
export const CLAMAV_VERSION = '1.4.6'
export const CLAMAV_EXECUTABLE = '/usr/local/bin/clamscan'
export const CLAMAV_EXECUTABLE_SHA256 = '08160a5c11103e1a7af3b783b25e947a52bb0a598c40102c7aaa6525e477f7bf'
export const CLAMAV_PACKAGE_SHA256 = 'd3ee9e401974855a1edc1761b1425417d126de618d5f0c91cd51209f69f6fcc2'
const MAX_BYTES = 4_194_304
const HTTP_TIMEOUT = 8000
const SCAN_TIMEOUT = 60_000
const DELIVERY_MARGIN = 12_000
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const NAME = /^[a-z][a-z0-9_-]{2,119}$/
const MIME = ['application/pdf', 'image/png', 'image/jpeg']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** Errors intentionally contain no input, URL, engine output, key or private path. */
export class RunnerError extends Error {
  constructor(code) { super(`Private scanner runner: ${code}.`); this.name = 'RunnerError'; this.code = code }
}
const reject = code => { throw new RunnerError(code) }
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')

export function runnerConfig(env = process.env) {
  const encoded = env.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY ?? ''
  const key = /^[A-Za-z0-9_-]{43,86}$/.test(encoded) ? Buffer.from(encoded, 'base64url') : Buffer.alloc(0)
  if (env.BLOCKXONE_ENVIRONMENT !== 'TESTNET' || env.BLOCKXONE_APP_ORIGIN !== TEST_ORIGIN
    || !NAME.test(env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID ?? '')
    || !NAME.test(env.BLOCKXONE_DOCUMENT_SCANNER_ID ?? '') || key.length < 32 || key.length > 64
    || key.toString('base64url') !== encoded
    || !path.isAbsolute(env.BX1_SCANNER_DATABASE_PATH ?? '')
    || !HASH.test(env.BX1_SCANNER_DATABASE_SHA256 ?? '')) reject('INVALID_CONFIGURATION')
  return Object.freeze({ origin: TEST_ORIGIN, workerId: env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID,
    scannerId: env.BLOCKXONE_DOCUMENT_SCANNER_ID, signingKey: key,
    databasePath: env.BX1_SCANNER_DATABASE_PATH, databaseSha256: env.BX1_SCANNER_DATABASE_SHA256 })
}

export function validateManifest(value, config, now = Date.now()) {
  const keys = ['document_id', 'attempt_id', 'authority_epoch', 'attempt_number', 'worker_id', 'scanner_id',
    'reference', 'lease_expires_at', 'actor_id', 'storage_path', 'sha256', 'size', 'mime_type']
  if (!exact(value, keys) || ![value.document_id, value.attempt_id, value.actor_id].every(x => typeof x === 'string' && ID.test(x))
    || !Number.isSafeInteger(value.authority_epoch) || value.authority_epoch < 1
    || !Number.isInteger(value.attempt_number) || value.attempt_number < 1 || value.attempt_number > 5
    || value.worker_id !== config.workerId || value.scanner_id !== config.scannerId
    || value.reference !== `bx1-scan:${value.attempt_id}` || value.storage_path !== `${value.actor_id}/${value.document_id}`
    || typeof value.sha256 !== 'string' || !HASH.test(value.sha256)
    || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_BYTES || !MIME.includes(value.mime_type)
    || typeof value.lease_expires_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.lease_expires_at)
    || !Number.isFinite(Date.parse(value.lease_expires_at)) || Date.parse(value.lease_expires_at) <= now
    || Date.parse(value.lease_expires_at) > now + 120_000) reject('INVALID_MANIFEST')
  return Object.freeze({ ...value })
}

export function verifyDocumentBytes(bytes, manifest) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== manifest.size || sha(bytes) !== manifest.sha256) reject('HASH_MISMATCH')
  const b = Buffer.from(bytes)
  const pdf = b.subarray(0, 5).toString('ascii') === '%PDF-' && /%%EOF\s*$/.test(b.subarray(-1024).toString('latin1'))
  const png = b.length >= 20 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && b.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))
  const jpeg = b.length >= 5 && b[0] === 255 && b[1] === 216 && b[2] === 255
    && b[b.length - 2] === 255 && b[b.length - 1] === 217
  if (!(manifest.mime_type === 'application/pdf' ? pdf : manifest.mime_type === 'image/png' ? png : jpeg)) reject('INVALID_DOCUMENT')
  return b
}

export function signedRequest(body, config, kind, now = Date.now()) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  const timestamp = String(Math.floor(now / 1000))
  const prefix = kind === 'processing' ? 'bx1-document-processing-v1:' : kind === 'result' ? '' : reject('INVALID_PROTOCOL')
  return Object.freeze({ raw, timestamp, signature: `sha256=${createHmac('sha256', config.signingKey)
    .update(prefix).update(timestamp).update('.').update(raw).digest('hex')}` })
}

async function boundedReply(response, limit) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) reject('INVALID_RESPONSE')
  if (!response.body) reject('INVALID_RESPONSE')
  const reader = response.body.getReader()
  const chunks = []
  let count = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.byteLength
      if (count > limit) { await reader.cancel(); reject('RESPONSE_TOO_LARGE') }
      chunks.push(Buffer.from(value))
    }
    if (length !== null && count !== Number(length)) reject('INVALID_RESPONSE')
    return Buffer.concat(chunks, count)
  } finally { reader.releaseLock() }
}

export async function sendSigned(config, request, kind, { fetchImpl = fetch, timeoutMs = HTTP_TIMEOUT } = {}) {
  if (config.origin !== TEST_ORIGIN || !['processing', 'result'].includes(kind)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > HTTP_TIMEOUT) reject('INVALID_DESTINATION')
  const endpoint = `${TEST_ORIGIN}/api/portal/documents${kind === 'processing' ? '/processing' : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(endpoint, { method: kind === 'processing' ? 'POST' : 'PATCH',
      redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: controller.signal, headers: { 'Content-Type': 'application/json',
        'x-bx1-scanner-timestamp': request.timestamp, 'x-bx1-scanner-signature': request.signature }, body: request.raw })
    if (response.redirected || response.status !== 200 || (response.url && response.url !== endpoint)
      || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? '')
      || response.headers.has('set-cookie')) reject('INVALID_RESPONSE')
    const type = response.headers.get('content-type') ?? ''
    if (/^application\/octet-stream(?:;|$)/i.test(type) && kind === 'processing') {
      return { bytes: await boundedReply(response, MAX_BYTES) }
    }
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)) reject('INVALID_RESPONSE')
    const raw = await boundedReply(response, 4096)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)) }
    catch { reject('INVALID_RESPONSE') }
  } catch (error) { if (error instanceof RunnerError) throw error; reject('DELIVERY_FAILED') }
  finally { clearTimeout(timer) }
}

export function interpretClamavResult({ code, signal, stdout, stderr }) {
  if (signal || (code !== 0 && code !== 1) || stderr.trim() || /Heuristics\.(?:Limits\.Exceeded|Encrypted)|\b(?:ERROR|WARNING)\b/i.test(stdout)) reject('ENGINE_UNAVAILABLE')
  const summary = stdout.split(/-+\s*SCAN SUMMARY\s*-+/)
  if (summary.length !== 2 || !/^Scanned files:\s*1\s*$/m.test(summary[1])
    || !/^Engine version:\s*1\.4\.6\s*$/m.test(summary[1])
    || /^Total errors:\s*[1-9]/m.test(summary[1])
    || !new RegExp(`^Infected files:\\s*${code}\\s*$`, 'm').test(summary[1])) reject('INCOMPLETE_SCAN')
  const fileResults = summary[0].trim().split(/\r?\n/).filter(Boolean)
  if (fileResults.length !== 1 || !(code === 0 ? /^stdin: OK$/ : /^stdin: [A-Za-z0-9_.:-]+ FOUND$/).test(fileResults[0])) reject('INCOMPLETE_SCAN')
  return code === 0 ? 'CLEAN' : 'MALICIOUS'
}

export function runClamavProcess(args, input, { spawnImpl = spawn, timeoutMs = SCAN_TIMEOUT, outputLimit = 16_384 } = {}) {
  if (!Array.isArray(args) || !args.every(x => typeof x === 'string') || !(input instanceof Uint8Array)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SCAN_TIMEOUT
    || !Number.isInteger(outputLimit) || outputLimit < 1 || outputLimit > 16_384) reject('INVALID_ENGINE_INPUT')
  return new Promise((resolve, fail) => {
    let child
    let finished = false
    let outputSize = 0
    const outputs = { stdout: [], stderr: [] }
    const finishError = () => { if (finished) return; finished = true; clearTimeout(timer); child?.kill('SIGKILL'); fail(new RunnerError('ENGINE_UNAVAILABLE')) }
    let timer
    try {
      child = spawnImpl(CLAMAV_EXECUTABLE, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: '/nonexistent' } })
      timer = setTimeout(finishError, timeoutMs)
      child.on('error', finishError)
      child.stdin.on('error', finishError)
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        outputSize += chunk.length
        if (outputSize > outputLimit) finishError()
        else outputs[stream].push(Buffer.from(chunk))
      })
      child.on('close', (code, signal) => {
        if (finished) return
        finished = true; clearTimeout(timer)
        resolve({ code, signal, stdout: Buffer.concat(outputs.stdout).toString('utf8'), stderr: Buffer.concat(outputs.stderr).toString('utf8') })
      })
      child.stdin.end(input)
    } catch { finishError() }
  })
}

export async function runPinnedClamavProcess(args, input, { readExecutable = readFile, ...options } = {}) {
  let executable
  try { executable = await readExecutable(CLAMAV_EXECUTABLE) }
  catch { reject('ENGINE_UNAVAILABLE') }
  if (!(executable instanceof Uint8Array) || sha(executable) !== CLAMAV_EXECUTABLE_SHA256) reject('ENGINE_HASH_MISMATCH')
  return runClamavProcess(args, input, options)
}

export async function scanWithClamav(bytes, { databasePath, databaseSha256, clock = Date.now,
  spawnImpl = spawn, timeoutMs = SCAN_TIMEOUT, outputLimit = 16_384 } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_BYTES
    || !path.isAbsolute(databasePath ?? '') || !HASH.test(databaseSha256 ?? '')
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SCAN_TIMEOUT
    || !Number.isInteger(outputLimit) || outputLimit < 1 || outputLimit > 16_384) reject('INVALID_ENGINE_INPUT')
  let binaryHash
  let database
  try {
    const [engineStat, databaseStat] = await Promise.all([lstat(CLAMAV_EXECUTABLE), lstat(databasePath)])
    if (!engineStat.isFile() || (engineStat.mode & 0o022) || await realpath(CLAMAV_EXECUTABLE) !== CLAMAV_EXECUTABLE
      || !databaseStat.isFile() || databaseStat.size < 1 || databaseStat.size > 512 * 1024 * 1024
      || (databaseStat.mode & 0o022) || await realpath(databasePath) !== databasePath) reject('INVALID_ENGINE_INPUT')
    database = await readFile(databasePath)
    if (sha(database) !== databaseSha256) reject('INVALID_DATABASE')
    binaryHash = sha(await readFile(CLAMAV_EXECUTABLE))
    if (binaryHash !== CLAMAV_EXECUTABLE_SHA256) reject('ENGINE_HASH_MISMATCH')
  } catch (error) { if (error instanceof RunnerError) throw error; reject('ENGINE_UNAVAILABLE') }
  // One immutable snapshot is the entire loaded database; no implicit default
  // signature directory is mixed into its hash. Internal extraction is private
  // memory-backed scratch, not a promise that libclamav never creates files.
  let scratch
  try {
    scratch = await mkdtemp('/dev/shm/bx1-scan-')
    await chmod(scratch, 0o700)
    const extension = path.extname(databasePath).toLowerCase()
    if (!['.ndb', '.hdb', '.hsb', '.ldb', '.cvd', '.cld'].includes(extension)) reject('INVALID_DATABASE')
    const snapshot = path.join(scratch, `signatures${extension}`)
    await writeFile(snapshot, database, { flag: 'wx', mode: 0o400 })
    const started = clock()
    const version = await runPinnedClamavProcess(['--version'], Buffer.alloc(0), { spawnImpl, timeoutMs: Math.min(timeoutMs, 5000), outputLimit })
    if (version.code !== 0 || version.signal || version.stderr.trim()
      || !/^ClamAV 1\.4\.6(?:\/[^\r\n]+)?\r?\n?$/.test(version.stdout)) reject('ENGINE_VERSION_MISMATCH')
    const remaining = timeoutMs - (clock() - started)
    if (remaining < 1) reject('ENGINE_UNAVAILABLE')
    const result = await runPinnedClamavProcess(['--database', snapshot, '--tempdir', scratch,
      '--scan-pdf=yes', '--scan-image=yes', '--alert-encrypted=yes', '--alert-exceeds-max=yes',
      '--max-filesize=4M', '--max-scansize=16M', '--max-files=128', '--max-recursion=8',
      `--max-scantime=${remaining}`, '--bytecode-timeout=1000', '-'], bytes, { spawnImpl, timeoutMs: remaining, outputLimit })
    return Object.freeze({ verdict: interpretClamavResult(result), engineVersion: CLAMAV_VERSION,
      engineSha256: binaryHash, databaseSha256, sha256: sha(bytes) })
  } catch (error) { if (error instanceof RunnerError) throw error; reject('ENGINE_UNAVAILABLE') }
  finally { if (scratch) await rm(scratch, { recursive: true, force: true }) }
}

function validateFailure(value, job, code) {
  if (!exact(value, ['document_id', 'attempt_id', 'state', 'attempt_number', 'next_attempt_at'])
    || value.document_id !== job.document_id || value.attempt_id !== job.attempt_id || value.attempt_number !== job.attempt_number
    || !['RETRY_WAIT', 'EXHAUSTED'].includes(value.state)
    || (value.state === 'EXHAUSTED' && (value.next_attempt_at !== null || (!['INVALID_DOCUMENT', 'HASH_MISMATCH'].includes(code) && job.attempt_number !== 5)))
    || (value.state === 'RETRY_WAIT' && (['INVALID_DOCUMENT', 'HASH_MISMATCH'].includes(code) || job.attempt_number === 5
      || typeof value.next_attempt_at !== 'string' || !Number.isFinite(Date.parse(value.next_attempt_at))))) reject('INVALID_RESPONSE')
  return value.state
}

export async function recoverResult(recovery, config, { fetchImpl = fetch, clock = Date.now } = {}) {
  // Sensitive state stays in the caller's private worker memory/store. Never log it.
  if (!exact(recovery, ['kind', 'request', 'documentId', 'verdict']) || recovery.kind !== 'RESULT_RECOVERY'
    || !ID.test(recovery.documentId) || !['CLEAN', 'MALICIOUS'].includes(recovery.verdict)
    || !exact(recovery.request, ['raw', 'timestamp', 'signature']) || !Buffer.isBuffer(recovery.request.raw)
    || recovery.request.raw.length > 4096 || !/^[0-9]{10}$/.test(recovery.request.timestamp)
    || !/^sha256=[0-9a-f]{64}$/.test(recovery.request.signature)
    || Math.abs(clock() - Number(recovery.request.timestamp) * 1000) > 300_000) reject('INVALID_RECOVERY')
  const digest = createHmac('sha256', config.signingKey).update(recovery.request.timestamp).update('.').update(recovery.request.raw).digest()
  if (!timingSafeEqual(digest, Buffer.from(recovery.request.signature.slice(7), 'hex'))) reject('INVALID_RECOVERY')
  let payload
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(recovery.request.raw)) }
  catch { reject('INVALID_RECOVERY') }
  if (!exact(payload, ['document_id', 'sha256', 'verdict', 'reference', 'observed_at'])
    || payload.document_id !== recovery.documentId || payload.verdict !== recovery.verdict
    || !HASH.test(payload.sha256) || !/^bx1-scan:[0-9a-f-]{36}$/.test(payload.reference)
    || !ID.test(payload.reference.slice(9)) || typeof payload.observed_at !== 'string'
    || !Number.isFinite(Date.parse(payload.observed_at))) reject('INVALID_RECOVERY')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reply = await sendSigned(config, recovery.request, 'result', { fetchImpl })
      if (!exact(reply, ['id', 'state']) || reply.id !== recovery.documentId
        || reply.state !== (recovery.verdict === 'CLEAN' ? 'SCANNED_CLEAN' : 'REJECTED')) reject('INVALID_RESPONSE')
      return { outcome: 'RESULT_ACCEPTED', verdict: recovery.verdict }
    } catch { /* Even a bad reply can follow a committed result. Never FAIL/rescan. */ }
  }
  return { outcome: 'RESULT_RECOVERY_REQUIRED', recovery }
}

export async function runOnce(config, { fetchImpl = fetch, engine = scanWithClamav, clock = Date.now, requestId = randomUUID() } = {}) {
  if (!ID.test(requestId) || config.origin !== TEST_ORIGIN) reject('INVALID_CONFIGURATION')
  const claimRequest = signedRequest({ command: 'CLAIM', request_id: requestId }, config, 'processing', clock())
  let claim
  for (let attempt = 0; attempt < 3; attempt++) {
    try { claim = await sendSigned(config, claimRequest, 'processing', { fetchImpl }); break } catch { /* Same durable CLAIM only. */ }
  }
  if (claim === undefined) return { outcome: 'CLAIM_RECOVERY_REQUIRED', recovery: { kind: 'CLAIM_RECOVERY', request: claimRequest } }
  if (!exact(claim, ['job'])) reject('INVALID_RESPONSE')
  if (claim.job === null) return { outcome: 'EMPTY_QUEUE' }
  const job = validateManifest(claim.job, config, clock())
  const binding = { document_id: job.document_id, attempt_id: job.attempt_id, authority_epoch: job.authority_epoch, sha256: job.sha256 }
  let scan
  try {
    if (Date.parse(job.lease_expires_at) - clock() < SCAN_TIMEOUT + HTTP_TIMEOUT + DELIVERY_MARGIN) reject('LEASE_EXPIRED')
    const reply = await sendSigned(config, signedRequest({ command: 'BYTES', ...binding }, config, 'processing', clock()), 'processing', { fetchImpl })
    if (!exact(reply, ['bytes'])) reject('INVALID_RESPONSE')
    const bytes = verifyDocumentBytes(reply.bytes, job)
    if (Date.parse(job.lease_expires_at) - clock() < SCAN_TIMEOUT + DELIVERY_MARGIN) reject('LEASE_EXPIRED')
    scan = await engine(bytes, { databasePath: config.databasePath, databaseSha256: config.databaseSha256, clock })
    if (!scan || !['CLEAN', 'MALICIOUS'].includes(scan.verdict) || scan.engineVersion !== CLAMAV_VERSION
      || scan.engineSha256 !== CLAMAV_EXECUTABLE_SHA256
      || scan.databaseSha256 !== config.databaseSha256 || scan.sha256 !== job.sha256) reject('ENGINE_UNAVAILABLE')
    if (Date.parse(job.lease_expires_at) - clock() < DELIVERY_MARGIN) reject('LEASE_EXPIRED')
  } catch (error) {
    const code = error instanceof RunnerError && ['HASH_MISMATCH', 'INVALID_DOCUMENT', 'DELIVERY_FAILED'].includes(error.code)
      ? error.code : 'ENGINE_UNAVAILABLE'
    if (Date.parse(job.lease_expires_at) <= clock()) return { outcome: 'LEASE_EXPIRED' }
    try {
      const value = await sendSigned(config, signedRequest({ command: 'FAIL', ...binding, code }, config, 'processing', clock()), 'processing', { fetchImpl })
      return { outcome: 'PROCESSING_FAILED', code, state: validateFailure(value, job, code) }
    } catch { return { outcome: 'FAILURE_UNCONFIRMED', code } }
  }
  const request = signedRequest({ document_id: job.document_id, sha256: job.sha256, verdict: scan.verdict,
    reference: job.reference, observed_at: new Date(clock()).toISOString() }, config, 'result', clock())
  const result = await recoverResult({ kind: 'RESULT_RECOVERY', request, documentId: job.document_id, verdict: scan.verdict }, config, { fetchImpl, clock })
  return { ...result, engine: { version: scan.engineVersion, executableSha256: scan.engineSha256,
    databaseSha256: scan.databaseSha256, byteSha256: scan.sha256 } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runOnce(runnerConfig())
    // Deliberately no result.recovery, identifiers, HMAC, body, raw output or key.
    console.log(JSON.stringify({ scope: 'TEST_SCANNER_RUNNER', outcome: result.outcome,
      ...(result.engine ? { engine: result.engine } : {}), ...(result.verdict ? { verdict: result.verdict } : {}) }))
    if (!['EMPTY_QUEUE', 'RESULT_ACCEPTED'].includes(result.outcome)) process.exitCode = 2
  } catch { console.error('Private scanner runner stopped without acceptance.'); process.exitCode = 2 }
}
