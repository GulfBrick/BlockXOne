import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { MAX_DAILY_AGE_SECONDS, MAX_FUTURE_BUILD_SECONDS, OFFICIAL_DATABASE_NAMES, OFFICIAL_SNAPSHOT_COVERAGE,
  SNAPSHOT_ENGINE_VERSION, ScannerSnapshotError, loadOfficialSnapshot, readOfficialCvdHeader,
  validateOfficialSnapshotManifest, writeOfficialSnapshot } from './document-scanner-snapshot.mjs'

// Synthetic headers test parsing/identity/path/freshness only. These are NOT signed
// ClamAV containers, are never passed to an engine here and cannot prove authenticity.
const now = Date.UTC(2026, 9, 15, 12)
const clock = () => now
const hash = value => createHash('sha256').update(value).digest('hex')
const code = expected => error => error instanceof ScannerSnapshotError && error.code === expected
const publishedAt = name => Math.floor(now / 1000) - (name === 'daily.cvd' ? 3600 : 366 * 24 * 3600)
function cvd(name, { version = name === 'main.cvd' ? 70 : name === 'daily.cvd' ? 30000 : 341,
  signatures = name === 'bytecode.cvd' ? 90 : 2_000_000, published = publishedAt(name), functionality = 90 } = {}) {
  const header = `ClamAV-VDB:15 Oct 2026 11-00 +0000:${version}:${signatures}:${functionality}:${'a'.repeat(32)}:${'A'.repeat(128)}:fixture:${published}`
  assert.ok(header.length < 512)
  return Buffer.concat([Buffer.from(header.padEnd(512, ' '), 'ascii'), Buffer.from('Synthetic header parser bytes; not a signed database.')])
}
function makeManifest(databases = OFFICIAL_DATABASE_NAMES.map(name => ({ name, bytes: cvd(name) }))) {
  return { schema_version: 1, source: 'CLAMAV_OFFICIAL_SIGNED_CVD', engine_version: SNAPSHOT_ENGINE_VERSION,
    coverage: OFFICIAL_SNAPSHOT_COVERAGE, databases: databases.map(({ name, bytes }) => ({ name, size: bytes.length,
      sha256: hash(bytes), ...readOfficialCvdHeader(bytes, name, now) })) }
}

async function privateFixture(callback, { manifest = makeManifest(), extra, databaseBytes = {} } = {}) {
  const parent = path.resolve(await mkdtemp(path.join(path.resolve(tmpdir()), 'bx1-snapshot-test-')))
  const directory = path.join(parent, 'snapshot')
  try {
    await chmod(parent, 0o700)
    await mkdir(directory, { mode: 0o700 })
    for (const name of OFFICIAL_DATABASE_NAMES) await writeFile(path.join(directory, name), databaseBytes[name] ?? cvd(name), { mode: 0o400, flag: 'wx' })
    if (extra) await writeFile(path.join(directory, extra), 'Unmanifested signature', { mode: 0o400, flag: 'wx' })
    const raw = Buffer.from(`${JSON.stringify(manifest)}\n`)
    const manifestPath = path.join(directory, 'manifest.json')
    await writeFile(manifestPath, raw, { mode: 0o400, flag: 'wx' })
    await chmod(directory, 0o500)
    return await callback({ parent, directory, manifestPath, manifestSha256: hash(raw), manifest })
  } finally {
    await chmod(directory, 0o700).catch(() => {})
    await rm(parent, { recursive: true, force: true })
  }
}

