import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const webRoot = fileURLToPath(new URL('..', import.meta.url))
export const vitestExecutable = path.join(webRoot, 'node_modules', 'vitest', 'vitest.mjs')
export const vitestConfig = path.join(webRoot, 'vitest.config.ts')

const commonEnvironmentNames = ['PATH']
const windowsEnvironmentNames = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'SystemDrive']
const posixEnvironmentNames = ['HOME', 'TMPDIR']
const forbiddenForwardedName = /(?:database|rpc|provider|signing|token|password|secret|credential|private[_-]?key|prod(?:uction)?[^a-z0-9]*url|url[^a-z0-9]*prod(?:uction)?)/i

function inheritedValue(source, requestedName, platform) {
  if (platform !== 'win32') return source[requestedName]

  const matches = Object.entries(source).filter(([name]) => name.toLowerCase() === requestedName.toLowerCase())
  if (matches.length > 1 && new Set(matches.map(([, value]) => value)).size > 1) {
    throw new Error(`Ambiguous case-insensitive Windows environment value for ${requestedName}.`)
  }
  return matches[0]?.[1]
}

export function createOperatingSystemEnvironment(source = process.env, platform = process.platform) {
  const output = {}
  const names = [
    ...commonEnvironmentNames,
    ...(platform === 'win32' ? windowsEnvironmentNames : posixEnvironmentNames),
  ]

  for (const name of names) {
    if (forbiddenForwardedName.test(name)) {
      throw new Error(`Refusing to forward prohibited environment name ${name}.`)
    }
    const value = inheritedValue(source, name, platform)
    if (typeof value === 'string' && value.length > 0) output[name] = value
  }

  if (!output.PATH) throw new Error('PATH is required by the documented child-process environment contract.')
  return output
}

export function createHermeticTestEnvironment(cacheDirectory, source = process.env, platform = process.platform) {
  if (!path.isAbsolute(cacheDirectory)) throw new Error('The Vitest cache path must be absolute.')

  return Object.assign(createOperatingSystemEnvironment(source, platform), {
    NODE_ENV: 'test',
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    NEXT_PUBLIC_API_URL: 'https://api.blockxone.example',
    SERVER_ACTION_ALLOWED_ORIGINS: 'app.blockxone.example',
    BLOCKXONE_HERMETIC_RUNNER: '1',
    BLOCKXONE_VITEST_CACHE_DIR: cacheDirectory,
  })
}

export function normalizeVitestArguments(args) {
  const normalized = []
  for (const argument of args) {
    if (argument === '--run') continue
    throw new Error(
      `Unsupported Vitest argument ${JSON.stringify(argument)}. The controlled runner accepts only legacy --run flags.`
    )
  }
  return normalized
}

async function createGeneratedCacheDirectory() {
  const resolvedTemporaryRoot = await realpath(tmpdir())
  const generated = await mkdtemp(path.join(resolvedTemporaryRoot, 'blockxone-vitest-'))
  return { cacheDirectory: await realpath(generated), resolvedTemporaryRoot }
}

export async function removeGeneratedCacheDirectory(cacheDirectory, resolvedTemporaryRoot) {
  const resolvedCacheDirectory = path.resolve(cacheDirectory)
  const relative = path.relative(resolvedTemporaryRoot, resolvedCacheDirectory)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.dirname(resolvedCacheDirectory) !== resolvedTemporaryRoot ||
    !path.basename(resolvedCacheDirectory).startsWith('blockxone-vitest-')
  ) {
    throw new Error('Refusing to remove a cache path outside the exact operating-system temporary root.')
  }

  const cacheStat = await lstat(resolvedCacheDirectory)
  if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) {
    throw new Error('Refusing to recursively remove a non-directory or linked cache path.')
  }

  await rm(resolvedCacheDirectory, { recursive: true, force: false })
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

export async function runHermeticVitest({
  args = [],
  inheritedEnvironment = process.env,
  platform = process.platform,
  spawnImplementation = spawn,
  stdio = 'inherit',
} = {}) {
  normalizeVitestArguments(args)
  if (!existsSync(vitestExecutable)) {
    throw new Error(`Pinned local Vitest module is missing at ${vitestExecutable}. Install the exact locked dependencies first.`)
  }

  const { cacheDirectory, resolvedTemporaryRoot } = await createGeneratedCacheDirectory()
  console.log(`BLOCKXONE_HERMETIC_CACHE_CREATED=${cacheDirectory}`)

  try {
    const child = spawnImplementation(
      process.execPath,
      [vitestExecutable, 'run', '--config', vitestConfig],
      {
        cwd: webRoot,
        env: createHermeticTestEnvironment(cacheDirectory, inheritedEnvironment, platform),
        stdio,
        shell: false,
        windowsHide: true,
      }
    )
    return await waitForChild(child)
  } finally {
    await removeGeneratedCacheDirectory(cacheDirectory, resolvedTemporaryRoot)
    console.log(`BLOCKXONE_HERMETIC_CACHE_CLEANED=${cacheDirectory}`)
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const modulePath = fileURLToPath(import.meta.url)
const isCli = process.platform === 'win32'
  ? invokedPath.toLowerCase() === modulePath.toLowerCase()
  : invokedPath === modulePath

if (isCli) {
  try {
    process.exitCode = await runHermeticVitest({ args: process.argv.slice(2) })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
