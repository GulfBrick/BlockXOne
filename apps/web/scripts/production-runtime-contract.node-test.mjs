import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(webRoot, '..', '..')

const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile.web'), 'utf8')
const navbar = readFileSync(path.join(webRoot, 'src', 'components', 'ui', 'navbar.tsx'), 'utf8')

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
