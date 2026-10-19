import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { CLAMAV_EXECUTABLE_SHA256, CLAMAV_PACKAGE_SHA256, CLAMAV_VERSION, TEST_ORIGIN,
  runOfferingOnce, runOnce } from './document-scanner-runner.mjs'
import { OFFICIAL_SNAPSHOT_COVERAGE } from './document-scanner-snapshot.mjs'
import { OPERATING_PROJECT, OPERATING_REF, OPERATING_REPOSITORY, OPERATING_SCANNER, OPERATING_WORKER,
  operatingProducer, operatingReceipt, operatingScopeLabel, recordedRecoveryBinding, recordedRecoveryReceipt,
  recoveryHttpDiagnostic, runOfferingOperatingJob, validateOperatingEnvironment } from './document-scanner-offering-operating.mjs'

// Pure guards/output and source-wiring tests; no live queue, key, engine or provider.
const sourceCommit = 'a'.repeat(40)
const databaseSha256 = 'b'.repeat(64)
const environment = () => ({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: OPERATING_REPOSITORY, GITHUB_REF: OPERATING_REF,
  GITHUB_WORKFLOW_REF: `${OPERATING_REPOSITORY}/.github/workflows/bx1-demo-fund-compile.yml@${OPERATING_REF}`,
  GITHUB_JOB: 'offering-document-scanner-operating', GITHUB_REF_PROTECTED: 'true', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: sourceCommit, BX1_SCANNER_APPROVED_SOURCE_COMMIT: sourceCommit,
  BX1_SCANNER_OPERATING_CLOUD_RUN: 'test-offering-scanner-v1', BX1_SCANNER_PACKAGE_SHA256: CLAMAV_PACKAGE_SHA256,
  BX1_SCANNER_PROJECT_REF: OPERATING_PROJECT, BLOCKXONE_ENVIRONMENT: 'TESTNET', BLOCKXONE_APP_ORIGIN: TEST_ORIGIN,
  BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: OPERATING_WORKER, BLOCKXONE_DOCUMENT_SCANNER_ID: OPERATING_SCANNER,
  BX1_SCANNER_SCOPE: 'OFFERING', BX1_SCANNER_OPERATION: 'CLAIM' })

test('operating identity binds reviewed source, protected ref, manual event and TEST only', () => {
  assert.deepEqual(validateOperatingEnvironment(environment(), 'linux'), { sourceCommit, scope: 'OFFERING', operation: 'CLAIM' })
  assert.deepEqual(validateOperatingEnvironment({ ...environment(), BX1_SCANNER_SCOPE: 'ADMISSION' }, 'linux'), { sourceCommit, scope: 'ADMISSION', operation: 'CLAIM' })
  for (const [name, invalid] of [
    ['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REPOSITORY', 'other/BlockXOne'],
    ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_WORKFLOW_REF', `${OPERATING_REPOSITORY}/other.yml@${OPERATING_REF}`],
    ['GITHUB_JOB', 'document-scanner-engine'], ['GITHUB_REF_PROTECTED', 'false'], ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_SHA', 'c'.repeat(40)], ['BX1_SCANNER_APPROVED_SOURCE_COMMIT', 'd'.repeat(40)],
    ['BX1_SCANNER_OPERATING_CLOUD_RUN', 'proof'], ['BX1_SCANNER_PACKAGE_SHA256', 'e'.repeat(64)],
    ['BX1_SCANNER_PROJECT_REF', 'oqkevkjbkpugjotihtda'], ['BLOCKXONE_ENVIRONMENT', 'MAINNET'],
    ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'], ['BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID', 'other-worker'],
    ['BLOCKXONE_DOCUMENT_SCANNER_ID', 'other-scanner'], ['BX1_SCANNER_SCOPE', 'BOTH'], ['BX1_SCANNER_OPERATION', 'UNKNOWN'],
  ]) assert.throws(() => validateOperatingEnvironment({ ...environment(), [name]: invalid }, 'linux'), undefined, name)
  assert.throws(() => validateOperatingEnvironment(environment(), 'win32'))
  for (const name of Object.keys(environment())) {
    const missing = environment(); delete missing[name]
    assert.throws(() => validateOperatingEnvironment(missing, 'linux'), undefined, `missing ${name}`)
  }
})

