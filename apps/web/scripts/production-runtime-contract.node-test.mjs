import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createOperatingSystemEnvironment } from './run-hermetic-tests.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(webRoot, '..', '..')

const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile.web'), 'utf8')
const navbar = readFileSync(path.join(webRoot, 'src', 'components', 'ui', 'navbar.tsx'), 'utf8')

test('only the administration review branch suppresses Vercel Git deployments', () => {
  const config = JSON.parse(readFileSync(path.join(webRoot, 'vercel.json'), 'utf8'))
  assert.deepEqual(config.git, { deploymentEnabled: { 'codex/hosted-administration-20260919': false } })
  assert.equal(config.framework, 'nextjs')
  assert.equal(config.installCommand, 'npx --yes --package=node@22.23.1 --package=npm@10.9.8 -c "npm ci"')
  assert.equal(config.buildCommand, 'npx --yes --package=node@22.23.1 --package=npm@10.9.8 -c "npm run build"')
})

test('standalone Docker builder and runtime retain the complete production build contract', () => {
  const runtimeMarker = 'FROM node:22.23.1-alpine AS runtime'
  const runtimeOffset = dockerfile.indexOf(runtimeMarker)
  assert.notEqual(runtimeOffset, -1, 'Dockerfile.web must contain the pinned standalone runtime stage')

  const builder = dockerfile.slice(0, runtimeOffset)
  const runtime = dockerfile.slice(runtimeOffset)
  const requiredBuildArguments = [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT',
    'NEXT_PUBLIC_DEMO_REQUEST_ENABLED',
    'NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL',
    'SERVER_ACTION_ALLOWED_ORIGINS',
    'BLOCKXONE_RELEASE_MODE',
    'NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE',
    'BLOCKXONE_WEB_SURFACE',
    'NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE',
    'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE',
  ]

  for (const argument of requiredBuildArguments) {
    assert.match(builder, new RegExp(`^ARG ${argument}$`, 'm'), `builder is missing ARG ${argument}`)
    assert.match(runtime, new RegExp(`^ARG ${argument}$`, 'm'), `runtime is missing ARG ${argument}`)
    assert.match(runtime, new RegExp(`^ENV ${argument}=\\$\\{${argument}\\}$`, 'm'), `runtime is missing ENV ${argument}`)
  }

  assert.match(builder, /^ENV NODE_ENV=production$/m)
  assert.match(runtime, /^ENV NODE_ENV=production$/m)
  assert.match(runtime, /^ENV PORT=3000$/m)
  assert.match(runtime, /^ENV HOSTNAME=0\.0\.0\.0$/m)
  assert.match(runtime, /COPY --from=builder --chown=node:node \/build\/\.next\/standalone \.\//)
  assert.match(runtime, /HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3/)
  assert.match(runtime, /http:\/\/127\.0\.0\.1:3000\//)
  assert.match(runtime, /x\.on\('end',\(\)=>process\.exit\(x\.statusCode===200\?0:1\)\)/)
  assert.match(runtime, /^CMD \["node", "server\.js"\]$/m)
})

test('authenticated navigation uses its compact menu below the extra-large breakpoint', () => {
  assert.match(navbar, /className="hidden xl:flex items-center gap-1"/)
  assert.equal((navbar.match(/xl:hidden/g) || []).length, 2)
  assert.doesNotMatch(navbar, /className="hidden md:flex items-center gap-1"/)
  assert.doesNotMatch(navbar, /md:hidden/)
})

function loadNativeConfig(changed = {}) {
  const environment = Object.assign(createOperatingSystemEnvironment(), {
    NODE_ENV: 'production', BLOCKXONE_WEB_SURFACE: 'public', NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE: 'public',
    BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(32),
    BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za',
    NEXT_PUBLIC_API_URL: 'https://stale-legacy-api.example',
    NEXT_PUBLIC_DEMO_REQUEST_ENABLED: 'false', SERVER_ACTION_ALLOWED_ORIGINS: 'bx1.co.za',
  }, changed)
  return spawnSync(process.execPath, ['-e', "const c=require('./next.config.js');Promise.all([c.rewrites(),c.headers()]).then(([rewrites,headers])=>console.log(JSON.stringify({rewrites,headers}))).catch(()=>process.exit(1))"], {
    cwd: webRoot, env: environment, encoding: 'utf8', windowsHide: true,
  })
}

test('native production config has no legacy rewrite and private Auth/workspace response rules', () => {
  const result = loadNativeConfig()
  assert.equal(result.status, 0, result.stderr)
  const configuration = JSON.parse(result.stdout)
  assert.deepEqual(configuration.rewrites, [])
  for (const source of ['/login', '/auth/:path*', '/workspace/:path*']) {
    const headers = configuration.headers.find((entry) => entry.source === source)?.headers
    assert.ok(headers, source)
    assert.ok(headers.some(({ key, value }) => key === 'Cache-Control' && value === 'private, no-store'))
    const expectedReferrerPolicy = source === '/auth/:path*' ? 'no-referrer' : 'strict-origin'
    assert.ok(headers.some(({ key, value }) => key === 'Referrer-Policy' && value === expectedReferrerPolicy))
  }
})

test('native production configuration rejects mismatches and server secret-key classes', () => {
  for (const changed of [
    { NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: '' },
    { BLOCKXONE_AUTH_MODE: 'unknown' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture_never_echo' },
    { SUPABASE_SERVICE_ROLE_KEY: 'fixture_never_echo' },
  ]) {
    const result = loadNativeConfig(changed)
    assert.notEqual(result.status, 0)
    assert.ok(!result.stderr.includes('fixture_never_echo'))
  }
})
