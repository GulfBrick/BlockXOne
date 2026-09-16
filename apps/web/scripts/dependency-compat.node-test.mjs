import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedExpansion = ['a.js', 'b.js']

test('CommonJS facade is callable and exposes the exact upstream expand function', () => {
  const facade = require('brace-expansion')
  const upstream = require('brace-expansion-upstream')

  assert.equal(typeof upstream.expand, 'function')
  assert.strictEqual(facade, upstream.expand)
  assert.strictEqual(facade.expand, upstream.expand)
  assert.deepEqual(facade('{a,b}.js'), expectedExpansion)
})

test('ES module facade exposes exact upstream default and named references', async () => {
  const [facade, upstream] = await Promise.all([
    import('brace-expansion'),
    import('brace-expansion-upstream'),
  ])

  assert.equal(typeof upstream.expand, 'function')
  assert.strictEqual(facade.default, upstream.expand)
  assert.strictEqual(facade.expand, upstream.expand)
  assert.deepEqual(facade.expand('{a,b}.js'), expectedExpansion)
})

test('patched maxLength behavior deterministically bounds advisory-shaped expansion', async () => {
  const [facade, upstream] = await Promise.all([
    import('brace-expansion'),
    import('brace-expansion-upstream'),
  ])
  const input = '{a,b}'.repeat(100)
  const options = Object.freeze({ max: 100_000, maxLength: 10_000 })
  const facadeResult = facade.expand(input, options)
  const upstreamResult = upstream.expand(input, options)

  assert.deepEqual(facadeResult, upstreamResult)
  assert.deepEqual(facade.expand(input, options), facadeResult)
  assert.equal(
    facadeResult.reduce((total, value) => total + value.length, 0),
    options.maxLength,
  )
})

test('installed legacy and modern minimatch consumers retain representative behavior', async () => {
  const lock = JSON.parse(await readFile(path.join(packageRoot, 'package-lock.json'), 'utf8'))
  const entries = Object.entries(lock.packages)
    .filter(([key]) => /(^|\/)node_modules\/minimatch$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
  const versions = [...new Set(entries.map(([, metadata]) => metadata.version))].sort()

  assert.deepEqual(versions, ['3.1.5', '9.0.9'])
  for (const [key, metadata] of entries) {
    const loaded = require(path.join(packageRoot, ...key.split('/')))
    const minimatch = typeof loaded === 'function' ? loaded : loaded.minimatch

    assert.equal(typeof minimatch, 'function', `minimatch ${metadata.version} export`)
    assert.equal(minimatch('a.js', '{a,b}.js'), true, `minimatch ${metadata.version} match`)
    assert.equal(minimatch('c.js', '{a,b}.js'), false, `minimatch ${metadata.version} miss`)
  }
})
