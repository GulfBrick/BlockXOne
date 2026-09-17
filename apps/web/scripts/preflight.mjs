import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import policy from './production-url-policy.cjs'

export const requiredNodeVersion = '22.23.1'
export const requiredNpmVersion = '10.9.8'

function npmVersionFromUserAgent(userAgent) {
  return /(?:^|\s)npm\/([^\s]+)/.exec(userAgent || '')?.[1] || ''
}

export function npmVersionFromCli(npmCliPath = process.env.npm_execpath) {
  if (!npmCliPath || !path.isAbsolute(npmCliPath)) return ''
  try {
    const npmPackage = JSON.parse(readFileSync(
      path.resolve(path.dirname(npmCliPath), '..', 'package.json'), 'utf8'
    ))
    return npmPackage.name === 'npm' ? npmPackage.version || '' : ''
  } catch {
    return ''
  }
}

export function evaluatePreflight({
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  npmUserAgent = process.env.npm_config_user_agent,
  npmCliVersion,
  environment = process.env,
} = {}) {
  const failures = []
  const npmVersion = npmCliVersion ?? npmVersionFromUserAgent(npmUserAgent)

  if (nodeVersion !== requiredNodeVersion) {
    failures.push(
      `Node ${nodeVersion} is not supported for the web toolchain. Use exactly Node ${requiredNodeVersion}.`
    )
  }

  if (npmVersion !== requiredNpmVersion) {
    failures.push(
      npmVersion
        ? `npm ${npmVersion} is not supported for the web toolchain. Use exactly npm ${requiredNpmVersion}.`
        : `npm ${requiredNpmVersion} is required; run web lifecycle commands through npm.`
    )
  }

  for (const filename of ['package.json', 'package-lock.json']) {
    const target = path.join(cwd, filename)
    if (!existsSync(target)) {
      failures.push(`${filename} is missing; web tooling must run from the web package root.`)
      continue
    }

    try {
      JSON.parse(readFileSync(target, 'utf8'))
    } catch (error) {
      failures.push(`${filename} is not valid JSON: ${error.message}`)
    }
  }

  try {
    policy.validateSupabaseAuthConfiguration({
      authMode: environment.BLOCKXONE_AUTH_MODE,
      publicAuthMode: environment.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE,
      supabaseUrl: environment.SUPABASE_URL,
      publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
      appOrigin: environment.BLOCKXONE_APP_ORIGIN,
      environment,
    })
  } catch (error) {
    failures.push(error.message)
  }

  return { failures, nodeVersion, npmVersion }
}

export function runPreflightCli() {
  // npx can retain the caller's user-agent after selecting a pinned npm.
  // Verify the actual executing npm package rather than that inherited string.
  const result = evaluatePreflight({ npmCliVersion: npmVersionFromCli() })
  if (result.failures.length) {
    console.error('Web toolchain preflight failed:')
    for (const failure of result.failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.log(`Web toolchain preflight passed with Node ${result.nodeVersion} and npm ${result.npmVersion}.`)
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runPreflightCli()
}