test('recovery is explicit ADMISSION-only and parses private identifiers without an evidence override', () => {
  const recovery = { ...environment(), BX1_SCANNER_SCOPE: 'ADMISSION', BX1_SCANNER_OPERATION: 'RECOVER' }
  assert.equal(validateOperatingEnvironment(recovery, 'linux').operation, 'RECOVER')
  assert.throws(() => validateOperatingEnvironment({ ...recovery, BX1_SCANNER_SCOPE: 'OFFERING' }, 'linux'))
  const binding = { document_id: '11111111-1111-4111-8111-111111111111', attempt_id: '22222222-2222-4222-8222-222222222222', authority_epoch: 2 }
  assert.deepEqual(recordedRecoveryBinding(JSON.stringify(binding)), binding)
  for (const value of [undefined, '', 'null', '{}', '{', JSON.stringify({ ...binding, verdict: 'CLEAN' }),
    JSON.stringify({ ...binding, observed_at: '2026-10-01' }), JSON.stringify({ ...binding, authority_epoch: 0 }),
    JSON.stringify({ ...binding, document_id: '00000000-0000-0000-0000-000000000000' })]) {
    assert.throws(() => recordedRecoveryBinding(value), /^Error: Recorded result recovery binding rejected\.$/)
  }
})

test('recovery output reports continuation, not a new scan, engine run or document identifier', () => {
  const receipt = recordedRecoveryReceipt({ outcome: 'RECORDED_RESULT_RECOVERED', state: 'SCANNED_CLEAN',
    recovery: 'PRIVATE_RECOVERY', document_id: 'PRIVATE_ID' }, sourceCommit)
  assert.equal(receipt.newScanPerformed, false)
  assert.equal(receipt.evidenceSource, 'ORIGINAL_IMMUTABLE_SCAN_EVENT')
  assert.equal(receipt.reconciliationRequiredBeforeAnotherInvocation, false)
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_|document_id|attempt_id|engineVersion|databaseSha256/)
  assert.equal(recordedRecoveryReceipt({ outcome: 'RECORDED_RESULT_RECOVERY_REQUIRED' }, sourceCommit).reconciliationRequiredBeforeAnotherInvocation, true)
  assert.throws(() => recordedRecoveryReceipt({ outcome: 'RESULT_ACCEPTED', state: 'SCANNED_CLEAN' }, sourceCommit))
})

test('HTTP diagnostics classify only exact known errors and leave the original response consumable', async () => {
  for (const [error, classifier] of [
    ['unavailable', 'unavailable'],
    ['The request outcome is unavailable. Refresh before retrying; do not create a second request.', 'portal-unavailable'],
    ['Recorded document recovery could not be confirmed. Retry the same recorded result.', 'recovery-unconfirmed'],
    ['Document processing authentication failed.', 'hmac-denied'],
    ['Private document processing is not configured.', 'processing-unconfigured'],
    ['Private document scanner is not configured. No document has been released.', 'scanner-unconfigured'],
    ['Independent scanner result writer is not configured.', 'scanner-writer-unconfigured'],
    ['Independent scanner result could not be recorded.', 'scanner-result-unconfirmed'],
  ]) {
    const response = new Response(JSON.stringify({ error, code: 'PRIVATE_CODE_NOT_EMITTED' }), { status: 503,
      headers: { 'content-type': 'application/json', 'set-cookie': 'PRIVATE_COOKIE' } })
    const diagnostic = await recoveryHttpDiagnostic(response)
    assert.deepEqual(diagnostic, { http_status: 503, classifier })
    assert.equal(response.bodyUsed, false)
    assert.equal((await response.json()).error, error)
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|cookie|https?:|postgres|scanner result could/)
  }
})

test('unknown, malformed, oversized or additional-field bodies emit no private content', async () => {
  for (const body of ['', '<html>PRIVATE_HEADER PRIVATE_URL</html>', JSON.stringify({ error: 'PRIVATE_SQL_SECRET' }),
    JSON.stringify({ error: 'unavailable', private: 'PRIVATE_ID' }), JSON.stringify(['unavailable']),
    JSON.stringify({ error: 'unavailable', code: { private: 'PRIVATE_KEY' } }), 'x'.repeat(4097)]) {
    const response = new Response(body, { status: 503 })
    const diagnostic = await recoveryHttpDiagnostic(response)
    assert.deepEqual(diagnostic, { http_status: 503, classifier: 'unknown' })
    assert.equal(response.bodyUsed, false)
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|unavailable|https?:|error:/)
  }
  const declaredLarge = new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-length': '4097' } })
  assert.deepEqual(await recoveryHttpDiagnostic(declaredLarge), { http_status: 503, classifier: 'unknown' })
})

