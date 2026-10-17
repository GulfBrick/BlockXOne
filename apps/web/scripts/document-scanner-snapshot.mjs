import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SNAPSHOT_ENGINE_VERSION = '1.4.6'
export const OFFICIAL_SNAPSHOT_COVERAGE = 'OFFICIAL_MAIN_DAILY_BYTECODE_SNAPSHOT'
export const FIXTURE_SNAPSHOT_COVERAGE = 'CUSTOM_HARMLESS_FIXTURE_ONLY'
export const OFFICIAL_DATABASE_NAMES = Object.freeze(['main.cvd', 'daily.cvd', 'bytecode.cvd'])
export const SNAPSHOT_MANIFEST_NAME = 'manifest.json'
export const MAX_DAILY_AGE_SECONDS = 72 * 60 * 60
export const MAX_FUTURE_BUILD_SECONDS = 5 * 60
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 768 * 1024 * 1024
const HASH = /^[0-9a-f]{64}$/
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')

/** Do not include a path, database header or caller input in an error. */
export class ScannerSnapshotError extends Error {
  constructor(code) { super(`Private scanner snapshot: ${code}.`); this.name = 'ScannerSnapshotError'; this.code = code }
}
const reject = code => { throw new ScannerSnapshotError(code) }
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value
const positive = value => Number.isSafeInteger(value) && value > 0

function assertBuildTime(seconds, name, now) {
  if (!positive(seconds) || !Number.isFinite(now) || seconds > Math.floor(now / 1000) + MAX_FUTURE_BUILD_SECONDS)
    reject('INVALID_DATABASE_BUILD_TIME')
  // Main/bytecode are intentionally less frequent releases. Only the published
  // daily database build time controls freshness; a local fetchedAt cannot renew it.
  if (name === 'daily.cvd' && Math.floor(now / 1000) - seconds > MAX_DAILY_AGE_SECONDS)
    reject('STALE_OFFICIAL_DATABASE')
}

/** Header metadata is not authenticity proof. ClamAV must verify each signed CVD. */
export function readOfficialCvdHeader(bytes, name, now = Date.now()) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 513 || bytes.byteLength > MAX_DATABASE_BYTES
    || !OFFICIAL_DATABASE_NAMES.includes(name)) reject('INVALID_OFFICIAL_DATABASE')
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, 512)
  if (raw.some(value => value > 127)) reject('INVALID_OFFICIAL_DATABASE')
  const header = raw.toString('ascii').replace(/\0+$/, '').trimEnd()
  const fields = header.split(':')
  if (fields.length !== 9 || fields[0] !== 'ClamAV-VDB' || !/^[\x20-\x7e]{1,80}$/.test(fields[1])
    || !fields.slice(2, 5).every(value => /^[1-9][0-9]{0,10}$/.test(value))
    || !/^[0-9a-f]{32}$/.test(fields[5]) || !/^[A-Za-z0-9+/=]{32,256}$/.test(fields[6])
    || !/^[A-Za-z0-9_.-]{1,48}$/.test(fields[7]) || !/^[1-9][0-9]{8,10}$/.test(fields[8]))
    reject('INVALID_OFFICIAL_DATABASE')
  const [version, signatures, functionalityLevel] = fields.slice(2, 5).map(Number)
  const publishedAt = Number(fields[8])
  if (![version, signatures, functionalityLevel].every(positive) || functionalityLevel > 216)
    reject('UNSUPPORTED_DATABASE_FUNCTIONALITY')
  assertBuildTime(publishedAt, name, now)
  return Object.freeze({ version, signatures, functionality_level: functionalityLevel, published_at: publishedAt })
}

