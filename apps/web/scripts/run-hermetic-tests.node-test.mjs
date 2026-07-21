import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createHermeticTestEnvironment,
  createOperatingSystemEnvironment,
  normalizeVitestArguments,
  runHermeticVitest,
  vitestExecutable,
  webRoot,
} from './run-hermetic-tests.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.join(scriptDirectory, 'run-hermetic-tests.mjs')
const containmentProbePath = path.join(scriptDirectory, 'test-production-containment.mjs')
const repositoryRoot = path.resolve(webRoot, '..', '..')
const failureFixture = path.join(webRoot, 'src', 'test', `deliberate-runner-failure-${process.pid}.test.ts`)
const hostileEnvironment = {
  DATABASE_URL: 'postgres://should-not-propagate',
  RPC_URL: 'https://rpc.invalid',
  PROVIDER_TOKEN: 'provider-token',
  SIGNING_SECRET: 'signing-secret',
  PASSWORD: 'password',
  CREDENTIAL: 'credential',
  PRIVATE_KEY: 'private-key',
  PRODUCTION_URL: 'https://production.invalid',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AZURE_CLIENT_SECRET: 'azure-secret',
  GOOGLE_APPLICATION_CREDENTIALS: 'google.json',
  GITHUB_TOKEN: 'github-token',
  NODE_OPTIONS: '--trace-warnings',
  HTTP_PROXY: 'http://proxy.invalid',
  HTTPS_PROXY: 'http://proxy.invalid',
  ALL_PROXY: 'socks://proxy.invalid',
  NODE_EXTRA_CA_CERTS: 'ca.pem',
  SSL_CERT_FILE: 'cert.pem',
  npm_config_registry: 'https://registry.invalid',
  VITE_API_URL: 'https://vite.invalid',
  NEXT_PUBLIC_UNEXPECTED: 'https://unexpected.invalid',
}

function runnerEnvironment() {
  return Object.assign({}, process.env, hostileEnvironment)
}

