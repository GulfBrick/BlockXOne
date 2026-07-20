import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const requiredNodeVersion = '22.23.1'
export const requiredNpmVersion = '10.9.8'

function npmVersionFromUserAgent(userAgent) {
  return /(?:^|\s)npm\/([^\s]+)/.exec(userAgent || '')?.[1] || ''
}

export function evaluatePreflight({
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  npmUserAgent = process.env.npm_config_user_agent,
} = {}) {
  const failures = []
  const npmVersion = npmVersionFromUserAgent(npmUserAgent)

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

  return { failures, nodeVersion, npmVersion }
}

export function runPreflightCli() {
  const result = evaluatePreflight()
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
