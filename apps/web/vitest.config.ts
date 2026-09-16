import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const cacheDirectory = process.env.BLOCKXONE_VITEST_CACHE_DIR

if (process.env.BLOCKXONE_HERMETIC_RUNNER !== '1') {
  throw new Error('Vitest must be invoked through scripts/run-hermetic-tests.mjs.')
}

if (!cacheDirectory || !existsSync(cacheDirectory)) {
  throw new Error('The hermetic runner did not provide an existing per-run Vitest cache directory.')
}

const resolvedTemporaryRoot = realpathSync(tmpdir())
const resolvedCacheDirectory = realpathSync(cacheDirectory)
const cacheRelativePath = path.relative(resolvedTemporaryRoot, resolvedCacheDirectory)

if (
  !cacheRelativePath ||
  cacheRelativePath.startsWith(`..${path.sep}`) ||
  cacheRelativePath === '..' ||
  path.isAbsolute(cacheRelativePath) ||
  path.dirname(resolvedCacheDirectory) !== resolvedTemporaryRoot ||
  !path.basename(resolvedCacheDirectory).startsWith('blockxone-vitest-')
) {
  throw new Error('The Vitest cache must be the runner-generated child of the operating-system temp directory.')
}

export default defineConfig({
  root: webRoot,
  resolve: {
    alias: { '@': path.join(webRoot, 'src') },
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  cacheDir: resolvedCacheDirectory,
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/build/**',
      '**/dist/**',
      '**/coverage/**',
      'scripts/**',
      '**/.npm-cache/**',
      '**/.vite/**',
      '**/.vitest/**',
      '**/_incoming_fullstack/**',
    ],
    setupFiles: ['./src/test/hermetic-network-guard.ts'],
    environment: 'node',
    isolate: true,
    fileParallelism: false,
    passWithNoTests: false,
    watch: false,
    clearMocks: true,
    restoreMocks: true,
  },
})