test('official manifest names the complete main/daily/bytecode set and exact pinned engine', () => {
  const manifest = makeManifest()
  assert.deepEqual(validateOfficialSnapshotManifest(manifest, now), manifest)
  assert.deepEqual(manifest.databases.map(entry => entry.name), ['main.cvd', 'daily.cvd', 'bytecode.cvd'])
  for (const delta of [{ schema_version: 2 }, { source: 'CUSTOM' }, { engine_version: '1.4.5' },
    { coverage: 'CLEAN' }, { fetchedAt: new Date(now).toISOString() }, { databases: manifest.databases.slice(1) },
    { databases: [...manifest.databases, manifest.databases[0]] }, { databases: [...manifest.databases].reverse() },
    { databases: [manifest.databases[0], manifest.databases[0], manifest.databases[2]] }]) {
    assert.throws(() => validateOfficialSnapshotManifest({ ...manifest, ...delta }, now), ScannerSnapshotError)
  }
  for (const delta of [{ name: '../daily.cvd' }, { name: 'daily.cld' }, { name: '/daily.cvd' }, { size: 0 },
    { size: 512 }, { size: 512 * 1024 * 1024 + 1 }, { sha256: 'A'.repeat(64) }, { version: 0 },
    { signatures: 0 }, { functionality_level: 217 }, { url: 'https://database.clamav.net/daily.cvd' }]) {
    const changed = structuredClone(manifest)
    changed.databases[1] = { ...changed.databases[1], ...delta }
    assert.throws(() => validateOfficialSnapshotManifest(changed, now), ScannerSnapshotError)
  }
  const oversized = structuredClone(manifest)
  for (const entry of oversized.databases) entry.size = 512 * 1024 * 1024
  assert.throws(() => validateOfficialSnapshotManifest(oversized, now), code('INVALID_SNAPSHOT_MANIFEST'))
})

test('freshness uses published daily build time, permits old main/bytecode and rejects future builds', () => {
  const manifest = makeManifest()
  assert.ok(manifest.databases[0].published_at < Math.floor(now / 1000) - MAX_DAILY_AGE_SECONDS)
  assert.ok(manifest.databases[2].published_at < Math.floor(now / 1000) - MAX_DAILY_AGE_SECONDS)
  const boundary = structuredClone(manifest)
  boundary.databases[1].published_at = Math.floor(now / 1000) - MAX_DAILY_AGE_SECONDS
  assert.doesNotThrow(() => validateOfficialSnapshotManifest(boundary, now))
  boundary.databases[1].published_at--
  assert.throws(() => validateOfficialSnapshotManifest(boundary, now), code('STALE_OFFICIAL_DATABASE'))
  for (let index = 0; index < 3; index++) {
    const future = structuredClone(manifest)
    future.databases[index].published_at = Math.floor(now / 1000) + MAX_FUTURE_BUILD_SECONDS + 1
    assert.throws(() => validateOfficialSnapshotManifest(future, now), code('INVALID_DATABASE_BUILD_TIME'))
  }
})

test('CVD header parser rejects incomplete, arbitrary, unsupported and stale metadata, not just a JSON claim', () => {
  const bytes = cvd('daily.cvd')
  assert.equal(readOfficialCvdHeader(bytes, 'daily.cvd', now).version, 30000)
  for (const [value, name] of [[Buffer.alloc(512), 'daily.cvd'], [bytes, 'daily.cld'],
    [Buffer.from('A'.repeat(600)), 'daily.cvd'], [cvd('daily.cvd', { functionality: 217 }), 'daily.cvd'],
    [cvd('daily.cvd', { signatures: 0 }), 'daily.cvd'],
    [cvd('daily.cvd', { published: Math.floor(now / 1000) - MAX_DAILY_AGE_SECONDS - 1 }), 'daily.cvd']]) {
    assert.throws(() => readOfficialCvdHeader(value, name, now), ScannerSnapshotError)
  }
})

test('loader binds all three complete bytes, versions and snapshot hash without claiming authentication', async () => {
  await privateFixture(async fixture => {
    const result = await loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock })
    assert.equal(result.coverage, OFFICIAL_SNAPSHOT_COVERAGE)
    assert.equal(result.sha256, fixture.manifestSha256)
    assert.deepEqual(result.manifest, fixture.manifest)
    assert.deepEqual(result.databases.map(entry => entry.name), [...OFFICIAL_DATABASE_NAMES])
    assert.equal('officialSignatureVerificationProved' in result, false)
    for (const entry of result.databases) assert.equal(hash(entry.bytes), entry.sha256)
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, 'b'.repeat(64), { clock }), code('SNAPSHOT_HASH_MISMATCH'))
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256,
      { clock: () => now + (MAX_DAILY_AGE_SECONDS + 1) * 1000 }), code('STALE_OFFICIAL_DATABASE'))
  })
})