export function validateOfficialSnapshotManifest(value, now = Date.now()) {
  if (!exact(value, ['schema_version', 'source', 'engine_version', 'coverage', 'databases'])
    || value.schema_version !== 1 || value.source !== 'CLAMAV_OFFICIAL_SIGNED_CVD'
    || value.engine_version !== SNAPSHOT_ENGINE_VERSION || value.coverage !== OFFICIAL_SNAPSHOT_COVERAGE
    || !Array.isArray(value.databases) || value.databases.length !== 3) reject('INVALID_SNAPSHOT_MANIFEST')
  const databases = value.databases.map((entry, index) => {
    if (!exact(entry, ['name', 'size', 'sha256', 'version', 'signatures', 'functionality_level', 'published_at'])
      || entry.name !== OFFICIAL_DATABASE_NAMES[index] || !positive(entry.size) || entry.size < 513
      || entry.size > MAX_DATABASE_BYTES || !HASH.test(entry.sha256 ?? '')
      || ![entry.version, entry.signatures, entry.functionality_level].every(positive)
      || entry.functionality_level > 216) reject('INVALID_SNAPSHOT_MANIFEST')
    assertBuildTime(entry.published_at, entry.name, now)
    return Object.freeze({ ...entry })
  })
  if (databases.reduce((sum, entry) => sum + entry.size, 0) > MAX_SNAPSHOT_BYTES) reject('INVALID_SNAPSHOT_MANIFEST')
  return Object.freeze({ ...value, databases: Object.freeze(databases) })
}

async function checkedDirectory(directory, immutable) {
  if (!absolute(directory)) reject('INVALID_SNAPSHOT_PATH')
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & (immutable ? 0o222 : 0o022))
    || await realpath(directory) !== directory) reject('INVALID_SNAPSHOT_PATH')
}

async function readRegularFile(filename, maxBytes, immutable) {
  if (!absolute(filename) || await realpath(filename) !== filename) reject('INVALID_SNAPSHOT_PATH')
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maxBytes
    || (info.mode & (immutable ? 0o222 : 0o022))) reject('INVALID_SNAPSHOT_PATH')
  let handle
  try {
    // NOFOLLOW closes the leaf-symlink race after lstat/realpath. The open inode,
    // size and timestamps are checked again; reads cannot exceed the size bound.
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const before = await handle.stat()
    if (!before.isFile() || before.ino !== info.ino || before.dev !== info.dev || before.size !== info.size
      || before.nlink !== 1 || (before.mode & (immutable ? 0o222 : 0o022))) reject('INVALID_SNAPSHOT_PATH')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (result.bytesRead === 0) break
      length += result.bytesRead
    }
    const after = await handle.stat()
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || after.nlink !== 1 || (after.mode & (immutable ? 0o222 : 0o022)))
      reject('CHANGED_SNAPSHOT_FILE')
    return bytes.subarray(0, length)
  } finally { if (handle) await handle.close() }
}

/** Load only the complete reviewed set; no ambient/default signature directory. */
export async function loadOfficialSnapshot(manifestPath, manifestSha256, { clock = Date.now } = {}) {
  try {
    if (!absolute(manifestPath) || path.basename(manifestPath) !== SNAPSHOT_MANIFEST_NAME
      || !HASH.test(manifestSha256 ?? '')) reject('INVALID_SNAPSHOT_PATH')
    const directory = path.dirname(manifestPath)
    await checkedDirectory(directory, true)
    const names = await readdir(directory)
    if (names.sort().join('|') !== [...OFFICIAL_DATABASE_NAMES, SNAPSHOT_MANIFEST_NAME].sort().join('|'))
      reject('INCOMPLETE_SNAPSHOT_SET')
    const raw = await readRegularFile(manifestPath, 16_384, true)
    if (sha(raw) !== manifestSha256) reject('SNAPSHOT_HASH_MISMATCH')
    let value
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)) }
    catch { reject('INVALID_SNAPSHOT_MANIFEST') }
    const manifest = validateOfficialSnapshotManifest(value, clock())
    const databases = []
    for (const entry of manifest.databases) {
      const bytes = await readRegularFile(path.join(directory, entry.name), entry.size, true)
      if (bytes.length !== entry.size || sha(bytes) !== entry.sha256) reject('DATABASE_HASH_MISMATCH')
      const header = readOfficialCvdHeader(bytes, entry.name, clock())
      for (const key of ['version', 'signatures', 'functionality_level', 'published_at']) {
        if (header[key] !== entry[key]) reject('DATABASE_HEADER_MISMATCH')
      }
      databases.push(Object.freeze({ ...entry, bytes }))
    }
    // Recheck time after disk reads, not just when a manifest object was parsed.
    validateOfficialSnapshotManifest(manifest, clock())
    return Object.freeze({ manifest, sha256: manifestSha256, coverage: OFFICIAL_SNAPSHOT_COVERAGE,
      databases: Object.freeze(databases) })
  } catch (error) { if (error instanceof ScannerSnapshotError) throw error; reject('SNAPSHOT_UNAVAILABLE') }
}

