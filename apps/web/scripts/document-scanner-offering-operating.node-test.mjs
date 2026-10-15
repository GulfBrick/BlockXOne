import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { CLAMAV_EXECUTABLE_SHA256, CLAMAV_PACKAGE_SHA256, CLAMAV_VERSION, TEST_ORIGIN,
  runOfferingOnce, runOnce } from './document-scanner-runner.mjs'
import { OFFICIAL_SNAPSHOT_COVERAGE } from './document-scanner-snapshot.mjs'
import { OPERATING_PROJECT, OPERATING_REF, OPERATING_REPOSITORY, OPERATING_SCANNER, OPERATING_WORKER,
  operatingProducer, operatingReceipt, operatingScopeLabel, validateOperatingEnvironment } from './document-scanner-offering-operating.mjs'

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
  BX1_SCANNER_SCOPE: 'OFFERING' })

test('operating identity binds reviewed source, protected ref, manual event and TEST only', () => {
  assert.deepEqual(validateOperatingEnvironment(environment(), 'linux'), { sourceCommit, scope: 'OFFERING' })
  assert.deepEqual(validateOperatingEnvironment({ ...environment(), BX1_SCANNER_SCOPE: 'ADMISSION' }, 'linux'), { sourceCommit, scope: 'ADMISSION' })
  for (const [name, invalid] of [
    ['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REPOSITORY', 'other/BlockXOne'],
    ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_WORKFLOW_REF', `${OPERATING_REPOSITORY}/other.yml@${OPERATING_REF}`],
    ['GITHUB_JOB', 'document-scanner-engine'], ['GITHUB_REF_PROTECTED', 'false'], ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_SHA', 'c'.repeat(40)], ['BX1_SCANNER_APPROVED_SOURCE_COMMIT', 'd'.repeat(40)],
    ['BX1_SCANNER_OPERATING_CLOUD_RUN', 'proof'], ['BX1_SCANNER_PACKAGE_SHA256', 'e'.repeat(64)],
    ['BX1_SCANNER_PROJECT_REF', 'oqkevkjbkpugjotihtda'], ['BLOCKXONE_ENVIRONMENT', 'MAINNET'],
    ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'], ['BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID', 'other-worker'],
    ['BLOCKXONE_DOCUMENT_SCANNER_ID', 'other-scanner'], ['BX1_SCANNER_SCOPE', 'BOTH'],
  ]) assert.throws(() => validateOperatingEnvironment({ ...environment(), [name]: invalid }, 'linux'), undefined, name)
  assert.throws(() => validateOperatingEnvironment(environment(), 'win32'))
  for (const name of Object.keys(environment())) {
    const missing = environment(); delete missing[name]
    assert.throws(() => validateOperatingEnvironment(missing, 'linux'), undefined, `missing ${name}`)
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
  assert.doesNotMatch(operating, /engine:\s*|fetchImpl:\s*|allowFixtureDatabase:\s*true|console\.\w+\([^\n]*result\)/)
  assert.match(operating, /withOfficialCloudSnapshot\(async/)
  assert.match(operating, /purpose: 'OPERATING'/)
  assert.match(operating, /config\.signingKey\.fill\(0\)/)
  assert.ok(bootstrap.indexOf("atStage('OFFICIAL_PREFLIGHT', () => preflightOfficialScanner(config))")
    < bootstrap.indexOf('return await operation({ config, built'))
  assert.ok(bootstrap.indexOf('return await operation({ config, built') < bootstrap.indexOf("await atStage('CLEANUP'"))
})

test('manual workflow isolates the only application secret to the final invocation', async () => {
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
  const invocation = job.indexOf('      - name: Authenticate official snapshot and process at most one TEST offering document')
  assert.ok(invocation > 0)
  assert.doesNotMatch(job.slice(0, invocation), /\$\{\{ secrets\.|BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY/)
  assert.equal((job.match(/\$\{\{ secrets\./g) ?? []).length, 1)
  assert.match(job.slice(invocation), /BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: \$\{\{ secrets\.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY \}\}/)
  assert.doesNotMatch(job, /upload-artifact|npm |set -x|id-token: write|contents: write/)
})