test('missing, duplicate and unmanifested signature files cannot become an official scan directory', async () => {
  await privateFixture(async fixture => {
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('INCOMPLETE_SNAPSHOT_SET'))
  }, { extra: 'unreviewed.ndb' })
  await privateFixture(async fixture => {
    await chmod(fixture.directory, 0o700)
    await rm(path.join(fixture.directory, 'bytecode.cvd'))
    await chmod(fixture.directory, 0o500)
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('INCOMPLETE_SNAPSHOT_SET'))
  })
})

test('byte tampering and header/manifest disagreement cannot pass the content pins', async () => {
  await privateFixture(async fixture => {
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('DATABASE_HASH_MISMATCH'))
  }, { databaseBytes: { 'daily.cvd': cvd('daily.cvd', { version: 30001 }) } })
  const wrongVersion = makeManifest()
  wrongVersion.databases[1].version++
  await privateFixture(async fixture => {
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('DATABASE_HEADER_MISMATCH'))
  }, { manifest: wrongVersion })
})

test('symlinks, hardlinks, writable snapshots and non-canonical paths are denied', async () => {
  await privateFixture(async fixture => {
    for (const pathname of ['relative/manifest.json', path.join(fixture.directory, 'other.json'),
      `${fixture.directory}${path.sep}..${path.sep}snapshot${path.sep}manifest.json`]) {
      await assert.rejects(loadOfficialSnapshot(pathname, fixture.manifestSha256, { clock }), ScannerSnapshotError)
    }
    await chmod(path.join(fixture.directory, 'daily.cvd'), 0o600)
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('INVALID_SNAPSHOT_PATH'))
    await chmod(path.join(fixture.directory, 'daily.cvd'), 0o400)
    await chmod(fixture.directory, 0o700)
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('INVALID_SNAPSHOT_PATH'))
  })
  for (const kind of ['symlink', 'hardlink']) await privateFixture(async fixture => {
    const filename = path.join(fixture.directory, 'daily.cvd')
    const outside = path.join(fixture.parent, 'external.cvd')
    await writeFile(outside, await readFile(filename), { mode: 0o400 })
    await chmod(fixture.directory, 0o700)
    await rm(filename)
    if (kind === 'symlink') await symlink(outside, filename)
    else await link(outside, filename)
    await chmod(fixture.directory, 0o500)
    await assert.rejects(loadOfficialSnapshot(fixture.manifestPath, fixture.manifestSha256, { clock }), code('INVALID_SNAPSHOT_PATH'))
  })
})

test('cloud builder creates a new immutable complete set, never overwrites or includes ambient signatures', async () => {
  // The parent workflow is cloud-only; do not turn this into a local scanner install.
  assert.equal(process.platform, 'linux')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  await privateFixture(async fixture => {
    // FreshClam source need not be immutable and may contain unrelated state.
    await chmod(fixture.directory, 0o700)
    await writeFile(path.join(fixture.directory, 'freshclam.dat'), 'Synthetic updater state', { mode: 0o600 })
    const destination = path.join(fixture.parent, 'built')
    try {
      const receipt = await writeOfficialSnapshot(fixture.directory, destination, { clock })
      assert.equal(receipt.coverage, OFFICIAL_SNAPSHOT_COVERAGE)
      assert.equal(receipt.productionMalwareCoverageProved, false)
      const loaded = await loadOfficialSnapshot(path.join(destination, 'manifest.json'), receipt.databaseSha256, { clock })
      assert.deepEqual(loaded.manifest.databases, fixture.manifest.databases)
      await assert.rejects(writeOfficialSnapshot(fixture.directory, destination, { clock }), code('SNAPSHOT_BUILD_FAILED'))
      assert.deepEqual((await loadOfficialSnapshot(path.join(destination, 'manifest.json'), receipt.databaseSha256, { clock })).manifest,
        loaded.manifest, 'Existing destination survives refused overwrite')
    } finally {
      await chmod(destination, 0o700).catch(() => {})
      await rm(destination, { recursive: true, force: true })
    }
  })
})
