import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAMAV_EXECUTABLE_SHA256, CLAMAV_PACKAGE_SHA256, CLAMAV_VERSION, preflightOfficialScanner,
  scanWithClamav } from './document-scanner-runner.mjs'
import { makePdf } from './document-scanner-engine-proof.mjs'
import { OFFICIAL_SNAPSHOT_COVERAGE, writeOfficialSnapshot } from './document-scanner-snapshot.mjs'

const FRESHCLAM = '/usr/local/bin/freshclam'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const STAGES = new Set(['ENVIRONMENT', 'UPDATER_BINARY', 'PRIVATE_WORKSPACE', 'UPDATER_VERSION',
  'OFFICIAL_DATABASE_UPDATE', 'SNAPSHOT_BUILD', 'OFFICIAL_PREFLIGHT', 'BENIGN_SCAN', 'EICAR_SCAN', 'RECEIPT_CHECK', 'CLEANUP'])
const PUBLIC_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'ASSERTION_FAILED', 'OFFICIAL_ENGINE_PROOF_FAILED',
  'UPDATER_TIMEOUT', 'UPDATER_OUTPUT_LIMIT', 'UPDATER_SPAWN_FAILED', 'UPDATER_CONFIG_REJECTED',
  'UPDATER_DEPENDENCY_MISSING', 'UPDATER_MIRROR_FORBIDDEN', 'UPDATER_RATE_LIMITED', 'UPDATER_DNS_UNAVAILABLE',
  'UPDATER_TLS_FAILED', 'UPDATER_EXIT_FAILURE', 'INVALID_SNAPSHOT_PATH', 'INVALID_OFFICIAL_DATABASE',
  'UNSUPPORTED_DATABASE_FUNCTIONALITY', 'INVALID_DATABASE_BUILD_TIME', 'STALE_OFFICIAL_DATABASE',
  'SNAPSHOT_BUILD_FAILED', 'INVALID_SNAPSHOT_MANIFEST', 'SNAPSHOT_UNAVAILABLE', 'DATABASE_HASH_MISMATCH',
  'DATABASE_HEADER_MISMATCH', 'INCOMPLETE_SNAPSHOT_SET', 'SNAPSHOT_HASH_MISMATCH', 'CHANGED_SNAPSHOT_FILE',
  'ENGINE_UNAVAILABLE', 'ENGINE_HASH_MISMATCH', 'ENGINE_VERSION_MISMATCH', 'INCOMPLETE_SCAN', 'OFFICIAL_SNAPSHOT_REQUIRED'])

class OfficialProofFailure extends Error {
  constructor(stage, code, exitCode) {
    super('Official engine proof did not complete.')
    this.stage = STAGES.has(stage) ? stage : 'UNCLASSIFIED'
    this.code = PUBLIC_CODES.has(code) ? code : 'OFFICIAL_ENGINE_PROOF_FAILED'
    if (Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255) this.exitCode = exitCode
  }
}
async function atStage(stage, operation) {
  try { return await operation() }
  catch (error) {
    if (error instanceof OfficialProofFailure) throw error
    throw new OfficialProofFailure(stage, error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : error?.code, error?.exitCode)
  }
}
/** Only fixed public engine classifications are emitted, never exception text. */
export function officialProofFailureReceipt(error) {
  return { ok: false, proof: 'REAL_CLAMAV_OFFICIAL_SNAPSHOT_ENGINE',
    stage: error instanceof OfficialProofFailure ? error.stage : 'UNCLASSIFIED',
    code: error instanceof OfficialProofFailure ? error.code : 'OFFICIAL_ENGINE_PROOF_FAILED',
    ...(error instanceof OfficialProofFailure && error.exitCode !== undefined ? { updaterExitCode: error.exitCode } : {}) }
}
function updaterFailure(code, raw = '', exitCode) {
  if (code === 'UPDATER_EXIT_FAILURE') {
    code = /error while loading shared libraries/i.test(raw) ? 'UPDATER_DEPENDENCY_MISSING'
      : /can't open\/parse the config|config.*(?:error|unknown|invalid)/i.test(raw) ? 'UPDATER_CONFIG_REJECTED'
        : /429|too many requests|rate.limit/i.test(raw) ? 'UPDATER_RATE_LIMITED'
          : /403|forbidden|blocked by/i.test(raw) ? 'UPDATER_MIRROR_FORBIDDEN'
            : /could not resolve|can't resolve|dns.*(?:fail|error)/i.test(raw) ? 'UPDATER_DNS_UNAVAILABLE'
              : /certificate|ssl.*(?:fail|error)|tls.*(?:fail|error)/i.test(raw) ? 'UPDATER_TLS_FAILED' : code
  }
  const error = new Error('Official updater did not complete.')
  error.code = code; error.exitCode = exitCode
  return error
}