test('the actual protected RECOVER entry calls only recorded continuation without a scanner snapshot or engine', async () => {
  const binding = { document_id: '11111111-1111-4111-8111-111111111111', attempt_id: '22222222-2222-4222-8222-222222222222', authority_epoch: 2 }
  const values = { ...environment(), BX1_SCANNER_SCOPE: 'ADMISSION', BX1_SCANNER_OPERATION: 'RECOVER',
    BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'), BX1_SCANNER_RECOVERY_BINDING: JSON.stringify(binding),
    BX1_SCANNER_DATABASE_PATH: undefined, BX1_SCANNER_DATABASE_SHA256: undefined }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  const calls = []
  try {
    for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    globalThis.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body.toString()) })
      return new Response(JSON.stringify({ id: binding.document_id, state: 'SCANNED_CLEAN' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } })
    }
    const receipt = await runOfferingOperatingJob()
    assert.equal(receipt.outcome, 'RECORDED_RESULT_RECOVERED')
    assert.equal(receipt.newScanPerformed, false)
    assert.deepEqual(receipt.httpDiagnostics, [{ http_status: 200, classifier: 'unknown' }])
    assert.deepEqual(calls, [{ url: `${TEST_ORIGIN}/api/portal/documents/processing`, body: { command: 'RECOVER_RESULT', ...binding } }])
    assert.doesNotMatch(JSON.stringify(receipt), /11111111|22222222|engineVersion|databaseSha256/)
    calls.length = 0
    globalThis.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body.toString()) })
      return new Response('{"error":"unavailable"}', { status: 503,
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } })
    }
    const failed = await runOfferingOperatingJob()
    assert.equal(failed.outcome, 'RECORDED_RESULT_RECOVERY_REQUIRED')
    assert.deepEqual(failed.httpDiagnostics, Array.from({ length: 3 }, () => ({ http_status: 503, classifier: 'unavailable' })))
    assert.equal(calls.length, 3)
    for (const call of calls) assert.deepEqual(call.body, { command: 'RECOVER_RESULT', ...binding })
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

const accepted = () => ({ outcome: 'RESULT_ACCEPTED', verdict: 'CLEAN',
  engine: { version: CLAMAV_VERSION, executableSha256: CLAMAV_EXECUTABLE_SHA256, databaseSha256,
    coverage: OFFICIAL_SNAPSHOT_COVERAGE, officialSignaturesOnly: true, productionMalwareCoverageProved: false,
    byteSha256: 'PRIVATE_DOCUMENT_HASH' }, recovery: { private: 'PRIVATE_RECOVERY' }, file_id: 'PRIVATE_ID' })

test('accepted output excludes document and recovery evidence and never claims production coverage', () => {
  const receipt = operatingReceipt(accepted(), sourceCommit, databaseSha256, 'OFFERING')
  assert.equal(receipt.reconciliationRequiredBeforeAnotherInvocation, false)
  assert.equal(receipt.productionMalwareCoverageProved, false)
  assert.equal(receipt.operatingMode, 'MANUAL_SINGLE_JOB_NO_SCHEDULER')
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_|recovery|file_id|byteSha256/)
  assert.equal(operatingReceipt({ ...accepted(), verdict: 'MALICIOUS' }, sourceCommit, databaseSha256, 'OFFERING').verdict, 'MALICIOUS')
})

test('fixture, stale or mismatched acceptance is not an operational acceptance', () => {
  for (const [name, invalid] of [['version', '1.4.5'], ['executableSha256', 'c'.repeat(64)],
    ['databaseSha256', 'd'.repeat(64)], ['coverage', 'CUSTOM_HARMLESS_FIXTURE_ONLY'],
    ['officialSignaturesOnly', false], ['productionMalwareCoverageProved', true]]) {
    const value = accepted(); value.engine[name] = invalid
    assert.throws(() => operatingReceipt(value, sourceCommit, databaseSha256, 'OFFERING'), undefined, name)
  }
  assert.throws(() => operatingReceipt({ ...accepted(), verdict: 'UNKNOWN' }, sourceCommit, databaseSha256, 'OFFERING'))
  assert.throws(() => operatingReceipt({ outcome: 'OTHER' }, sourceCommit, databaseSha256, 'OFFERING'))
})

test('uncertain, expired or failed work requires reconciliation, not an automatic next claim', () => {
  for (const outcome of ['CLAIM_RECOVERY_REQUIRED', 'RESULT_RECOVERY_REQUIRED', 'PROCESSING_FAILED', 'LEASE_EXPIRED', 'FAILURE_UNCONFIRMED']) {
    const receipt = operatingReceipt({ outcome, recovery: { private: 'PRIVATE_RECOVERY' } }, sourceCommit, databaseSha256, 'OFFERING')
    assert.equal(receipt.reconciliationRequiredBeforeAnotherInvocation, true)
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_RECOVERY/)
  }
  assert.equal(operatingReceipt({ outcome: 'EMPTY_QUEUE' }, sourceCommit, databaseSha256, 'OFFERING').reconciliationRequiredBeforeAnotherInvocation, false)
})

