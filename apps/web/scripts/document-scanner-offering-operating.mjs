import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAMAV_EXECUTABLE_SHA256, CLAMAV_PACKAGE_SHA256, CLAMAV_VERSION, TEST_ORIGIN,
  runOfferingOnce, runnerConfig } from './document-scanner-runner.mjs'
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
    || env.BLOCKXONE_DOCUMENT_SCANNER_ID !== OPERATING_SCANNER) {
    throw new Error('TEST offering worker operating environment rejected.')
  }
  return Object.freeze({ sourceCommit: env.GITHUB_SHA })
}

/** Allowlist output: no document identifiers, hashes, bytes, paths or recovery body. */
export function operatingReceipt(result, sourceCommit, databaseSha256) {
  if (!result || !OUTCOMES.has(result.outcome) || !/^[0-9a-f]{40}$/.test(sourceCommit)
    || !/^[0-9a-f]{64}$/.test(databaseSha256)) throw new Error('Operating result rejected.')
  const complete = result.outcome === 'EMPTY_QUEUE' || result.outcome === 'RESULT_ACCEPTED'
  if (result.outcome === 'RESULT_ACCEPTED' && (!['CLEAN', 'MALICIOUS'].includes(result.verdict)
    || result.engine?.version !== CLAMAV_VERSION || result.engine?.executableSha256 !== CLAMAV_EXECUTABLE_SHA256
    || result.engine?.databaseSha256 !== databaseSha256 || result.engine?.coverage !== OFFICIAL_SNAPSHOT_COVERAGE
    || result.engine?.officialSignaturesOnly !== true || result.engine?.productionMalwareCoverageProved !== false)) {
    throw new Error('Operating acceptance receipt rejected.')
  }
  return { scope: 'TEST_OFFERING_DOCUMENT_WORKER', sourceCommit, outcome: result.outcome,
    ...(result.outcome === 'RESULT_ACCEPTED' ? { verdict: result.verdict } : {}),
    engineVersion: CLAMAV_VERSION, databaseSha256, coverage: OFFICIAL_SNAPSHOT_COVERAGE,
    officialSignaturesOnly: true, productionMalwareCoverageProved: false,
    reconciliationRequiredBeforeAnotherInvocation: !complete,
    operatingMode: 'MANUAL_SINGLE_JOB_NO_SCHEDULER' }
}

export async function runOfferingOperatingJob() {
  const { sourceCommit } = validateOperatingEnvironment()
  // The shared bootstrap authenticates the complete fresh official database and
  // runs the real pinned-engine preflight BEFORE this callback can make CLAIM.
  return withOfficialCloudSnapshot(async ({ config: snapshot }) => {
    const config = runnerConfig({ ...process.env, BX1_SCANNER_DATABASE_PATH: snapshot.databasePath,
      BX1_SCANNER_DATABASE_SHA256: snapshot.databaseSha256 })
    try {
      // Exactly one job; runOfferingOnce preserves its own immutable request
      // retries. Unknown outcomes are not followed by another CLAIM or rescan.
      const result = await runOfferingOnce(config)
      return operatingReceipt(result, sourceCommit, snapshot.databaseSha256)
    } finally { config.signingKey.fill(0) }
  }, { purpose: 'OPERATING' })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfferingOperatingJob().then(receipt => {
    console.log(JSON.stringify(receipt))
    if (receipt.reconciliationRequiredBeforeAnotherInvocation) process.exitCode = 2
  }, error => {
    const safe = officialProofFailureReceipt(error)
    // The shared bootstrap only attaches diagnostics from the credential-free
    // public updater. Never print arbitrary app exception text or .recovery.
    console.error(JSON.stringify({ scope: 'TEST_OFFERING_DOCUMENT_WORKER', outcome: 'STOPPED_WITHOUT_ACCEPTANCE',
      stage: safe.stage, code: safe.code,
      ...(safe.updaterExitCode !== undefined ? { updaterExitCode: safe.updaterExitCode } : {}),
      ...(safe.publicUpdaterDiagnostic ? { publicUpdaterDiagnostic: safe.publicUpdaterDiagnostic } : {}),
      reconciliationRequiredBeforeAnotherInvocation: true }))
    process.exitCode = 2
  })
}
