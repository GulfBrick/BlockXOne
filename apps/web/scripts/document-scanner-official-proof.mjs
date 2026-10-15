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

function runFreshclam(args, { directory, timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, done = false, length = 0
    const output = { stdout: [], stderr: [] }
    const stop = () => {
      if (done) return
      done = true; clearTimeout(timer)
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
      reject(new Error('Official updater did not complete.'))
    }
    try {
      child = spawn(FRESHCLAM, args, { shell: false, detached: true, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: directory, TMPDIR: directory } })
      timer = setTimeout(stop, timeoutMs)
      child.on('error', stop)
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        length += chunk.length
        if (length > 65_536) stop()
        else output[stream].push(Buffer.from(chunk))
      })
      child.on('close', (code, signal) => {
        if (done) return
        done = true; clearTimeout(timer)
        if (signal || code !== 0) { reject(new Error('Official updater did not complete.')); return }
        resolve({ stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') })
      })
    } catch { stop() }
  })
}

export async function runOfficialCloudEngineProof() {
  assert.equal(process.platform, 'linux', 'Official snapshot proof requires Linux.')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Official snapshot proof requires GitHub Actions.')
  assert.equal(process.env.BX1_SCANNER_OFFICIAL_CLOUD_PROOF, 'github-clamav-official-1.4.6', 'Official proof identity mismatch.')
  assert.equal(process.env.BX1_SCANNER_PACKAGE_SHA256, CLAMAV_PACKAGE_SHA256, 'Package identity mismatch.')
  // CI independently verifies the pinned package before installation. These
  // environment guards alone do not attest a package or an updater executable.
  const info = await lstat(FRESHCLAM)
  assert.equal(info.isFile() && !(info.mode & 0o022) && await realpath(FRESHCLAM) === FRESHCLAM, true)
  const updaterSha256 = sha(await readFile(FRESHCLAM))
  const temporaryParent = path.resolve(tmpdir())
  const directory = path.resolve(await mkdtemp(path.join(temporaryParent, 'bx1-official-scanner-proof-')))
  assert.equal(path.dirname(directory), temporaryParent)
  const snapshotDirectory = path.join(directory, 'snapshot')
  try {
    await chmod(directory, 0o700)
    const source = path.join(directory, 'freshclam')
    await mkdir(source, { mode: 0o700 })
    const owner = userInfo().username
    assert.match(owner, /^[a-z_][a-z0-9_-]{0,31}$/)
    const configuration = [
      `DatabaseDirectory ${source}`, `DatabaseOwner ${owner}`, 'DatabaseMirror database.clamav.net',
      'DNSDatabaseInfo current.cvd.clamav.net', 'ScriptedUpdates no', 'Bytecode yes', 'TestDatabases yes',
      'ConnectTimeout 10', 'ReceiveTimeout 30', 'MaxAttempts 2', 'Foreground yes', 'LogVerbose no',
    ].join('\n') + '\n'
    const configFile = path.join(directory, 'freshclam.conf')
    await writeFile(configFile, configuration, { flag: 'wx', mode: 0o400 })
    const version = await runFreshclam(['--version'], { directory, timeoutMs: 5000 })
    assert.match(version.stdout, /^ClamAV 1\.4\.6(?:\/[^\r\n]+)?\r?\n?$/)
    assert.equal(version.stderr.trim(), '')
    // Fixed public official mirror only; no app endpoint, credentials or queue.
    const updated = await runFreshclam(['--config-file', configFile, '--datadir', source, '--stdout'], { directory })
    const built = await writeOfficialSnapshot(source, snapshotDirectory)
    const config = { databasePath: path.join(snapshotDirectory, 'manifest.json'), databaseSha256: built.databaseSha256 }
    const preflight = await preflightOfficialScanner(config)
    assert.equal(preflight.coverage, OFFICIAL_SNAPSHOT_COVERAGE)
    const benign = makePdf('BlockXOne harmless official database scanner proof')
    // Standard harmless antivirus test bytes. This is engine evidence, not a
    // claim that this text file passes the application's PDF evidence profile.
    const eicar = Buffer.from(['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''), 'ascii')
    assert.equal(eicar.length, 68)
    const clean = await scanWithClamav(benign, config)
    const detected = await scanWithClamav(eicar, config)
    for (const [receipt, bytes, verdict] of [[clean, benign, 'CLEAN'], [detected, eicar, 'MALICIOUS']]) {
      assert.equal(receipt.verdict, verdict)
      assert.equal(receipt.engineVersion, CLAMAV_VERSION)
      assert.equal(receipt.engineSha256, CLAMAV_EXECUTABLE_SHA256)
      assert.equal(receipt.databaseSha256, built.databaseSha256)
      assert.equal(receipt.sha256, sha(bytes))
      assert.equal(receipt.coverage, OFFICIAL_SNAPSHOT_COVERAGE)
      assert.equal(receipt.officialSignaturesOnly, true)
      assert.equal(receipt.productionMalwareCoverageProved, false)
    }
    return { ok: true, proof: 'REAL_CLAMAV_OFFICIAL_SNAPSHOT_ENGINE', engineVersion: CLAMAV_VERSION,
      packageSha256: CLAMAV_PACKAGE_SHA256, executableSha256: CLAMAV_EXECUTABLE_SHA256, updaterSha256,
      databaseSha256: built.databaseSha256, coverage: built.coverage, databases: built.databases,
      updaterStderrPresent: Boolean(updated.stderr.trim()), officialSignaturesOnly: true,
      productionMalwareCoverageProved: false, hostedWorkerAcceptanceProved: false,
      benign: { mimeType: 'application/pdf', verdict: clean.verdict, sha256: clean.sha256 },
      detected: { fixture: 'STANDARD_HARMLESS_EICAR_TEXT_NOT_APPLICATION_PDF', verdict: detected.verdict, sha256: detected.sha256 } }
  } finally {
    await chmod(snapshotDirectory, 0o700).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfficialCloudEngineProof().then(receipt => console.log(JSON.stringify(receipt)), () => {
    console.error(JSON.stringify({ ok: false, proof: 'REAL_CLAMAV_OFFICIAL_SNAPSHOT_ENGINE', code: 'OFFICIAL_ENGINE_PROOF_FAILED' }))
    process.exitCode = 1
  })
}
