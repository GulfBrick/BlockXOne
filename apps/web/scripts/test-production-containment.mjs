import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createOperatingSystemEnvironment } from './run-hermetic-tests.mjs'
import policy from './production-url-policy.cjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const gracefulShutdownTimeoutMs = 5_000
const forcedShutdownTimeoutMs = 5_000

function findServerPath() {
  return [
    path.join(webRoot, '.next', 'standalone', 'server.js'),
    path.join(webRoot, '.next', 'standalone', 'apps', 'web', 'server.js'),
  ].find(existsSync)
}

export function captureRootPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

export function isDirectExecution(moduleUrl = import.meta.url, argv = process.argv, platform = process.platform) {
  if (!argv[1]) return false
  const modulePath = path.resolve(fileURLToPath(moduleUrl))
  const entryPath = path.resolve(argv[1])
  return platform === 'win32'
    ? modulePath.toLowerCase() === entryPath.toLowerCase()
    : modulePath === entryPath
}

export async function reservePort() {
  const socket = net.createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error('Could not reserve a local port for the production containment probe.')
  return port
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntilReady(origin, child, output, spawnError) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const capturedSpawnError = spawnError()
    if (capturedSpawnError) throw capturedSpawnError
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Standalone server exited before readiness.\n${output()}`)
    }
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(1_000) })
      await response.body?.cancel()
      if (response.status === 200) return
    } catch {
      // The server may still be binding during bounded startup.
    }
    await delay(150)
  }
  throw new Error(`Standalone server did not become ready within 30 seconds.\n${output()}`)
}

async function assertStatus(origin, pathname, expected, headers = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  })
  await response.body?.cancel()
  if (response.status !== expected) {
    throw new Error(
      `${pathname} returned ${response.status}; expected ${expected}; headers=${JSON.stringify(headers)}`
    )
  }
}

export function waitWithin(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs)
    promise.then(
      () => {
        clearTimeout(timeout)
        resolve(true)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

export function processState(pid, killImplementation = process.kill) {
  if (!captureRootPid(pid)) throw new Error(`Refusing to inspect invalid process PID: ${pid}.`)
  try {
    killImplementation(pid, 0)
    return 'present'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'absent'
    if (error?.code === 'EPERM') return 'present'
    throw error
  }
}

export function posixGroupState(rootPid, killImplementation = process.kill) {
  if (!captureRootPid(rootPid)) throw new Error(`Refusing to inspect invalid process group: ${rootPid}.`)
  try {
    killImplementation(-rootPid, 0)
    return 'present'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'absent'
    if (error?.code === 'EPERM') return 'present'
    throw error
  }
}

export function signalPosixGroup(rootPid, signal, killImplementation = process.kill) {
  if (!captureRootPid(rootPid)) throw new Error(`Refusing to signal invalid process group: ${rootPid}.`)
  try {
    killImplementation(-rootPid, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

export async function waitForTargetAbsence(
  stateImplementation,
  timeoutMs,
  {
    delayImplementation = delay,
    now = Date.now,
    pollIntervalMs = 25,
  } = {}
) {
  const deadline = now() + timeoutMs
  while (true) {
    if (await stateImplementation() === 'absent') return true
    const remaining = deadline - now()
    if (remaining <= 0) return false
    await delayImplementation(Math.min(pollIntervalMs, remaining))
  }
}

function environmentValue(environment, acceptedNames) {
  const names = new Set(acceptedNames.map((name) => name.toLowerCase()))
  const match = Object.keys(environment || {}).find((name) => names.has(name.toLowerCase()))
  return match ? environment[match] : undefined
}

export function resolveTaskkillExecutable(childEnvironment) {
  const systemRoot = environmentValue(childEnvironment, ['SystemRoot'])
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)) {
    throw new Error('Cannot resolve taskkill.exe without an absolute SystemRoot.')
  }
  return path.win32.resolve(systemRoot, 'System32', 'taskkill.exe')
}

export function createTaskkillEnvironment(childEnvironment) {
  const taskkillExecutable = resolveTaskkillExecutable(childEnvironment)
  const systemRoot = path.win32.dirname(path.win32.dirname(taskkillExecutable))
  return { SystemRoot: systemRoot }
}

export async function runTaskkill(
  rootPid,
  childEnvironment,
  {
    force = false,
    helperTimeoutMs = forcedShutdownTimeoutMs,
    spawnImplementation = spawn,
    waitWithinImplementation = waitWithin,
  } = {}
) {
  if (!captureRootPid(rootPid)) throw new Error(`Refusing to taskkill invalid process PID: ${rootPid}.`)
  const executable = resolveTaskkillExecutable(childEnvironment)
  const arguments_ = ['/PID', String(rootPid), '/T']
  if (force) arguments_.push('/F')
  const taskkill = spawnImplementation(executable, arguments_, {
    env: createTaskkillEnvironment(childEnvironment),
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  const helperPid = captureRootPid(taskkill.pid)
  let helperOutcome
  const closed = new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      helperOutcome = outcome
      resolve()
    }
    taskkill.once('error', (error) => finish({ error }))
    taskkill.once('close', (code) => finish({ code }))
  })
  if (!await waitWithinImplementation(closed, helperTimeoutMs)) {
    const errors = [new Error('taskkill did not complete within the forced-shutdown timeout.')]
    if (!helperPid || typeof taskkill.kill !== 'function') {
      errors.push(new Error('Timed-out taskkill helper had no valid captured PID for exact termination.'))
    } else {
      try {
        taskkill.kill('SIGKILL')
      } catch (error) {
        errors.push(error)
      }
      if (!await waitWithinImplementation(closed, helperTimeoutMs)) {
        errors.push(new Error(`Exact taskkill helper PID ${helperPid} did not close after bounded termination.`))
      }
    }
    throw new AggregateError(errors, 'Bounded taskkill helper cleanup failed.')
  }
  if (helperOutcome?.error) throw helperOutcome.error
  if (helperOutcome?.code !== 0) throw new Error(`taskkill exited ${helperOutcome?.code}.`)
}

async function waitForChildCloseOnly(childClosed, timeoutMs) {
  if (!await waitWithin(childClosed, timeoutMs)) {
    throw new Error('Standalone server never received a valid PID and did not close after spawn failure.')
  }
}

async function observeTargetAndChild({ childClosed, stateImplementation, timeoutMs, waitOptions }) {
  const [targetAbsent, childDidClose] = await Promise.all([
    waitForTargetAbsence(stateImplementation, timeoutMs, waitOptions),
    waitWithin(childClosed, timeoutMs),
  ])
  return { childDidClose, targetAbsent }
}

function terminationFailure(message, errors) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message)
}

export async function terminatePosixProcessGroup({
  childClosed,
  force = false,
  forcedTimeoutMs = forcedShutdownTimeoutMs,
  gracefulTimeoutMs = gracefulShutdownTimeoutMs,
  killImplementation = process.kill,
  rootPid,
  waitOptions,
}) {
  const capturedRootPid = captureRootPid(rootPid)
  if (!capturedRootPid) return waitForChildCloseOnly(childClosed, gracefulTimeoutMs)

  const stateImplementation = () => posixGroupState(capturedRootPid, killImplementation)
  if (!force) {
    signalPosixGroup(capturedRootPid, 'SIGTERM', killImplementation)
    const graceful = await observeTargetAndChild({
      childClosed,
      stateImplementation,
      timeoutMs: gracefulTimeoutMs,
      waitOptions,
    })
    if (graceful.targetAbsent && graceful.childDidClose) return
    if (graceful.targetAbsent) {
      if (await waitWithin(childClosed, forcedTimeoutMs)) return
      throw new Error('POSIX process group exited but the root child did not close its streams within the timeout.')
    }
  }

  const errors = []
  try {
    if (stateImplementation() === 'present') {
      signalPosixGroup(capturedRootPid, 'SIGKILL', killImplementation)
    }
  } catch (error) {
    errors.push(error)
  }

  let forced
  try {
    forced = await observeTargetAndChild({
      childClosed,
      stateImplementation,
      timeoutMs: forcedTimeoutMs,
      waitOptions,
    })
  } catch (error) {
    errors.push(error)
  }
  if (!forced?.targetAbsent) errors.push(new Error('POSIX process group remained present after bounded SIGKILL escalation.'))
  if (!forced?.childDidClose) errors.push(new Error('POSIX root child did not close after bounded process-group termination.'))
  if (errors.length) throw terminationFailure('POSIX process-group termination failed.', errors)
}

export async function terminateWindowsProcessTree({
  childClosed,
  childEnvironment,
  force = false,
  forcedTimeoutMs = forcedShutdownTimeoutMs,
  gracefulTimeoutMs = gracefulShutdownTimeoutMs,
  killImplementation = process.kill,
  rootPid,
  spawnImplementation = spawn,
  waitOptions,
}) {
  const capturedRootPid = captureRootPid(rootPid)
  if (!capturedRootPid) return waitForChildCloseOnly(childClosed, gracefulTimeoutMs)
  const stateImplementation = () => processState(capturedRootPid, killImplementation)

  // taskkill targets one captured PID-tree snapshot; it is not a Job Object or a lifetime containment guarantee.
  if (stateImplementation() !== 'present') {
    throw new Error(
      `Captured root PID ${capturedRootPid} vanished before the first exact taskkill tree attempt; descendant containment cannot be proven.`
    )
  }

  if (!force) {
    let gracefulTaskkillError
    try {
      await runTaskkill(capturedRootPid, childEnvironment, {
        force: false,
        helperTimeoutMs: gracefulTimeoutMs,
        spawnImplementation,
      })
    } catch (error) {
      gracefulTaskkillError = error
    }

    const graceful = await observeTargetAndChild({
      childClosed,
      stateImplementation,
      timeoutMs: gracefulTimeoutMs,
      waitOptions,
    })
    if (!gracefulTaskkillError && graceful.targetAbsent && graceful.childDidClose) return
    if (graceful.targetAbsent) {
      if (!graceful.childDidClose && await waitWithin(childClosed, forcedTimeoutMs) && !gracefulTaskkillError) return
      const errors = []
      if (gracefulTaskkillError) errors.push(gracefulTaskkillError)
      if (!graceful.childDidClose) errors.push(new Error('Windows root child did not close after exact tree termination.'))
      errors.push(new Error(
        `Captured root PID ${capturedRootPid} vanished before forced tree escalation; descendant containment cannot be proven.`
      ))
      throw terminationFailure('Windows process-tree termination failed closed.', errors)
    }
  }

  const errors = []
  try {
    if (stateImplementation() !== 'present') {
      throw new Error(
        `Captured root PID ${capturedRootPid} vanished before exact forced taskkill; descendant containment cannot be proven.`
      )
    }
    await runTaskkill(capturedRootPid, childEnvironment, {
      force: true,
      helperTimeoutMs: forcedTimeoutMs,
      spawnImplementation,
    })
  } catch (error) {
    errors.push(error)
  }

  let forced
  try {
    forced = await observeTargetAndChild({
      childClosed,
      stateImplementation,
      timeoutMs: forcedTimeoutMs,
      waitOptions,
    })
  } catch (error) {
    errors.push(error)
  }
  if (!forced?.targetAbsent) errors.push(new Error('Windows root PID remained present after bounded forced tree termination.'))
  if (!forced?.childDidClose) errors.push(new Error('Windows root child did not close after bounded forced tree termination.'))
  if (errors.length) throw terminationFailure('Windows process-tree termination failed.', errors)
}

export async function terminateServer(options) {
  if (!captureRootPid(options.rootPid)) {
    return waitForChildCloseOnly(options.childClosed, options.gracefulTimeoutMs ?? gracefulShutdownTimeoutMs)
  }
  return (options.platform ?? process.platform) === 'win32'
    ? terminateWindowsProcessTree(options)
    : terminatePosixProcessGroup(options)
}

export async function forceTerminateServer(options) {
  return terminateServer({ ...options, force: true })
}

export async function probeLoopbackPort(
  port,
  {
    connectionFactory = (options) => net.createConnection(options),
    timeoutMs = 300,
  } = {}
) {
  return new Promise((resolve) => {
    const socket = connectionFactory({ host: '127.0.0.1', port })
    let settled = false
    const finish = (outcome, error) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ error, outcome })
    }
    socket.setTimeout(timeoutMs, () => {
      const error = new Error(`Loopback connection timed out after ${timeoutMs}ms.`)
      error.code = 'ETIMEDOUT'
      finish('indeterminate', error)
    })
    socket.once('connect', () => finish('accepted'))
    socket.once('error', (error) => {
      finish(error?.code === 'ECONNREFUSED' ? 'refused' : 'indeterminate', error)
    })
  })
}

export async function assertPortClosed(
  port,
  {
    delayImplementation = delay,
    now = Date.now,
    probeImplementation = probeLoopbackPort,
    probeIntervalMs = 100,
    stableRefusalIntervalMs = 1_000,
    timeoutMs = 5_000,
  } = {}
) {
  const deadline = now() + timeoutMs
  let consecutiveRefusals = 0
  let firstRefusalAt
  let lastResult
  while (now() <= deadline) {
    lastResult = await probeImplementation(port)
    if (lastResult?.outcome === 'refused') {
      if (consecutiveRefusals === 0) firstRefusalAt = now()
      consecutiveRefusals += 1
      if (consecutiveRefusals >= 3 && now() - firstRefusalAt >= stableRefusalIntervalMs) return
    } else {
      consecutiveRefusals = 0
      firstRefusalAt = undefined
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await delayImplementation(Math.min(probeIntervalMs, remaining))
  }
  const outcome = lastResult?.outcome || 'indeterminate'
  throw new Error(
    `Loopback port ${port} did not produce three consecutive ECONNREFUSED results over a stable interval; last outcome was ${outcome}.`,
    lastResult?.error ? { cause: lastResult.error } : undefined
  )
}

function appendErrors(target, error) {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) appendErrors(target, nested)
  } else if (error) {
    target.push(error)
  }
}

export async function completeContainmentCleanup({
  assertPortClosedImplementation = assertPortClosed,
  forceTerminateImplementation = forceTerminateServer,
  port,
  portProofOptions,
  probeError,
  terminateImplementation = terminateServer,
  terminationOptions,
}) {
  const errors = []
  appendErrors(errors, probeError)
  let cleanupRetryNeeded = false

  try {
    await terminateImplementation(terminationOptions)
  } catch (error) {
    cleanupRetryNeeded = true
    appendErrors(errors, error)
  }

  try {
    await assertPortClosedImplementation(port, portProofOptions)
  } catch (error) {
    cleanupRetryNeeded = true
    appendErrors(errors, error)
  }

  if (cleanupRetryNeeded) {
    try {
      await forceTerminateImplementation(terminationOptions)
    } catch (error) {
      appendErrors(errors, error)
    }
    try {
      await assertPortClosedImplementation(port, portProofOptions)
    } catch (error) {
      appendErrors(errors, error)
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, 'Production containment probe or exact cleanup failed.')
  }
}

export async function runProductionContainmentProbe() {
  // Only validated non-secret native Auth settings are deliberately forwarded.
  // Never inherit the caller's whole environment or any caller session.
  const authMode = policy.validateSupabaseAuthConfiguration({
    authMode: process.env.BLOCKXONE_AUTH_MODE,
    publicAuthMode: process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE,
    supabaseUrl: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    appOrigin: process.env.BLOCKXONE_APP_ORIGIN,
    environment: process.env,
  })
  const serverPath = findServerPath()
  if (!serverPath) {
    throw new Error('Production standalone server is missing. Run `npm run build` before the containment probe.')
  }

  const port = await reservePort()
  const origin = `http://127.0.0.1:${port}`
  const childEnvironment = Object.assign(createOperatingSystemEnvironment(), {
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    PORT: String(port),
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    NEXT_PUBLIC_API_URL: 'https://api.blockxone.example',
    SERVER_ACTION_ALLOWED_ORIGINS: 'app.blockxone.example',
  })
  if (authMode === 'supabase') {
    for (const name of ['BLOCKXONE_AUTH_MODE', 'NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'BLOCKXONE_APP_ORIGIN']) {
      childEnvironment[name] = process.env[name]
    }
  }
  let logs = ''
  const appendLog = (chunk) => {
    logs = `${logs}${chunk}`.slice(-20_000)
  }
  const child = spawn(process.execPath, [serverPath], {
    cwd: webRoot,
    detached: process.platform !== 'win32',
    env: childEnvironment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const rootPid = captureRootPid(child.pid)
  const childClosed = new Promise((resolve) => child.once('close', resolve))
  let childSpawnError
  child.once('error', (error) => {
    childSpawnError = error
    appendLog(`\nSpawn error: ${error.message}\n`)
  })

  child.stdout?.on('data', appendLog)
  child.stderr?.on('data', appendLog)

  let probeError
  try {
    await waitUntilReady(origin, child, () => logs, () => childSpawnError)
    await assertStatus(origin, '/', 200)
    await assertStatus(origin, '/request-demo', 200)
    await assertStatus(origin, '/guided-demo', 200)

    const enquiryPage = await fetch(`${origin}/request-demo`, { signal: AbortSignal.timeout(5_000) })
    const enquiryHtml = await enquiryPage.text()
    if (
      !enquiryHtml.includes('Online enquiries are temporarily unavailable.') ||
      /<(form|input|select|textarea)\b/i.test(enquiryHtml) ||
      enquiryHtml.includes('type="submit"')
    ) {
      throw new Error('Disabled public enquiry page must not expose data collection controls.')
    }

    const blockedPath = '/investor/p2p'
    await assertStatus(origin, blockedPath, 404)
    for (const value of [
      'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware',
      'middleware:middleware:middleware:middleware:middleware',
    ]) {
      await assertStatus(origin, blockedPath, 404, { 'x-middleware-subrequest': value })
    }

    for (const pathname of [
      '/investor/portfolio',
      '/operator/login',
      '/admin',
      '/api/auth/signup',
      '/api/auth/login',
      '/api/auth/user',
      '/api/login',
      '/api/logout',
      '/investor/login',
      '/register',
      '/wm/funds/new',
      '/tokenisation-agent/mint',
    ]) {
      await assertStatus(origin, pathname, 404)
    }
    if (authMode === 'supabase') {
      await assertStatus(origin, '/login', 200)
      const workspace = await fetch(`${origin}/workspace`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
      await workspace.body?.cancel()
      if (![303, 307, 401, 403].includes(workspace.status)) throw new Error('Anonymous native workspace must deny access.')
      const cacheRules = (workspace.headers.get('cache-control') || '').split(',').map((rule) => rule.trim().toLowerCase())
      if (!cacheRules.includes('private') || !cacheRules.includes('no-store')) throw new Error('Native workspace denial must be private/no-store.')
      if ([303, 307].includes(workspace.status)) {
        const location = workspace.headers.get('location')
        if (!location || new URL(location, origin).pathname !== '/login') throw new Error('Anonymous workspace must redirect only to login.')
      }
      await assertStatus(origin, '/auth/unknown', 404)
      await assertStatus(origin, '/workspace/unknown', 404)
      for (const pathname of ['/login/mfa/unknown', '/auth/mfa-enroll/unknown', '/auth/mfa-verify/unknown', '/workspace/security/unknown', '/workspace/administration/unknown', '/auth/admin-command/unknown', '/workspace/Administration', '/auth/Admin-command', '/workspace/recovery/unknown', '/auth/recovery-command/unknown', '/workspace/Recovery']) {
        await assertStatus(origin, pathname, 404)
      }
      for (const pathname of ['/login/mfa', '/workspace/security', '/workspace/administration', '/workspace/recovery']) {
        const response = await fetch(`${origin}${pathname}`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
        await response.body?.cancel()
        if (![303,307].includes(response.status) || new URL(response.headers.get('location') || '/', origin).pathname !== '/login') {
          throw new Error('Anonymous MFA/security/administration page must redirect only to login.')
        }
        if (!response.headers.get('cache-control')?.includes('no-store') || !response.headers.get('cache-control')?.includes('private')) {
          throw new Error('MFA/security/administration denial must be private/no-store.')
        }
      }
      for (const pathname of ['/auth/mfa-enroll','/auth/mfa-verify', '/auth/admin-command', '/auth/recovery-command']) {
        await assertStatus(origin, pathname, 405)
        for (const forgedOrigin of [undefined, 'null', 'https://foreign.example']) {
          const response = await fetch(`${origin}${pathname}`, { method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(forgedOrigin ? { Origin: forgedOrigin } : {}) },
            body: '', signal: AbortSignal.timeout(5_000) })
          await response.body?.cancel()
          if (response.status !== 403 || !response.headers.get('cache-control')?.includes('no-store')) {
            throw new Error('MFA/administration POST without canonical origin must deny privately before Auth.')
          }
        }
      }
    } else {
      await assertStatus(origin, '/login', 404)
      await assertStatus(origin, '/auth/confirm', 404)
      await assertStatus(origin, '/workspace', 404)
      await assertStatus(origin, '/login/mfa', 404)
      await assertStatus(origin, '/workspace/security', 404)
      await assertStatus(origin, '/auth/mfa-enroll', 404)
      await assertStatus(origin, '/auth/mfa-verify', 404)
      await assertStatus(origin, '/workspace/administration', 404)
      await assertStatus(origin, '/auth/admin-command', 404)
      await assertStatus(origin, '/workspace/recovery', 404)
      await assertStatus(origin, '/auth/recovery-command', 404)
    }
  } catch (error) {
    probeError = error
  }

  await completeContainmentCleanup({
    port,
    probeError,
    terminationOptions: {
      childClosed,
      childEnvironment,
      platform: process.platform,
      rootPid,
    },
  })

  console.log('Production containment probe passed; captured exact-tree cleanup completed and its loopback port stably refused connections.')
}

if (isDirectExecution()) {
  await runProductionContainmentProbe()
}