test('explicit queue selection chooses one real producer without fallback or running either', () => {
  assert.equal(operatingProducer('OFFERING'), runOfferingOnce)
  assert.equal(operatingProducer('ADMISSION'), runOnce)
  for (const scope of [undefined, null, '', 'BOTH', 'offering', 'ADMISSION,OFFERING']) {
    assert.throws(() => operatingProducer(scope))
    assert.throws(() => operatingScopeLabel(scope))
    assert.throws(() => operatingReceipt({ outcome: 'EMPTY_QUEUE' }, sourceCommit, databaseSha256, scope))
  }
})

test('sanitised receipt label matches the explicitly selected queue in success and unknown states', () => {
  for (const [scope, label] of [['OFFERING', 'TEST_OFFERING_DOCUMENT_WORKER'], ['ADMISSION', 'TEST_ADMISSION_DOCUMENT_WORKER']]) {
    for (const result of [accepted(), { outcome: 'EMPTY_QUEUE' }, { outcome: 'RESULT_RECOVERY_REQUIRED', recovery: 'PRIVATE_RECOVERY' }]) {
      const receipt = operatingReceipt(result, sourceCommit, databaseSha256, scope)
      assert.equal(receipt.scope, label)
      assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_/)
    }
  }
})

test('operating entry uses shared official preflight lifetime and the real single-job producer', async () => {
  const operating = await readFile(new URL('./document-scanner-offering-operating.mjs', import.meta.url), 'utf8')
  const bootstrap = await readFile(new URL('./document-scanner-official-proof.mjs', import.meta.url), 'utf8')
  assert.equal((operating.match(/await run\(config\)/g) ?? []).length, 1)
  assert.match(operating, /const run = operatingProducer\(scope\)/)
  assert.doesNotMatch(operating, /await runOfferingOnce\(|await runOnce\(/)
  const claimPath = operating.slice(operating.indexOf('  const run = operatingProducer(scope)'))
  assert.doesNotMatch(claimPath, /engine:\s*|fetchImpl:\s*|allowFixtureDatabase:\s*true|console\.\w+\([^\n]*result\)/)
  assert.match(operating, /withOfficialCloudSnapshot\(async/)
  assert.match(operating, /purpose: 'OPERATING'/)
  assert.match(operating, /config\.signingKey\.fill\(0\)/)
  assert.ok(bootstrap.indexOf("atStage('OFFICIAL_PREFLIGHT', () => preflightOfficialScanner(config))")
    < bootstrap.indexOf('return await operation({ config, built'))
  assert.ok(bootstrap.indexOf('return await operation({ config, built') < bootstrap.indexOf("await atStage('CLEANUP'"))
})

test('manual workflow isolates the HMAC and private recovery binding to the final invocation', async () => {
  const workflow = (await readFile(new URL('../../../.github/workflows/bx1-demo-fund-compile.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const start = workflow.indexOf('  offering-document-scanner-operating:\n')
  const end = workflow.indexOf('  compile-and-build:\n', start)
  assert.ok(start > 0 && end > start)
  const job = workflow.slice(start, end)
  assert.match(workflow, /scanner_scope:\n\s+description:[^\n]+\n\s+type: choice\n\s+options: \[OFFERING, ADMISSION\]\n\s+default: OFFERING/)
  assert.equal((workflow.match(/BX1_SCANNER_SCOPE: \$\{\{ inputs\.scanner_scope \}\}/g) ?? []).length, 1)
  assert.match(job, /BX1_SCANNER_SCOPE: \$\{\{ inputs\.scanner_scope \}\}/)
  assert.match(job, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'offering-scanner-operating'/)
  assert.match(job, /github\.repository == 'GulfBrick\/BlockXOne'/)
  assert.match(job, /github\.ref == 'refs\/heads\/codex\/stage2-sandbox-completion-20261011'/)
  assert.match(job, /environment: bx1-test-offering-scanner/)
  assert.match(job, /cancel-in-progress: false/)
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(job, /persist-credentials: false/)
  const invocation = job.indexOf('      - name: Process one explicitly selected TEST document operation')
  assert.ok(invocation > 0)
  assert.doesNotMatch(job.slice(0, invocation), /\$\{\{ secrets\.|BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY/)
  assert.equal((job.match(/secrets\./g) ?? []).length, 2)
  assert.match(job.slice(invocation), /BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: \$\{\{ secrets\.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY \}\}/)
  assert.match(job.slice(invocation), /BX1_SCANNER_RECOVERY_BINDING: \$\{\{ inputs\.scanner_operation == 'RECOVER' && secrets\.BX1_SCANNER_RECOVERY_BINDING \|\| '' \}\}/)
  assert.match(job, /Install pinned official scanner without any application secret\n\s+if: \$\{\{ inputs\.scanner_operation == 'CLAIM' \}\}/)
  assert.doesNotMatch(workflow, /recovery_document_id:|recovery_attempt_id:|recovery_authority_epoch:/)
  assert.doesNotMatch(job, /upload-artifact|npm |set -x|id-token: write|contents: write/)
})
