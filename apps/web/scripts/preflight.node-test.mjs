import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// Keep this Node-native suite outside Vitest's *.test.* discovery pattern.

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(scriptDir, 'preflight.mjs')
const { evaluatePreflight, npmVersionFromCli } = await import(pathToFileURL(scriptPath))

function withTempWebPackage(setup, run) {
  const dir = path.join(tmpdir(), `bxo-web-preflight-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  try {
    setup(dir)
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writePackageFiles(dir) {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@blockxone/web', private: true }, null, 2))
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: '@blockxone/web', lockfileVersion: 3 }, null, 2))
}

test('rejects an unsupported Node release', () => {
  const result = withTempWebPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '25.2.1',
      npmUserAgent: 'npm/10.9.8 node/v25.2.1 win32 x64',
    })
  )

  assert.deepEqual(result.failures, [
    'Node 25.2.1 is not supported for the web toolchain. Use exactly Node 22.23.1.',
  ])
})

test('rejects an unsupported npm release', () => {
  const result = withTempWebPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: 'npm/11.0.0 node/v22.23.1 win32 x64',
    })
  )

  assert.deepEqual(result.failures, [
    'npm 11.0.0 is not supported for the web toolchain. Use exactly npm 10.9.8.',
  ])
})

test('rejects execution outside npm', () => {
  const result = withTempWebPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: '',
    })
  )

  assert.deepEqual(result.failures, [
    'npm 10.9.8 is required; run web lifecycle commands through npm.',
  ])
})

test('passes only with the exact pinned toolchain and package files', () => {
  const result = withTempWebPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: 'npm/10.9.8 node/v22.23.1 win32 x64',
    })
  )

  assert.deepEqual(result.failures, [])
})

test('reads the actual npm package and ignores a stale outer npx user-agent', () => {
  withTempWebPackage((dir) => {
    writePackageFiles(dir)
    mkdirSync(path.join(dir, 'npm', 'bin'), { recursive: true })
    writeFileSync(path.join(dir, 'npm', 'package.json'), JSON.stringify({ name: 'npm', version: '10.9.8' }))
  }, (dir) => {
    const version = npmVersionFromCli(path.join(dir, 'npm', 'bin', 'npm-cli.js'))
    assert.equal(version, '10.9.8')
    assert.deepEqual(evaluatePreflight({
      cwd: dir, nodeVersion: '22.23.1', npmUserAgent: 'npm/11.6.2', npmCliVersion: version,
    }).failures, [])
  })
})

test('does not trust a missing, relative, or non-npm executable package', () => {
  assert.equal(npmVersionFromCli('relative/npm-cli.js'), '')
  withTempWebPackage((dir) => {
    writePackageFiles(dir)
    mkdirSync(path.join(dir, 'bin'))
  }, (dir) => {
    assert.equal(npmVersionFromCli(path.join(dir, 'bin', 'not-npm.js')), '')
    assert.notEqual(evaluatePreflight({
      cwd: dir, nodeVersion: '22.23.1', npmUserAgent: 'npm/10.9.8', npmCliVersion: '',
    }).failures.length, 0)
  })
})

test('preflight fails closed for invalid Auth flags and secret-key classes without printing values', () => {
  withTempWebPackage(writePackageFiles, (dir) => {
    const settings = { cwd: dir, nodeVersion: '22.23.1', npmCliVersion: '10.9.8' }
    const environment = {
      BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(32),
      BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za',
    }
    assert.deepEqual(evaluatePreflight({ ...settings, environment }).failures, [])
    for (const changed of [
      { NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: '' },
      { SUPABASE_URL: 'http://localhost' },
      { BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za/path' },
      { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture_never_echo' },
      { SUPABASE_SERVICE_ROLE_KEY: 'fixture_never_echo' },
      { SUPABASE_SECRET_KEYS: 'fixture_never_echo' },
      { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'fixture_never_echo' },
      { NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'fixture_never_echo' },
    ]) {
      const result = evaluatePreflight({ ...settings, environment: { ...environment, ...changed } })
      assert.ok(result.failures.length > 0)
      assert.ok(!result.failures.join(' ').includes('fixture_never_echo'))
    }
  })
})
