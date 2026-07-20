import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const requiredNodeVersion = '22.23.1'
const requiredNpmVersion = '10.9.8'
const requiredOverrides = {
  'adm-zip': '0.6.0',
  diff: '8.0.3',
  'serialize-javascript': '7.0.7',
}

const requiredHardhatPackages = [
  '@nomicfoundation/hardhat-ethers',
  '@nomicfoundation/hardhat-ethers-chai-matchers',
  '@nomicfoundation/hardhat-mocha',
  '@nomicfoundation/hardhat-typechain',
  '@types/mocha',
  '@types/node',
  'chai',
  'ethers',
  'hardhat',
  'mocha',
  'typescript',
]

export function evaluatePreflight({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  nodeVersion = process.versions.node,
  npmUserAgent = process.env.npm_config_user_agent,
  platform = process.platform,
} = {}) {
  const argSet = new Set(args)
  const failures = []
  const npmVersion = /(?:^|\s)npm\/([^\s]+)/.exec(npmUserAgent || '')?.[1] || ''

  function resolvePath(relativePath) {
    return path.join(cwd, relativePath)
  }

  function packagePath(packageName) {
    return path.join(cwd, 'node_modules', ...packageName.split('/'), 'package.json')
  }

  function packageInstalled(packageName) {
    return existsSync(packagePath(packageName))
  }

  function readJson(relativePath) {
    try {
      return JSON.parse(readFileSync(resolvePath(relativePath), 'utf8'))
    } catch (error) {
      failures.push(`${relativePath} is not valid JSON: ${error.message}`)
      return null
    }
  }

  if (nodeVersion !== requiredNodeVersion) {
    failures.push(
      `Node ${nodeVersion} is not supported for the contracts toolchain. Use exactly Node ${requiredNodeVersion}.`
    )
  }

  if (npmVersion !== requiredNpmVersion) {
    failures.push(
      npmVersion
        ? `npm ${npmVersion} is not supported for the contracts toolchain. Use exactly npm ${requiredNpmVersion}.`
        : `npm ${requiredNpmVersion} is required; run contract lifecycle commands through npm.`
    )
  }

  let packageJson = null
  if (!existsSync(resolvePath('package.json'))) {
    failures.push('package.json is missing; contracts tooling must run from the contracts package root.')
  } else {
    packageJson = readJson('package.json')
  }

  if (packageJson) {
    for (const [packageName, requiredVersion] of Object.entries(requiredOverrides)) {
      const actualVersion = packageJson.overrides?.[packageName]
      if (actualVersion !== requiredVersion) {
        failures.push(
          `package.json must override ${packageName} to exactly ${requiredVersion}; found ${actualVersion || 'missing'}.`
        )
      }
    }
  }

  if (!existsSync(resolvePath('package-lock.json'))) {
    failures.push('package-lock.json is missing; install from a committed lockfile before compiling.')
  } else {
    readJson('package-lock.json')
  }

  if (argSet.has('--require-hardhat')) {
    const hardhatBin = platform === 'win32'
      ? path.join('node_modules', '.bin', 'hardhat.cmd')
      : path.join('node_modules', '.bin', 'hardhat')
    const missingPackages = requiredHardhatPackages.filter((packageName) => !packageInstalled(packageName))

    if (missingPackages.length) {
      failures.push(
        `Contracts dependencies are not fully installed. Missing: ${missingPackages.join(', ')}. Run \`npm ci\` with Node 22.23.1 before compile/test.`
      )
    }

    if (!existsSync(resolvePath(hardhatBin))) {
      failures.push(`Hardhat CLI shim is missing at ${hardhatBin}. Restore dependencies with \`npm ci\`.`)
    }
  }

  const networkFlagIndex = args.indexOf('--require-network')
  if (networkFlagIndex !== -1) {
    const network = args[networkFlagIndex + 1]
    const rpcEnv = network === 'goerli' ? 'GOERLI_RPC_URL' : 'SEPOLIA_RPC_URL'

    if (!env[rpcEnv]) {
      failures.push(`${rpcEnv} is required for ${network || 'network'} deployment.`)
    }

    if (!env.DEPLOYER_PRIVATE_KEY) {
      failures.push('DEPLOYER_PRIVATE_KEY is required for deployment and must be supplied by the operator.')
    }
  }

  return { failures, nodeVersion, npmVersion }
}

export function runPreflightCli() {
  const result = evaluatePreflight()

  if (result.failures.length) {
    console.error('Contracts toolchain preflight failed:')
    for (const failure of result.failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.log(`Contracts toolchain preflight passed with Node ${result.nodeVersion} and npm ${result.npmVersion}.`)
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runPreflightCli()
}
