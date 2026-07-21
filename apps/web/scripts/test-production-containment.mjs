import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createOperatingSystemEnvironment } from './run-hermetic-tests.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const serverCandidates = [
  path.join(webRoot, '.next', 'standalone', 'server.js'),
  path.join(webRoot, '.next', 'standalone', 'apps', 'web', 'server.js'),
]
const serverPath = serverCandidates.find(existsSync)
const gracefulShutdownTimeoutMs = 5_000
const forcedShutdownTimeoutMs = 5_000

if (!serverPath) {
  throw new Error('Production standalone server is missing. Run `npm run build` before the containment probe.')
}

async function reservePort() {
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

function waitWithin(promise, timeoutMs) {
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

function signalPosixGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function runTaskkill(pid, childEnvironment) {
  const taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    env: childEnvironment,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  const closed = new Promise((resolve, reject) => {
    taskkill.once('error', reject)
    taskkill.once('close', (code) => code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}.`)))
  })
  if (!await waitWithin(closed, forcedShutdownTimeoutMs)) {
    throw new Error('taskkill did not complete within the forced-shutdown timeout.')
  }
}

async function terminateServer(child, childClosed, childEnvironment) {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (!await waitWithin(childClosed, gracefulShutdownTimeoutMs)) {
      throw new Error('Standalone server exited but did not close its streams within the timeout.')
    }
    return
  }

  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    if (!await waitWithin(childClosed, gracefulShutdownTimeoutMs)) {
      throw new Error('Standalone server never received a valid PID and did not close after spawn failure.')
    }
    return
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM')
  } else {
    signalPosixGroup(child.pid, 'SIGTERM')
  }

  if (await waitWithin(childClosed, gracefulShutdownTimeoutMs)) return

  if (process.platform === 'win32') {
    await runTaskkill(child.pid, childEnvironment)
  } else {
    signalPosixGroup(child.pid, 'SIGKILL')
  }

  if (!await waitWithin(childClosed, forcedShutdownTimeoutMs)) {
    throw new Error('Standalone server remained alive after bounded forced termination.')
  }
}

async function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (connected) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(300, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function assertPortClosed(port) {
  const deadline = Date.now() + 5_000
  let consecutiveRefusals = 0
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      consecutiveRefusals = 0
    } else {
      consecutiveRefusals += 1
      if (consecutiveRefusals === 3) return
    }
    await delay(100)
  }
  throw new Error(`Loopback port ${port} still accepted connections after server termination.`)
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
const childClosed = new Promise((resolve) => child.once('close', resolve))
let childSpawnError
child.once('error', (error) => {
  childSpawnError = error
  appendLog(`\nSpawn error: ${error.message}\n`)
})

child.stdout.on('data', appendLog)
child.stderr.on('data', appendLog)

let probePassed = false
try {
  await waitUntilReady(origin, child, () => logs, () => childSpawnError)
  await assertStatus(origin, '/', 200)
  await assertStatus(origin, '/request-demo', 200)

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
    '/wm/funds/new',
    '/tokenisation-agent/mint',
  ]) {
    await assertStatus(origin, pathname, 404)
  }

  probePassed = true
} finally {
  let terminationError
  try {
    await terminateServer(child, childClosed, childEnvironment)
  } catch (error) {
    terminationError = error
  }

  try {
    await assertPortClosed(port)
  } catch (portError) {
    if (terminationError) {
      throw new AggregateError([terminationError, portError], 'Server termination and port-refusal checks both failed.')
    }
    throw portError
  }

  if (terminationError) throw terminationError
}

if (probePassed) {
  console.log('Production containment probe passed; the child closed and its loopback port refused connections.')
}