function invokeRunner(cwd, args = [], environment = runnerEnvironment()) {
  const result = spawnSync(process.execPath, [runnerPath, ...args], {
    cwd,
    env: environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  })
  return {
    ...result,
    combined: `${result.stdout || ''}\n${result.stderr || ''}`,
  }
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function passingTestCount(result) {
  const match = /Tests\s+(\d+)\s+passed/.exec(stripAnsi(result.combined))
  assert.ok(match, `Could not parse a nonzero Vitest test count.\n${result.combined}`)
  const count = Number(match[1])
  assert.ok(count > 0, 'Vitest must discover a nonzero test set.')
  return count
}

function discoveredTestFiles(result) {
  const files = stripAnsi(result.combined)
    .split(/\r?\n/)
    .map((line) => /^\s*[✓×]\s+(.+?\.test\.(?:ts|tsx))\s+\(/.exec(line)?.[1])
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/').toLowerCase())
  const normalized = [...new Set(files)].sort()
  assert.ok(normalized.length > 0, `Could not parse a nonempty Vitest file set.\n${result.combined}`)
  return normalized
}

function assertCacheWasRemoved(result) {
  const matches = [...result.combined.matchAll(/BLOCKXONE_HERMETIC_CACHE_CLEANED=([^\r\n]+)/g)]
  assert.equal(matches.length, 1, `Expected one cache cleanup marker.\n${result.combined}`)
  const cachePath = matches[0][1].trim()
  assert.equal(existsSync(cachePath), false, `Generated cache still exists: ${cachePath}`)
}

test('derives the package root and exact local Vitest executable independent of cwd', () => {
  assert.equal(webRoot, fileURLToPath(new URL('..', import.meta.resolve('./run-hermetic-tests.mjs'))))
  assert.equal(vitestExecutable, path.join(webRoot, 'node_modules', 'vitest', 'vitest.mjs'))
})

test('normalizes duplicate legacy --run flags and rejects every CLI override', () => {
  assert.deepEqual(normalizeVitestArguments(['--run', '--run']), [])
  for (const argument of [
    '--watch', '--watch=true', '--ui', '--ui=true', '--browser', '--config=other.ts', '--root=.',
    '--dir=src', '--workspace=other.ts', '--project=other', '--setupFiles=other.ts', '--environment=jsdom',
    '--cache', '--cacheDir=cache', '--coverage', '--outputFile=result.json', '--update', '-u', 'src/file.test.ts',
  ]) {
    assert.throws(() => normalizeVitestArguments([argument]), /Unsupported Vitest argument/, argument)
  }
})

test('uses a case-insensitive Windows OS allowlist and strips hostile names', () => {
  const source = Object.assign({
    Path: 'C:\\node',
    SYSTEMROOT: 'C:\\Windows',
    windir: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    PATHEXT: '.EXE',
    TEMP: 'C:\\Temp',
    TMP: 'C:\\Temp',
    SYSTEMDRIVE: 'C:',
  }, hostileEnvironment)
  const output = createOperatingSystemEnvironment(source, 'win32')

  assert.deepEqual(Object.keys(output).sort(), [
    'COMSPEC', 'PATH', 'PATHEXT', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR',
  ].sort())
  assert.equal(output.PATH, 'C:\\node')
  for (const name of Object.keys(hostileEnvironment)) assert.equal(output[name], undefined)
})

test('creates only the fixed test environment plus documented OS variables', () => {
  const output = createHermeticTestEnvironment('/tmp/blockxone-vitest-test', { PATH: '/bin', HOME: '/home/test' }, 'linux')
  assert.deepEqual(output, {
    PATH: '/bin',
    HOME: '/home/test',
    NODE_ENV: 'test',
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    NEXT_PUBLIC_API_URL: 'https://api.blockxone.example',
    SERVER_ACTION_ALLOWED_ORIGINS: 'app.blockxone.example',
    BLOCKXONE_HERMETIC_RUNNER: '1',
    BLOCKXONE_VITEST_CACHE_DIR: '/tmp/blockxone-vitest-test',
  })
})

test('runner source has no inherited-environment spread, npx, or download path', () => {
  const source = readFileSync(runnerPath, 'utf8')
  assert.doesNotMatch(source, /\.\.\.\s*process\.env/)
  assert.doesNotMatch(source, /\bnpx\b/i)
  assert.doesNotMatch(source, /registry\.npmjs\.org|npm\s+(?:ci|install)|node_modules[\\/]\.bin[\\/]npm/i)
  assert.deepEqual(
    [...source.matchAll(/https?:\/\/[^'"`\s]+/g)].map((match) => match[0]),
    ['https://api.blockxone.example']
  )
})

test('production probe captures spawn failure and always attempts bounded cleanup plus port refusal', () => {
  const source = readFileSync(containmentProbePath, 'utf8')
  assert.match(source, /child\.once\('error'/)
  assert.match(source, /Number\.isInteger\(child\.pid\)/)
  assert.match(source, /detached:\s*process\.platform !== 'win32'/)
  assert.match(source, /spawn\('taskkill', \['\/PID', String\(pid\), '\/T', '\/F'\]/)
  assert.match(source, /signalPosixGroup\(child\.pid, 'SIGKILL'\)/)
  assert.match(source, /await terminateServer[\s\S]+await assertPortClosed/)
})

test('root and package-root invocations discover the same nonzero set twice and clean every cache', { timeout: 120_000 }, () => {
  const results = [
    invokeRunner(repositoryRoot, ['--run', '--run']),
    invokeRunner(repositoryRoot),
    invokeRunner(webRoot, ['--run']),
    invokeRunner(webRoot),
  ]

  for (const result of results) {
    assert.equal(result.status, 0, result.combined)
    assertCacheWasRemoved(result)
  }
  const counts = results.map(passingTestCount)
  assert.ok(counts.every((count) => count === counts[0]), `Mismatched test counts: ${counts.join(', ')}`)
  const fileSets = results.map(discoveredTestFiles)
  assert.ok(
    fileSets.every((files) => JSON.stringify(files) === JSON.stringify(fileSets[0])),
    `Mismatched normalized test file sets: ${JSON.stringify(fileSets)}`
  )
})

test('a deliberate failing fixture propagates nonzero and still cleans the exact cache', { timeout: 120_000 }, () => {
  assert.equal(path.dirname(failureFixture), path.join(webRoot, 'src', 'test'))
  writeFileSync(
    failureFixture,
    "import { expect, it } from 'vitest'\nit('deliberate runner failure', () => expect(true).toBe(false))\n"
  )

  try {
    const result = invokeRunner(repositoryRoot)
    assert.notEqual(result.status, 0, result.combined)
    assert.match(result.combined, /deliberate runner failure/)
    assertCacheWasRemoved(result)
  } finally {
    rmSync(failureFixture, { force: true })
  }
  assert.equal(existsSync(failureFixture), false)
})

test('a child spawn failure rejects and still removes the runner-created cache', async () => {
  const markers = []
  const originalLog = console.log
  console.log = (value) => markers.push(String(value))

  try {
    await assert.rejects(
      runHermeticVitest({
        inheritedEnvironment: process.env,
        spawnImplementation: () => {
          const child = new EventEmitter()
          queueMicrotask(() => child.emit('error', new Error('deliberate spawn failure')))
          return child
        },
        stdio: 'ignore',
      }),
      /deliberate spawn failure/
    )
  } finally {
    console.log = originalLog
  }

  const created = markers.find((line) => line.startsWith('BLOCKXONE_HERMETIC_CACHE_CREATED='))?.split('=')[1]
  const cleaned = markers.find((line) => line.startsWith('BLOCKXONE_HERMETIC_CACHE_CLEANED='))?.split('=')[1]
  assert.ok(created)
  assert.equal(cleaned, created)
  assert.equal(existsSync(created), false)
})

test('watch, UI, and configuration escape arguments fail before a cache is created', () => {
  for (const argument of ['--watch', '--ui', '--config=escape.ts']) {
    const result = invokeRunner(repositoryRoot, [argument])
    assert.notEqual(result.status, 0, result.combined)
    assert.match(result.combined, /Unsupported Vitest argument/)
    assert.doesNotMatch(result.combined, /BLOCKXONE_HERMETIC_CACHE_CREATED=/)
  }
})
