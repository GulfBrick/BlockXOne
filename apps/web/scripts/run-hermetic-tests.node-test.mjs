import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
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
import {
  assertPortClosed,
  captureRootPid,
  completeContainmentCleanup,
  forceTerminateServer,
  posixGroupState,
  probeLoopbackPort,
  processState,
  reservePort,
  resolveTaskkillExecutable,
  runTaskkill,
  terminatePosixProcessGroup,
  terminateServer,
  terminateWindowsProcessTree,
} from './test-production-containment.mjs'

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

function errorWithCode(code, message = code) {
  return Object.assign(new Error(message), { code })
}

function socketThat(outcome) {
  const socket = new EventEmitter()
  socket.destroy = () => {}
  socket.setTimeout = (_timeoutMs, callback) => {
    if (outcome === 'timeout') queueMicrotask(callback)
  }
  if (outcome === 'accepted') queueMicrotask(() => socket.emit('connect'))
  if (outcome === 'refused') queueMicrotask(() => socket.emit('error', errorWithCode('ECONNREFUSED')))
  if (outcome === 'reset') queueMicrotask(() => socket.emit('error', errorWithCode('ECONNRESET')))
  return socket
}

function fakeClock() {
  let time = 0
  const delay = async (milliseconds) => { time += milliseconds }
  return {
    delay,
    delayImplementation: delay,
    now: () => time,
  }
}

function helperThatCloses(code = 0, pid = 9001) {
  const helper = new EventEmitter()
  helper.pid = pid
  helper.kill = () => true
  queueMicrotask(() => helper.emit('close', code))
  return helper
}

async function waitForLine(stream, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const timeout = setTimeout(() => finish(new Error('Timed out waiting for a child-process line.')), timeoutMs)
    const onData = (chunk) => {
      buffered += chunk
      const newline = buffered.indexOf('\n')
      if (newline !== -1) finish(undefined, buffered.slice(0, newline))
    }
    const onError = (error) => finish(error)
    const onEnd = () => finish(new Error(`Child output ended before a complete line: ${buffered}`))
    const finish = (error, line) => {
      clearTimeout(timeout)
      stream.off('data', onData)
      stream.off('error', onError)
      stream.off('end', onEnd)
      if (error) reject(error)
      else resolve(line)
    }
    stream.on('data', onData)
    stream.once('error', onError)
    stream.once('end', onEnd)
  })
}

async function waitForAcceptedPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await probeLoopbackPort(port))?.outcome === 'accepted') return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Loopback port ${port} did not accept a connection within ${timeoutMs}ms.`)
}

async function waitForPidAbsent(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (processState(pid) === 'absent') return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Exact PID ${pid} remained present after ${timeoutMs}ms.`)
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

