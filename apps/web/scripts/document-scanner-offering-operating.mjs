import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAMAV_EXECUTABLE_SHA256, CLAMAV_PACKAGE_SHA256, CLAMAV_VERSION, TEST_ORIGIN,
  recoverRecordedResult, runOfferingOnce, runOnce, runnerConfig, runnerRecoveryConfig } from './document-scanner-runner.mjs'
import { officialProofFailureReceipt, withOfficialCloudSnapshot } from './document-scanner-official-proof.mjs'
import { OFFICIAL_SNAPSHOT_COVERAGE } from './document-scanner-snapshot.mjs'

export const OPERATING_REPOSITORY = 'GulfBrick/BlockXOne'
export const OPERATING_REF = 'refs/heads/codex/stage2-sandbox-completion-20261011'
export const OPERATING_PROJECT = 'fegnnnlseuejkrusbbkv'
export const OPERATING_WORKER = 'bx1-test-offering-document-worker-v1'
export const OPERATING_SCANNER = 'bx1-test-clamav-1-4-6-official-v1'
const WORKFLOW = `${OPERATING_REPOSITORY}/.github/workflows/bx1-demo-fund-compile.yml@${OPERATING_REF}`
const OUTCOMES = new Set(['EMPTY_QUEUE', 'RESULT_ACCEPTED', 'CLAIM_RECOVERY_REQUIRED', 'RESULT_RECOVERY_REQUIRED',
  'PROCESSING_FAILED', 'LEASE_EXPIRED', 'FAILURE_UNCONFIRMED'])

/** Select one existing producer; never claim both queues or infer a default. */
export function operatingProducer(scope) {
  if (scope === 'OFFERING') return runOfferingOnce
  if (scope === 'ADMISSION') return runOnce
  throw new Error('TEST document worker scope rejected.')
}

export function operatingScopeLabel(scope) {
  if (scope === 'OFFERING') return 'TEST_OFFERING_DOCUMENT_WORKER'
  if (scope === 'ADMISSION') return 'TEST_ADMISSION_DOCUMENT_WORKER'
  throw new Error('TEST document worker scope rejected.')
}

/** These guards supplement, not replace, the protected GitHub environment. */
export function validateOperatingEnvironment(env = process.env, platform = process.platform) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REPOSITORY !== OPERATING_REPOSITORY || env.GITHUB_REF !== OPERATING_REF
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW || env.GITHUB_JOB !== 'offering-document-scanner-operating'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') || env.BX1_SCANNER_APPROVED_SOURCE_COMMIT !== env.GITHUB_SHA
    || env.BX1_SCANNER_OPERATING_CLOUD_RUN !== 'test-offering-scanner-v1'
    || env.BX1_SCANNER_PACKAGE_SHA256 !== CLAMAV_PACKAGE_SHA256
    || env.BX1_SCANNER_PROJECT_REF !== OPERATING_PROJECT
    || env.BLOCKXONE_ENVIRONMENT !== 'TESTNET' || env.BLOCKXONE_APP_ORIGIN !== TEST_ORIGIN
    || env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID !== OPERATING_WORKER
    || env.BLOCKXONE_DOCUMENT_SCANNER_ID !== OPERATING_SCANNER
    || !['OFFERING', 'ADMISSION'].includes(env.BX1_SCANNER_SCOPE)
    || !['CLAIM', 'RECOVER'].includes(env.BX1_SCANNER_OPERATION)
    || (env.BX1_SCANNER_OPERATION === 'RECOVER' && env.BX1_SCANNER_SCOPE !== 'ADMISSION')) {
    throw new Error('TEST document worker operating environment rejected.')
  }
  return Object.freeze({ sourceCommit: env.GITHUB_SHA, scope: env.BX1_SCANNER_SCOPE, operation: env.BX1_SCANNER_OPERATION })
}

/** Private protected-environment metadata; never place this binding in logs. */
export function recordedRecoveryBinding(value) {
  let binding
  try {
    if (typeof value !== 'string' || value.length > 512) throw new Error()
    binding = JSON.parse(value)
  } catch { throw new Error('Recorded result recovery binding rejected.') }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join('|') !== 'attempt_id|authority_epoch|document_id'
    || ![binding.document_id, binding.attempt_id].every(id => typeof id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
      && id !== '00000000-0000-0000-0000-000000000000')
    || !Number.isSafeInteger(binding.authority_epoch) || binding.authority_epoch < 1) {
    throw new Error('Recorded result recovery binding rejected.')
  }
  return Object.freeze({ ...binding })
}

export function recordedRecoveryReceipt(result, sourceCommit) {
  if (!result || !['RECORDED_RESULT_RECOVERED', 'RECORDED_RESULT_RECOVERY_REQUIRED'].includes(result.outcome)
    || !/^[0-9a-f]{40}$/.test(sourceCommit)
    || (result.outcome === 'RECORDED_RESULT_RECOVERED' && !['SCANNED_CLEAN', 'REJECTED'].includes(result.state))) {
    throw new Error('Recorded result recovery receipt rejected.')
  }
  return { scope: 'TEST_ADMISSION_DOCUMENT_RESULT_RECOVERY', sourceCommit, outcome: result.outcome,
    ...(result.outcome === 'RECORDED_RESULT_RECOVERED' ? { state: result.state } : {}),
    evidenceSource: 'ORIGINAL_IMMUTABLE_SCAN_EVENT', newScanPerformed: false,
    reconciliationRequiredBeforeAnotherInvocation: result.outcome !== 'RECORDED_RESULT_RECOVERED',
    operatingMode: 'MANUAL_RECORDED_RESULT_RECOVERY_NO_SCHEDULER' }
}

