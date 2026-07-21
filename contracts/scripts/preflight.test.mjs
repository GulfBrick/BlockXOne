import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(scriptDir, 'preflight.mjs')
const deployScriptPath = path.resolve(scriptDir, 'deploy.ts')
const contractsRoot = path.resolve(scriptDir, '..')
const hardhatConfigPath = path.resolve(contractsRoot, 'hardhat.config.ts')
const packageJsonPath = path.resolve(contractsRoot, 'package.json')
const packageLockPath = path.resolve(contractsRoot, 'package-lock.json')
const { evaluatePreflight } = await import(pathToFileURL(scriptPath))

async function readActualCompilerPolicy() {
  const importedConfig = await import(pathToFileURL(hardhatConfigPath))
  return {
    hardhatConfig: importedConfig.default,
    packageJson: JSON.parse(readFileSync(packageJsonPath, 'utf8')),
    packageLock: JSON.parse(readFileSync(packageLockPath, 'utf8')),
  }
}

function compilerPolicyFailures({ hardhatConfig, packageJson, packageLock }) {
  const failures = []
  const solidity = hardhatConfig?.solidity
  if (!solidity || Array.isArray(solidity) || typeof solidity !== 'object') {
    failures.push('Hardhat must export one Solidity compiler configuration object.')
    return failures
  }
  if (solidity.version !== '0.8.20') failures.push(`Solidity must be exactly 0.8.20; found ${solidity.version || 'missing'}.`)
  if (solidity.settings?.optimizer?.enabled !== true) failures.push('Solidity optimizer must be enabled.')
  if (solidity.settings?.optimizer?.runs !== 200) {
    failures.push(`Solidity optimizer runs must be exactly 200; found ${solidity.settings?.optimizer?.runs ?? 'missing'}.`)
  }
  if (solidity.settings?.evmVersion !== 'shanghai') {
    failures.push(`Solidity EVM target must be exactly shanghai; found ${solidity.settings?.evmVersion || 'missing'}.`)
  }
  if (packageJson?.devDependencies?.hardhat !== '3.10.0') {
    failures.push(`package.json must pin Hardhat 3.10.0; found ${packageJson?.devDependencies?.hardhat || 'missing'}.`)
  }
  if (packageLock?.packages?.['']?.devDependencies?.hardhat !== '3.10.0') {
    failures.push(
      `package-lock.json root must pin Hardhat 3.10.0; found ${packageLock?.packages?.['']?.devDependencies?.hardhat || 'missing'}.`
    )
  }
  if (packageLock?.packages?.['node_modules/hardhat']?.version !== '3.10.0') {
    failures.push(
      `package-lock.json installed Hardhat must be 3.10.0; found ${packageLock?.packages?.['node_modules/hardhat']?.version || 'missing'}.`
    )
  }
  return failures
}