test('production containment module is import-safe and captures only a valid immutable root PID', () => {
  const source = readFileSync(containmentProbePath, 'utf8')
  assert.match(source, /child\.once\('error'/)
  assert.match(source, /const rootPid = captureRootPid\(child\.pid\)/)
  assert.match(source, /detached:\s*process\.platform !== 'win32'/)
  assert.match(source, /if \(isDirectExecution\(\)\)/)
  assert.equal(captureRootPid(42), 42)
  for (const invalid of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(captureRootPid(invalid), undefined)
  }
})

test('taskkill uses the absolute SystemRoot executable, exact PID tree args, and a minimal environment', async () => {
  const calls = []
  const childEnvironment = {
    Path: 'C:\\hostile-path',
    SECRET: 'must-not-propagate',
    SystemRoot: 'C:\\Windows',
  }
  const spawnImplementation = (executable, arguments_, options) => {
    calls.push({ arguments_, executable, options })
    return helperThatCloses(0, 9100 + calls.length)
  }

  await runTaskkill(4321, childEnvironment, { spawnImplementation })
  await runTaskkill(4321, childEnvironment, { force: true, spawnImplementation })

  assert.equal(resolveTaskkillExecutable(childEnvironment), 'C:\\Windows\\System32\\taskkill.exe')
  assert.deepEqual(calls.map(({ arguments_ }) => arguments_), [
    ['/PID', '4321', '/T'],
    ['/PID', '4321', '/T', '/F'],
  ])
  for (const call of calls) {
    assert.equal(call.executable, 'C:\\Windows\\System32\\taskkill.exe')
    assert.deepEqual(call.options, {
      env: { SystemRoot: 'C:\\Windows' },
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
  }
})

test('a timed-out taskkill helper is terminated and awaited by its exact captured PID', async () => {
  let killedWith
  const helper = new EventEmitter()
  helper.pid = 9201
  helper.kill = (signal) => {
    killedWith = signal
    queueMicrotask(() => helper.emit('close', 1))
    return true
  }

  await assert.rejects(
    runTaskkill(4321, { SystemRoot: 'C:\\Windows' }, {
      force: true,
      helperTimeoutMs: 2,
      spawnImplementation: () => helper,
    }),
    /Bounded taskkill helper cleanup failed/
  )
  assert.equal(killedWith, 'SIGKILL')
})

test('Windows parent close never skips the first exact process-tree attempt', async () => {
  const calls = []
  let treeAttempted = false
  const killImplementation = (pid, signal) => {
    assert.equal(pid, 4401)
    assert.equal(signal, 0)
    if (treeAttempted) throw errorWithCode('ESRCH')
  }

  await terminateWindowsProcessTree({
    childClosed: Promise.resolve(),
    childEnvironment: { SystemRoot: 'C:\\Windows' },
    gracefulTimeoutMs: 20,
    killImplementation,
    rootPid: 4401,
    spawnImplementation: (executable, arguments_, options) => {
      calls.push({ arguments_, executable, options })
      treeAttempted = true
      return helperThatCloses()
    },
  })

  assert.deepEqual(calls.map(({ arguments_ }) => arguments_), [['/PID', '4401', '/T']])
})

test('Windows termination escalates the same exact root tree and fails closed if the root vanished first', async () => {
  const clock = fakeClock()
  const calls = []
  let forcedStarted = false
  let closeChild
  const childClosed = new Promise((resolve) => { closeChild = resolve })
  const killImplementation = (_pid, signal) => {
    assert.equal(signal, 0)
    if (forcedStarted) throw errorWithCode('ESRCH')
  }
  const spawnImplementation = (_executable, arguments_) => {
    calls.push(arguments_)
    if (arguments_.includes('/F')) {
      forcedStarted = true
      closeChild()
    }
    return helperThatCloses()
  }

  await terminateWindowsProcessTree({
    childClosed,
    childEnvironment: { SystemRoot: 'C:\\Windows' },
    forcedTimeoutMs: 10,
    gracefulTimeoutMs: 5,
    killImplementation,
    rootPid: 4402,
    spawnImplementation,
    waitOptions: clock,
  })
  assert.deepEqual(calls, [
    ['/PID', '4402', '/T'],
    ['/PID', '4402', '/T', '/F'],
  ])

  let spawnCalls = 0
  await assert.rejects(
    terminateWindowsProcessTree({
      childClosed: Promise.resolve(),
      childEnvironment: { SystemRoot: 'C:\\Windows' },
      killImplementation: () => { throw errorWithCode('ESRCH') },
      rootPid: 4403,
      spawnImplementation: () => { spawnCalls += 1 },
    }),
    /vanished before the first exact taskkill tree attempt/
  )
  assert.equal(spawnCalls, 0)
})

test('POSIX group presence treats EPERM as present and escalates TERM to KILL on the same group', async () => {
  assert.equal(posixGroupState(4501, () => { throw errorWithCode('EPERM') }), 'present')
  assert.equal(posixGroupState(4501, () => { throw errorWithCode('ESRCH') }), 'absent')

  const clock = fakeClock()
  const signals = []
  let killed = false
  let closeChild
  const childClosed = new Promise((resolve) => { closeChild = resolve })
  const killImplementation = (target, signal) => {
    assert.equal(target, -4501)
    if (signal === 0) {
      if (killed) throw errorWithCode('ESRCH')
      return
    }
    signals.push(signal)
    if (signal === 'SIGKILL') {
      killed = true
      closeChild()
    }
  }

  await terminatePosixProcessGroup({
    childClosed,
    forcedTimeoutMs: 10,
    gracefulTimeoutMs: 5,
    killImplementation,
    rootPid: 4501,
    waitOptions: clock,
  })
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('loopback socket probing distinguishes refusal from acceptance, reset, and timeout', async () => {
  for (const [socketOutcome, expected] of [
    ['accepted', 'accepted'],
    ['refused', 'refused'],
    ['reset', 'indeterminate'],
    ['timeout', 'indeterminate'],
  ]) {
    const result = await probeLoopbackPort(65530, {
      connectionFactory: () => socketThat(socketOutcome),
      timeoutMs: 5,
    })
    assert.equal(result.outcome, expected, socketOutcome)
  }
})

test('stable refusal proof rejects an early three-refusal window and resets when a listener reopens', async () => {
  const clock = fakeClock()
  const outcomes = ['refused', 'refused', 'refused', 'accepted']
  let probes = 0
  await assertPortClosed(65530, {
    delayImplementation: clock.delay,
    now: clock.now,
    probeImplementation: async () => ({ outcome: outcomes[probes++] || 'refused' }),
    probeIntervalMs: 100,
    stableRefusalIntervalMs: 1_000,
    timeoutMs: 3_000,
  })
  assert.equal(probes, 15)
  assert.equal(clock.now(), 1_400)

  const indeterminateClock = fakeClock()
  await assert.rejects(
    assertPortClosed(65530, {
      delayImplementation: indeterminateClock.delay,
      now: indeterminateClock.now,
      probeImplementation: async () => ({ outcome: 'indeterminate', error: errorWithCode('ECONNRESET') }),
      probeIntervalMs: 100,
      stableRefusalIntervalMs: 200,
      timeoutMs: 300,
    }),
    /did not produce three consecutive ECONNREFUSED/
  )
})

test('cleanup retries exact forced termination and aggregates the original probe plus every cleanup error', async () => {
  const failures = [
    new Error('original probe failed'),
    new Error('initial termination failed'),
    new Error('first port proof failed'),
    new Error('forced cleanup failed'),
    new Error('second port proof failed'),
  ]
  let portProofs = 0
  let forcedAttempts = 0
  await assert.rejects(
    completeContainmentCleanup({
      assertPortClosedImplementation: async () => {
        const error = portProofs++ === 0 ? failures[2] : failures[4]
        throw error
      },
      forceTerminateImplementation: async () => { forcedAttempts += 1; throw failures[3] },
      port: 65530,
      probeError: failures[0],
      terminateImplementation: async () => { throw failures[1] },
      terminationOptions: {},
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, failures)
      return true
    }
  )
  assert.equal(forcedAttempts, 1)
  assert.equal(portProofs, 2)
})

test('an initial termination error forces an exact retry even when the first port proof passes', async () => {
  let forcedAttempts = 0
  let portProofs = 0
  await assert.rejects(
    completeContainmentCleanup({
      assertPortClosedImplementation: async () => { portProofs += 1 },
      forceTerminateImplementation: async () => { forcedAttempts += 1 },
      port: 65530,
      terminateImplementation: async () => { throw new Error('tree proof failed') },
      terminationOptions: {},
    }),
    (error) => error instanceof AggregateError && error.errors[0]?.message === 'tree proof failed'
  )
  assert.equal(forcedAttempts, 1)
  assert.equal(portProofs, 2)
})

test('missing PID performs bounded child close only and never signals or starts taskkill', async () => {
  let unsafeCall = false
  await terminateServer({
    childClosed: Promise.resolve(),
    killImplementation: () => { unsafeCall = true },
    platform: 'win32',
    rootPid: undefined,
    spawnImplementation: () => { unsafeCall = true },
  })
  await forceTerminateServer({
    childClosed: Promise.resolve(),
    killImplementation: () => { unsafeCall = true },
    platform: 'linux',
    rootPid: 0,
    spawnImplementation: () => { unsafeCall = true },
  })
  assert.equal(unsafeCall, false)
})

test('real coordinator removes the exact parent/listener tree or process group', { timeout: 30_000 }, async () => {
  const port = await reservePort()
  const listenerSource = [
    "const net = require('node:net')",
    'const port = Number(process.argv[1])',
    "const server = net.createServer((socket) => socket.end())",
    "server.listen(port, '127.0.0.1', () => process.stdout.write('ready\\n'))",
  ].join('\n')
  const parentSource = [
    "const { spawn } = require('node:child_process')",
    'const listenerSource = process.argv[1]',
    'const port = process.argv[2]',
    'const descendant = spawn(process.execPath, [\'-e\', listenerSource, port], {',
    "  detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,",
    '})',
    "descendant.stderr.on('data', (chunk) => process.stderr.write(chunk))",
    "descendant.stdout.once('data', () => process.stdout.write(`${descendant.pid}\\n`))",
    'setInterval(() => {}, 1_000)',
  ].join('\n')
  const childEnvironment = createOperatingSystemEnvironment()
  let parent
  let rootPid
  let descendantPid
  let coordinatorPassed = false

  try {
    parent = spawn(process.execPath, ['-e', parentSource, listenerSource, String(port)], {
      detached: process.platform !== 'win32',
      env: childEnvironment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    rootPid = captureRootPid(parent.pid)
    assert.ok(rootPid, 'Real containment parent must receive a valid captured root PID.')
    const childClosed = new Promise((resolve, reject) => {
      parent.once('error', reject)
      parent.once('close', resolve)
    })
    parent.stderr.on('data', () => {})
    descendantPid = captureRootPid(Number(await waitForLine(parent.stdout)))
    assert.ok(descendantPid, 'Real containment listener must report a valid descendant PID.')
    await waitForAcceptedPort(port)

    await completeContainmentCleanup({
      port,
      terminationOptions: {
        childClosed,
        childEnvironment,
        platform: process.platform,
        rootPid,
      },
    })
    await waitForPidAbsent(rootPid)
    await waitForPidAbsent(descendantPid)
    assert.equal((await probeLoopbackPort(port)).outcome, 'refused')
    coordinatorPassed = true
  } finally {
    if (!coordinatorPassed) {
      for (const exactPid of [rootPid, descendantPid]) {
        if (!captureRootPid(exactPid)) continue
        let stillPresent = false
        try {
          stillPresent = processState(exactPid) === 'present'
        } catch {
          stillPresent = true
        }
        if (!stillPresent) continue
        try {
          if (process.platform === 'win32') {
            await runTaskkill(exactPid, childEnvironment, { force: true, helperTimeoutMs: 2_000 })
          } else if (exactPid === rootPid) {
            process.kill(-exactPid, 'SIGKILL')
          } else {
            process.kill(exactPid, 'SIGKILL')
          }
        } catch {
          // Emergency cleanup remains limited to the captured exact PID/tree/group.
        }
      }
    }
  }
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