/** Cloud-only builder. FreshClam acquires/verifies CVDs separately; this never downloads. */
export async function writeOfficialSnapshot(sourceDirectory, destinationDirectory, { clock = Date.now } = {}) {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') reject('CLOUD_BUILD_REQUIRED')
  let created = false
  try {
    if (!absolute(destinationDirectory) || path.dirname(destinationDirectory) === destinationDirectory
      || destinationDirectory === sourceDirectory) reject('INVALID_SNAPSHOT_PATH')
    await checkedDirectory(sourceDirectory, false)
    await checkedDirectory(path.dirname(destinationDirectory), false)
    const databases = []
    let total = 0
    for (const name of OFFICIAL_DATABASE_NAMES) {
      const bytes = await readRegularFile(path.join(sourceDirectory, name), MAX_DATABASE_BYTES, false)
      total += bytes.length
      if (total > MAX_SNAPSHOT_BYTES) reject('INVALID_SNAPSHOT_MANIFEST')
      databases.push({ name, size: bytes.length, sha256: sha(bytes), ...readOfficialCvdHeader(bytes, name, clock()), bytes })
    }
    const manifest = validateOfficialSnapshotManifest({ schema_version: 1, source: 'CLAMAV_OFFICIAL_SIGNED_CVD',
      engine_version: SNAPSHOT_ENGINE_VERSION, coverage: OFFICIAL_SNAPSHOT_COVERAGE,
      databases: databases.map(({ bytes: _bytes, ...entry }) => entry) }, clock())
    await mkdir(destinationDirectory, { mode: 0o700 })
    created = true
    for (const entry of databases) await writeFile(path.join(destinationDirectory, entry.name), entry.bytes, { flag: 'wx', mode: 0o400 })
    const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await writeFile(path.join(destinationDirectory, SNAPSHOT_MANIFEST_NAME), raw, { flag: 'wx', mode: 0o400 })
    await chmod(destinationDirectory, 0o500)
    const manifestSha256 = sha(raw)
    const snapshot = await loadOfficialSnapshot(path.join(destinationDirectory, SNAPSHOT_MANIFEST_NAME), manifestSha256, { clock })
    return Object.freeze({ databaseSha256: manifestSha256, coverage: snapshot.coverage,
      productionMalwareCoverageProved: false, databases: snapshot.manifest.databases })
  } catch (error) {
    if (created) {
      // Exact directory created here, never source/parent/workspace cleanup.
      await chmod(destinationDirectory, 0o700).catch(() => {})
      await rm(destinationDirectory, { recursive: true, force: true }).catch(() => {})
    }
    if (error instanceof ScannerSnapshotError) throw error
    reject('SNAPSHOT_BUILD_FAILED')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== 'build') reject('INVALID_SNAPSHOT_COMMAND')
    console.log(JSON.stringify(await writeOfficialSnapshot(process.argv[3], process.argv[4])))
  } catch { console.error('Official scanner snapshot build stopped without acceptance.'); process.exitCode = 2 }
}
