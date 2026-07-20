import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

const webRoot = process.cwd()
const serverCandidates = [
  path.join(webRoot, '.next', 'standalone', 'server.js'),
  path.join(webRoot, '.next', 'standalone', 'apps', 'web', 'server.js'),
]
const serverPath = serverCandidates.find(existsSync)

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

async function waitUntilReady(origin, child, output) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Standalone server exited before readiness.\n${output()}`)
    }
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(1_000) })
      await response.body?.cancel()
      if (response.status === 200) return
    } catch {
      // The server may still be binding or compiling startup state.
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

const port = await reservePort()
const origin = `http://127.0.0.1:${port}`
let logs = ''
const child = spawn(process.execPath, [serverPath], {
  cwd: webRoot,
  env: {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const appendLog = (chunk) => {
  logs = `${logs}${chunk}`.slice(-20_000)
}
child.stdout.on('data', appendLog)
child.stderr.on('data', appendLog)

try {
  await waitUntilReady(origin, child, () => logs)
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

  console.log('Production containment probe passed, including x-middleware-subrequest bypass regression cases.')
} finally {
  if (child.exitCode === null) child.kill()
}