/** Allowlist output: no document identifiers, hashes, bytes, paths or recovery body. */
export function operatingReceipt(result, sourceCommit, databaseSha256, scope) {
  const label = operatingScopeLabel(scope)
  if (!result || !OUTCOMES.has(result.outcome) || !/^[0-9a-f]{40}$/.test(sourceCommit)
    || !/^[0-9a-f]{64}$/.test(databaseSha256)) throw new Error('Operating result rejected.')
  const complete = result.outcome === 'EMPTY_QUEUE' || result.outcome === 'RESULT_ACCEPTED'
  if (result.outcome === 'RESULT_ACCEPTED' && (!['CLEAN', 'MALICIOUS'].includes(result.verdict)
    || result.engine?.version !== CLAMAV_VERSION || result.engine?.executableSha256 !== CLAMAV_EXECUTABLE_SHA256
    || result.engine?.databaseSha256 !== databaseSha256 || result.engine?.coverage !== OFFICIAL_SNAPSHOT_COVERAGE
    || result.engine?.officialSignaturesOnly !== true || result.engine?.productionMalwareCoverageProved !== false)) {
    throw new Error('Operating acceptance receipt rejected.')
  }
  return { scope: label, sourceCommit, outcome: result.outcome,
    ...(result.outcome === 'RESULT_ACCEPTED' ? { verdict: result.verdict } : {}),
    engineVersion: CLAMAV_VERSION, databaseSha256, coverage: OFFICIAL_SNAPSHOT_COVERAGE,
    officialSignaturesOnly: true, productionMalwareCoverageProved: false,
    reconciliationRequiredBeforeAnotherInvocation: !complete,
    operatingMode: 'MANUAL_SINGLE_JOB_NO_SCHEDULER' }
}

export async function runOfferingOperatingJob() {
  const { sourceCommit, scope, operation } = validateOperatingEnvironment()
  if (operation === 'RECOVER') {
    const binding = recordedRecoveryBinding(process.env.BX1_SCANNER_RECOVERY_BINDING)
    const config = runnerRecoveryConfig()
    try { return recordedRecoveryReceipt(await recoverRecordedResult(binding, config), sourceCommit) }
    finally { config.signingKey.fill(0) }
  }
  const run = operatingProducer(scope)
  // The shared bootstrap authenticates the complete fresh official database and
  // runs the real pinned-engine preflight BEFORE this callback can make CLAIM.
  return withOfficialCloudSnapshot(async ({ config: snapshot }) => {
    const config = runnerConfig({ ...process.env, BX1_SCANNER_DATABASE_PATH: snapshot.databasePath,
      BX1_SCANNER_DATABASE_SHA256: snapshot.databaseSha256 })
    try {
      // Exactly one job in the selected queue; its existing producer preserves immutable request
      // retries. Unknown outcomes are not followed by another CLAIM or rescan.
      const result = await run(config)
      return operatingReceipt(result, sourceCommit, snapshot.databaseSha256, scope)
    } finally { config.signingKey.fill(0) }
  }, { purpose: 'OPERATING' })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfferingOperatingJob().then(receipt => {
    console.log(JSON.stringify(receipt))
    if (receipt.reconciliationRequiredBeforeAnotherInvocation) process.exitCode = 2
  }, error => {
    if (process.env.BX1_SCANNER_OPERATION === 'RECOVER') {
      console.error(JSON.stringify({ scope: 'TEST_ADMISSION_DOCUMENT_RESULT_RECOVERY', outcome: 'STOPPED_WITHOUT_RECOVERY',
        code: 'RECOVERY_NOT_CONFIRMED', reconciliationRequiredBeforeAnotherInvocation: true }))
      process.exitCode = 2
      return
    }
    const safe = officialProofFailureReceipt(error)
    // The shared bootstrap only attaches diagnostics from the credential-free
    // public updater. Never print arbitrary app exception text or .recovery.
    const scope = ['OFFERING', 'ADMISSION'].includes(process.env.BX1_SCANNER_SCOPE)
      ? operatingScopeLabel(process.env.BX1_SCANNER_SCOPE) : 'TEST_DOCUMENT_WORKER'
    console.error(JSON.stringify({ scope, outcome: 'STOPPED_WITHOUT_ACCEPTANCE',
      stage: safe.stage, code: safe.code,
      ...(safe.updaterExitCode !== undefined ? { updaterExitCode: safe.updaterExitCode } : {}),
      ...(safe.publicUpdaterDiagnostic ? { publicUpdaterDiagnostic: safe.publicUpdaterDiagnostic } : {}),
      reconciliationRequiredBeforeAnotherInvocation: true }))
    process.exitCode = 2
  })
}