function runFreshclam(args, { directory, timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, done = false, length = 0
    const output = { stdout: [], stderr: [] }
    const stop = (code = 'UPDATER_SPAWN_FAILED') => {
      if (done) return
      done = true; clearTimeout(timer)
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
      reject(updaterFailure(code))
    }
    try {
      child = spawn(FRESHCLAM, args, { shell: false, detached: true, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: directory, TMPDIR: directory } })
      timer = setTimeout(() => stop('UPDATER_TIMEOUT'), timeoutMs)
      child.on('error', () => stop('UPDATER_SPAWN_FAILED'))
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        length += chunk.length
        if (length > 65_536) stop('UPDATER_OUTPUT_LIMIT')
        else output[stream].push(Buffer.from(chunk))
      })
      child.on('close', (code, signal) => {
        if (done) return
        done = true; clearTimeout(timer)
        if (signal || code !== 0) {
          reject(updaterFailure('UPDATER_EXIT_FAILURE', Buffer.concat([...output.stdout, ...output.stderr]).toString('utf8'), code)); return
        }
        resolve({ stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') })
      })
    } catch { stop() }
  })
}

export async function runOfficialCloudEngineProof() {
  await atStage('ENVIRONMENT', async () => {
    assert.equal(process.platform, 'linux', 'Official snapshot proof requires Linux.')
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Official snapshot proof requires GitHub Actions.')
    assert.equal(process.env.BX1_SCANNER_OFFICIAL_CLOUD_PROOF, 'github-clamav-official-1.4.6', 'Official proof identity mismatch.')
    assert.equal(process.env.BX1_SCANNER_PACKAGE_SHA256, CLAMAV_PACKAGE_SHA256, 'Package identity mismatch.')
  })
  // CI independently verifies the pinned package before installation. These
  // environment guards alone do not attest a package or an updater executable.
  const updaterSha256 = await atStage('UPDATER_BINARY', async () => {
    const info = await lstat(FRESHCLAM)
    assert.equal(info.isFile() && !(info.mode & 0o022) && await realpath(FRESHCLAM) === FRESHCLAM, true)
    return sha(await readFile(FRESHCLAM))
  })
  const temporaryParent = path.resolve(tmpdir())
  const directory = await atStage('PRIVATE_WORKSPACE', async () => {
    const value = path.resolve(await mkdtemp(path.join(temporaryParent, 'bx1-official-scanner-proof-')))
    assert.equal(path.dirname(value), temporaryParent)
    return value
  })
  const snapshotDirectory = path.join(directory, 'snapshot')
  try {
    const source = path.join(directory, 'freshclam')
    const configFile = path.join(directory, 'freshclam.conf')
    await atStage('PRIVATE_WORKSPACE', async () => {
      await chmod(directory, 0o700)
      await mkdir(source, { mode: 0o700 })
      const owner = userInfo().username
      assert.match(owner, /^[a-z_][a-z0-9_-]{0,31}$/)
      const configuration = [
        `DatabaseDirectory ${source}`, `DatabaseOwner ${owner}`, 'DatabaseMirror database.clamav.net',
        'DNSDatabaseInfo current.cvd.clamav.net', 'ScriptedUpdates no', 'Bytecode yes', 'TestDatabases yes',
        'ConnectTimeout 10', 'ReceiveTimeout 30', 'MaxAttempts 2', 'Foreground yes', 'LogVerbose no',
      ].join('\n') + '\n'
      await writeFile(configFile, configuration, { flag: 'wx', mode: 0o400 })
    })
    await atStage('UPDATER_VERSION', async () => {
      // FreshClam parses configuration BEFORE --version in its tagged1.4.6
      // main(), unlike clamscan. Never depend on an absent ambient config file.
      const version = await runFreshclam(['--config-file', configFile, '--version'], { directory, timeoutMs: 5000 })
      assert.match(version.stdout, /^ClamAV 1\.4\.6(?:\/[^\r\n]+)?\r?\n?$/)
      assert.equal(version.stderr.trim(), '')
    })
    // Fixed public official mirror only; no app endpoint, credentials or queue.
    const updated = await atStage('OFFICIAL_DATABASE_UPDATE', () => runFreshclam(['--config-file', configFile, '--datadir', source, '--stdout'], { directory }))
    const built = await atStage('SNAPSHOT_BUILD', () => writeOfficialSnapshot(source, snapshotDirectory))
    const config = { databasePath: path.join(snapshotDirectory, 'manifest.json'), databaseSha256: built.databaseSha256 }
    const preflight = await atStage('OFFICIAL_PREFLIGHT', () => preflightOfficialScanner(config))
    await atStage('OFFICIAL_PREFLIGHT', async () => assert.equal(preflight.coverage, OFFICIAL_SNAPSHOT_COVERAGE))
    const benign = makePdf('BlockXOne harmless official database scanner proof')
    // Standard harmless antivirus test bytes. This is engine evidence, not a
    // claim that this text file passes the application's PDF evidence profile.
    const eicar = Buffer.from(['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''), 'ascii')
    await atStage('RECEIPT_CHECK', async () => assert.equal(eicar.length, 68))
    const clean = await atStage('BENIGN_SCAN', () => scanWithClamav(benign, config))
    const detected = await atStage('EICAR_SCAN', () => scanWithClamav(eicar, config))
    await atStage('RECEIPT_CHECK', async () => { for (const [receipt, bytes, verdict] of [[clean, benign, 'CLEAN'], [detected, eicar, 'MALICIOUS']]) {
      assert.equal(receipt.verdict, verdict)
      assert.equal(receipt.engineVersion, CLAMAV_VERSION)
      assert.equal(receipt.engineSha256, CLAMAV_EXECUTABLE_SHA256)
      assert.equal(receipt.databaseSha256, built.databaseSha256)
      assert.equal(receipt.sha256, sha(bytes))
      assert.equal(receipt.coverage, OFFICIAL_SNAPSHOT_COVERAGE)
      assert.equal(receipt.officialSignaturesOnly, true)
      assert.equal(receipt.productionMalwareCoverageProved, false)
    } })
    return { ok: true, proof: 'REAL_CLAMAV_OFFICIAL_SNAPSHOT_ENGINE', engineVersion: CLAMAV_VERSION,
      packageSha256: CLAMAV_PACKAGE_SHA256, executableSha256: CLAMAV_EXECUTABLE_SHA256, updaterSha256,
      databaseSha256: built.databaseSha256, coverage: built.coverage, databases: built.databases,
      updaterStderrPresent: Boolean(updated.stderr.trim()), officialSignaturesOnly: true,
      productionMalwareCoverageProved: false, hostedWorkerAcceptanceProved: false,
      benign: { mimeType: 'application/pdf', verdict: clean.verdict, sha256: clean.sha256 },
      detected: { fixture: 'STANDARD_HARMLESS_EICAR_TEXT_NOT_APPLICATION_PDF', verdict: detected.verdict, sha256: detected.sha256 } }
  } finally {
    await atStage('CLEANUP', async () => {
      await chmod(snapshotDirectory, 0o700).catch(() => {})
      await rm(directory, { recursive: true, force: true })
    })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfficialCloudEngineProof().then(receipt => console.log(JSON.stringify(receipt)), error => {
    console.error(JSON.stringify(officialProofFailureReceipt(error)))
    process.exitCode = 1
  })
}