function withTempContractsPackage(setup, run) {
  const dir = path.join(tmpdir(), `bxo-contracts-preflight-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  try {
    setup(dir)
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writePackageFiles(dir) {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: '@blockxone/contracts',
    private: true,
    overrides: {
      'adm-zip': '0.6.0',
      diff: '8.0.3',
      'serialize-javascript': '7.0.7',
    },
  }, null, 2))
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: '@blockxone/contracts', lockfileVersion: 3 }, null, 2))
}

function writeInstalledPackage(dir, packageName) {
  const packageDir = path.join(dir, 'node_modules', ...packageName.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName }, null, 2))
}

function runPreflight(dir, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: dir,
    encoding: 'utf8',
  })
}

test('fails clearly when run outside the contracts package root', () => {
  const result = withTempContractsPackage(
    () => {},
    (dir) => runPreflight(dir)
  )

  assert.equal(result.status, 1)
  assert.match(result.stderr, /package\.json is missing/)
  assert.match(result.stderr, /package-lock\.json is missing/)
})

test('reports incomplete Hardhat dependency restore', () => {
  const result = withTempContractsPackage(
    writePackageFiles,
    (dir) => runPreflight(dir, ['--require-hardhat'])
  )

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Contracts dependencies are not fully installed/)
  assert.match(result.stderr, /hardhat/)
  assert.match(result.stderr, /npm ci/)
})

test('rejects every Node version other than the exact repository pin', () => {
  const result = withTempContractsPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '25.2.1',
      npmUserAgent: 'npm/10.9.8 node/v25.2.1 win32 x64',
      platform: process.platform,
    })
  )

  assert.deepEqual(result.failures, [
    'Node 25.2.1 is not supported for the contracts toolchain. Use exactly Node 22.23.1.',
  ])
})

test('rejects the former Node 20 toolchain', () => {
  const result = withTempContractsPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '20.10.0',
      npmUserAgent: 'npm/10.9.8 node/v20.10.0 win32 x64',
      platform: process.platform,
    })
  )

  assert.deepEqual(result.failures, [
    'Node 20.10.0 is not supported for the contracts toolchain. Use exactly Node 22.23.1.',
  ])
})

test('passes when the required local Hardhat packages and CLI shim exist', () => {
  const result = withTempContractsPackage(
    (dir) => {
      writePackageFiles(dir)
      for (const packageName of [
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
      ]) {
        writeInstalledPackage(dir, packageName)
      }
      const binDir = path.join(dir, 'node_modules', '.bin')
      mkdirSync(binDir, { recursive: true })
      const shim = process.platform === 'win32' ? 'hardhat.cmd' : 'hardhat'
      writeFileSync(path.join(binDir, shim), '')
    },
    (dir) => evaluatePreflight({
      args: ['--require-hardhat'],
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: 'npm/10.9.8 node/v22.23.1 win32 x64',
      platform: process.platform,
    })
  )

  assert.deepEqual(result.failures, [])
})

test('rejects an unsupported npm release', () => {
  const result = withTempContractsPackage(
    writePackageFiles,
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: 'npm/11.0.0 node/v22.23.1 win32 x64',
      platform: process.platform,
    })
  )

  assert.deepEqual(result.failures, [
    'npm 11.0.0 is not supported for the contracts toolchain. Use exactly npm 10.9.8.',
  ])
})

test('rejects missing or drifted patched transitive overrides', () => {
  const result = withTempContractsPackage(
    (dir) => {
      writePackageFiles(dir)
      const packageJsonPath = path.join(dir, 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      packageJson.overrides['adm-zip'] = '0.5.16'
      delete packageJson.overrides['serialize-javascript']
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
    },
    (dir) => evaluatePreflight({
      cwd: dir,
      nodeVersion: '22.23.1',
      npmUserAgent: 'npm/10.9.8 node/v22.23.1 win32 x64',
      platform: process.platform,
    })
  )

  assert.deepEqual(result.failures, [
    'package.json must override adm-zip to exactly 0.6.0; found 0.5.16.',
    'package.json must override serialize-javascript to exactly 7.0.7; found missing.',
  ])
})

test('deployment script uses an explicit Hardhat 3 network connection', () => {
  const source = readFileSync(deployScriptPath, 'utf8')

  assert.match(source, /import hre from ['"]hardhat['"]/)
  assert.match(source, /await hre\.network\.create\(\)/)
  assert.doesNotMatch(source, /import\s*{\s*ethers\s*}\s*from\s*['"]hardhat['"]/)
})

test('inspects the actual exported Hardhat compiler policy and locked release', async () => {
  assert.deepEqual(compilerPolicyFailures(await readActualCompilerPolicy()), [])
})

test('fails closed on compiler and Hardhat policy drift', async () => {
  const actual = await readActualCompilerPolicy()
  const solidity = actual.hardhatConfig.solidity
  const cases = [
    ['compiler version', { ...actual, hardhatConfig: { ...actual.hardhatConfig, solidity: { ...solidity, version: '0.8.24' } } }],
    [
      'optimizer enabled',
      {
        ...actual,
        hardhatConfig: {
          ...actual.hardhatConfig,
          solidity: { ...solidity, settings: { ...solidity.settings, optimizer: { ...solidity.settings.optimizer, enabled: false } } },
        },
      },
    ],
    [
      'optimizer runs',
      {
        ...actual,
        hardhatConfig: {
          ...actual.hardhatConfig,
          solidity: { ...solidity, settings: { ...solidity.settings, optimizer: { ...solidity.settings.optimizer, runs: 1 } } },
        },
      },
    ],
    [
      'EVM target',
      {
        ...actual,
        hardhatConfig: { ...actual.hardhatConfig, solidity: { ...solidity, settings: { ...solidity.settings, evmVersion: 'cancun' } } },
      },
    ],
    [
      'Hardhat package',
      {
        ...actual,
        packageJson: { ...actual.packageJson, devDependencies: { ...actual.packageJson.devDependencies, hardhat: '3.9.0' } },
      },
    ],
    [
      'Hardhat lock root',
      {
        ...actual,
        packageLock: {
          ...actual.packageLock,
          packages: {
            ...actual.packageLock.packages,
            '': {
              ...actual.packageLock.packages[''],
              devDependencies: { ...actual.packageLock.packages[''].devDependencies, hardhat: '3.9.0' },
            },
          },
        },
      },
    ],
    [
      'Hardhat installed lock',
      {
        ...actual,
        packageLock: {
          ...actual.packageLock,
          packages: {
            ...actual.packageLock.packages,
            'node_modules/hardhat': { ...actual.packageLock.packages['node_modules/hardhat'], version: '3.9.0' },
          },
        },
      },
    ],
  ]

  for (const [label, policy] of cases) {
    assert.notDeepEqual(compilerPolicyFailures(policy), [], `${label} drift must fail`)
  }
})
