import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const MANIFEST_SCHEMA = 'blockxone-bytecode-manifest-v2'
const COMPARISON_SCHEMA = 'blockxone-bytecode-comparison-v2'
const CAPTURE_TOOL_PATH = 'contracts/scripts/capture-bytecode-manifest.mjs'
const REQUIRED_NODE = '22.23.1'
const REQUIRED_NPM = '10.9.8'
const REQUIRED_HARDHAT = '3.10.0'
const REQUIRED_SOLC = '0.8.20'
const REQUIRED_EVM = 'shanghai'
const REQUIRED_OPTIMIZER_RUNS = 200
const MAX_GIT_OUTPUT = 128 * 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value, label = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`)
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalize(entry, `${label}[${index}]`))
  if (typeof value !== 'object') fail(`${label} contains unsupported data`)
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) fail(`${label}.${key} is undefined`)
    result[key] = canonicalize(value[key], `${label}.${key}`)
  }
  return result
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function prettyCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
}

function assertExactKeys(value, expectedKeys, label) {
  assertObject(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} keys differ; expected ${expected.join(', ')}, found ${actual.join(', ')}`)
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be a lowercase SHA-256`)
}

function assertGitOid(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value) || /^0+$/.test(value)) {
    fail(`${label} must be a nonzero full lowercase Git object ID`)
  }
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative safe integer`)
}

function assertSortedUnique(items, key, label) {
  if (!Array.isArray(items)) fail(`${label} must be an array`)
  const values = items.map((item) => item[key])
  const sorted = [...values].sort(compareText)
  if (canonicalJson(values) !== canonicalJson(sorted)) fail(`${label} must be sorted by ${key}`)
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate ${key} values`)
}

function assertEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label} differs`)
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a nonempty string`)
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) fail(`${label} must be relative`)
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} contains an unsafe path segment`)
  }
  return normalized
}

function comparablePath(value) {
  const normalized = path.normalize(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function resolveReal(value, expectedType, label) {
  const absolute = path.resolve(value)
  let status
  try {
    status = lstatSync(absolute)
  } catch {
    fail(`${label} does not exist`)
  }
  if (status.isSymbolicLink()) fail(`${label} must not be a symbolic link or junction`)
  if (expectedType === 'file' && !status.isFile()) fail(`${label} must be a file`)
  if (expectedType === 'directory' && !status.isDirectory()) fail(`${label} must be a directory`)
  const real = realpathSync.native(absolute)
  if (comparablePath(real) !== comparablePath(absolute)) {
    fail(`${label} resolves through a symbolic link, junction or reparse point`)
  }
  return real
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} is not really contained by its required root`)
  }
}

function resolveOutput(value) {
  const output = path.resolve(value)
  if (existsSync(output)) fail('output file must not already exist')
  const parent = resolveReal(path.dirname(output), 'directory', 'output parent')
  if (comparablePath(parent) !== comparablePath(path.dirname(output))) fail('output parent contains path ambiguity')
  return output
}

function parseArgs(argv) {
  const allowed = new Set([
    '--baseline',
    '--candidate',
    '--capture-script',
    '--git-executable',
    '--git-repo',
    '--repo-contracts-root',
    '--baseline-commit',
    '--baseline-tree',
    '--candidate-commit',
    '--candidate-tree',
    '--tool-commit',
    '--tool-tree',
    '--tool-path',
    '--out',
  ])
  const values = {}
  if (argv.length % 2 !== 0) fail('every argument must have exactly one value')
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key)) fail(`unknown argument: ${key || '<missing>'}`)
    if (values[key] !== undefined) fail(`duplicate argument: ${key}`)
    if (value === undefined || value.startsWith('--')) fail(`missing value for ${key}`)
    values[key] = value
  }
  for (const key of allowed) if (values[key] === undefined) fail(`required argument is missing: ${key}`)
  for (const key of ['--baseline-commit', '--baseline-tree', '--candidate-commit', '--candidate-tree', '--tool-commit', '--tool-tree']) {
    assertGitOid(values[key], key)
  }
  if (values['--tool-path'] !== CAPTURE_TOOL_PATH) fail(`--tool-path must be exactly ${CAPTURE_TOOL_PATH}`)
  return values
}

function gitEnvironment() {
  return {
    ...process.env,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  }
}

function runGit(gitExecutable, repo, args, encoding = 'utf8') {
  try {
    return execFileSync(gitExecutable, ['-C', repo, ...args], {
      encoding,
      env: gitEnvironment(),
      maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true,
    })
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim().split(/\r?\n/)[0]
    fail(`Git command failed (${args[0]}): ${detail || 'unknown error'}`)
  }
}

function gitText(gitExecutable, repo, args) {
  return runGit(gitExecutable, repo, args, 'utf8').trim()
}

function verifyGitObject(gitExecutable, repo, commit, tree, label) {
  if (gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}^{commit}`]) !== commit) {
    fail(`${label} commit does not resolve exactly`)
  }
  if (gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}^{tree}`]) !== tree) {
    fail(`${label} commit tree differs from the supplied tree`)
  }
}

function gitBlob(gitExecutable, repo, commit, repoPath, label) {
  const normalizedPath = normalizeRelativePath(repoPath, `${label} path`)
  const oid = gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}:${normalizedPath}`])
  assertGitOid(oid, `${label} Git blob`)
  if (gitText(gitExecutable, repo, ['cat-file', '-t', oid]) !== 'blob') fail(`${label} object is not a blob`)
  const bytes = runGit(gitExecutable, repo, ['cat-file', 'blob', oid], null)
  return {
    byteLength: bytes.length,
    bytes,
    gitBlobOid: oid,
    path: normalizedPath,
    sha256: sha256(bytes),
  }
}

function trackedSolidityEvidence(gitExecutable, repo, commit, contractsRepoPath) {
  const prefix = `${contractsRepoPath}/src`
  const raw = runGit(gitExecutable, repo, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix], null)
  const files = []
  for (const record of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^([0-7]{6}) (blob) ([0-9a-f]{40})\t(.+)$/.exec(record)
    if (!match) fail('Git Solidity tree contains a malformed or non-blob entry')
    const [, mode, , gitBlobOid, repoPathValue] = match
    const repoPath = normalizeRelativePath(repoPathValue, 'tracked repository path')
    if (!repoPath.startsWith(`${prefix}/`)) fail('Git returned a path outside contracts/src')
    if (!repoPath.endsWith('.sol')) continue
    if (mode !== '100644') fail(`tracked Solidity source has unexpected mode: ${repoPath}`)
    const bytes = runGit(gitExecutable, repo, ['cat-file', 'blob', gitBlobOid], null)
    files.push({ byteLength: bytes.length, gitBlobOid, path: repoPath, sha256: sha256(bytes) })
  }
  files.sort((a, b) => compareText(a.path, b.path))
  if (files.length === 0) fail('Git commit contains zero tracked Solidity files')
  return files
}

function expectedRepositoryInputs(gitExecutable, repo, commit, contractsRepoPath) {
  const serializableBlob = (repoPath, label) => {
    const { bytes: _bytes, ...evidence } = gitBlob(gitExecutable, repo, commit, repoPath, label)
    return evidence
  }
  const solidityFiles = trackedSolidityEvidence(gitExecutable, repo, commit, contractsRepoPath)
  return {
    hardhatConfig: serializableBlob(`${contractsRepoPath}/hardhat.config.ts`, 'Hardhat config'),
    packageJson: serializableBlob(`${contractsRepoPath}/package.json`, 'package JSON'),
    packageLock: serializableBlob(`${contractsRepoPath}/package-lock.json`, 'package lock'),
    solidityFiles,
    solidityFileSetSha256: sha256(canonicalJson(solidityFiles)),
  }
}

function readManifest(filePath, label) {
  const resolved = resolveReal(filePath, 'file', label)
  const bytes = readFileSync(resolved)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
  validateManifest(value, label)
  return { bytes, value }
}

function validateFileEvidence(value, label) {
  assertExactKeys(value, ['byteLength', 'gitBlobOid', 'path', 'sha256'], label)
  assertNonnegativeInteger(value.byteLength, `${label}.byteLength`)
  assertGitOid(value.gitBlobOid, `${label}.gitBlobOid`)
  normalizeRelativePath(value.path, `${label}.path`)
  assertSha256(value.sha256, `${label}.sha256`)
}

function validateRanges(ranges, byteLength, label) {
  if (!Array.isArray(ranges) || ranges.length === 0) fail(`${label} must be a nonempty array`)
  const seen = new Set()
  for (const [index, range] of ranges.entries()) {
    assertExactKeys(range, ['length', 'start'], `${label}[${index}]`)
    assertNonnegativeInteger(range.start, `${label}[${index}].start`)
    if (!Number.isSafeInteger(range.length) || range.length <= 0) fail(`${label}[${index}].length must be positive`)
    if (range.start + range.length > byteLength) fail(`${label}[${index}] exceeds bytecode length`)
    const identity = `${range.start}:${range.length}`
    if (seen.has(identity)) fail(`${label} contains duplicate ranges`)
    seen.add(identity)
  }
}

function validateLinkReferences(value, byteLength, label) {
  assertObject(value, label)
  for (const [sourceName, contracts] of Object.entries(value)) {
    normalizeRelativePath(sourceName, `${label} source`)
    assertObject(contracts, `${label}.${sourceName}`)
    if (Object.keys(contracts).length === 0) fail(`${label}.${sourceName} must not be empty`)
    for (const [contractName, ranges] of Object.entries(contracts)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contractName)) fail(`${label} contract name is invalid`)
      validateRanges(ranges, byteLength, `${label}.${sourceName}.${contractName}`)
    }
  }
}

function validateImmutableReferences(value, byteLength, label) {
  assertObject(value, label)
  for (const [identifier, ranges] of Object.entries(value)) {
    if (!/^[0-9]+$/.test(identifier)) fail(`${label} identifier is invalid`)
    validateRanges(ranges, byteLength, `${label}.${identifier}`)
  }
}

function validateBytecodeEvidence(value, label) {
  assertExactKeys(value, ['byteLength', 'metadata', 'sha256'], label)
  assertNonnegativeInteger(value.byteLength, `${label}.byteLength`)
  assertSha256(value.sha256, `${label}.sha256`)
  assertExactKeys(value.metadata, ['byteLength', 'sha256'], `${label}.metadata`)
  assertNonnegativeInteger(value.metadata.byteLength, `${label}.metadata.byteLength`)
  if (value.metadata.byteLength > value.byteLength) fail(`${label} metadata exceeds bytecode length`)
  assertSha256(value.metadata.sha256, `${label}.metadata.sha256`)
}

function validateManifest(manifest, label) {
  assertExactKeys(
    manifest,
    [
      'artifactFiles', 'buildInfoFiles', 'captureTool', 'compilerContractCount', 'compilerContracts',
      'compilerInputs', 'hashes', 'provenance', 'repeatBuild', 'repositoryInputs', 'schema', 'sources', 'toolchain',
      'userContractCount', 'userSourceMap',
    ],
    label
  )
  if (manifest.schema !== MANIFEST_SCHEMA) fail(`${label}.schema must be ${MANIFEST_SCHEMA}`)

  assertExactKeys(
    manifest.captureTool,
    ['byteLength', 'commit', 'gitBlobOid', 'path', 'schemaVersion', 'sha256', 'tree'],
    `${label}.captureTool`
  )
  if (manifest.captureTool.schemaVersion !== 2) fail(`${label}.captureTool.schemaVersion must be 2`)
  assertNonnegativeInteger(manifest.captureTool.byteLength, `${label}.captureTool.byteLength`)
  assertGitOid(manifest.captureTool.commit, `${label}.captureTool.commit`)
  assertGitOid(manifest.captureTool.tree, `${label}.captureTool.tree`)
  assertGitOid(manifest.captureTool.gitBlobOid, `${label}.captureTool.gitBlobOid`)
  if (manifest.captureTool.path !== CAPTURE_TOOL_PATH) fail(`${label}.captureTool.path differs`)
  assertSha256(manifest.captureTool.sha256, `${label}.captureTool.sha256`)

  assertExactKeys(
    manifest.provenance,
    ['commit', 'label', 'method', 'repositoryContractsRoot', 'tree'],
    `${label}.provenance`
  )
  assertGitOid(manifest.provenance.commit, `${label}.provenance.commit`)
  assertGitOid(manifest.provenance.tree, `${label}.provenance.tree`)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.provenance.label)) fail(`${label}.provenance.label is invalid`)
  if (manifest.provenance.method !== 'git-object-bound-archive') fail(`${label}.provenance.method differs`)
  if (manifest.provenance.repositoryContractsRoot !== 'contracts') fail(`${label}.repositoryContractsRoot differs`)

  assertExactKeys(manifest.repeatBuild, ['fileCount', 'method', 'treeSha256'], `${label}.repeatBuild`)
  if (!Number.isSafeInteger(manifest.repeatBuild.fileCount) || manifest.repeatBuild.fileCount <= 0) {
    fail(`${label}.repeatBuild.fileCount is invalid`)
  }
  if (manifest.repeatBuild.method !== 'distinct-root-exact-relative-path-byte-agreement') {
    fail(`${label}.repeatBuild.method differs`)
  }
  assertSha256(manifest.repeatBuild.treeSha256, `${label}.repeatBuild.treeSha256`)

  assertExactKeys(
    manifest.repositoryInputs,
    ['hardhatConfig', 'packageJson', 'packageLock', 'solidityFiles', 'solidityFileSetSha256'],
    `${label}.repositoryInputs`
  )
  validateFileEvidence(manifest.repositoryInputs.hardhatConfig, `${label}.repositoryInputs.hardhatConfig`)
  validateFileEvidence(manifest.repositoryInputs.packageJson, `${label}.repositoryInputs.packageJson`)
  validateFileEvidence(manifest.repositoryInputs.packageLock, `${label}.repositoryInputs.packageLock`)
  if (!Array.isArray(manifest.repositoryInputs.solidityFiles) || manifest.repositoryInputs.solidityFiles.length === 0) {
    fail(`${label}.repositoryInputs.solidityFiles must be nonempty`)
  }
  assertSortedUnique(manifest.repositoryInputs.solidityFiles, 'path', `${label}.repositoryInputs.solidityFiles`)
  for (const [index, file] of manifest.repositoryInputs.solidityFiles.entries()) {
    validateFileEvidence(file, `${label}.repositoryInputs.solidityFiles[${index}]`)
    if (!file.path.startsWith('contracts/src/') || !file.path.endsWith('.sol')) {
      fail(`${label}.repositoryInputs.solidityFiles[${index}] is outside contracts/src`)
    }
  }
  assertSha256(manifest.repositoryInputs.solidityFileSetSha256, `${label}.repositoryInputs.solidityFileSetSha256`)
  if (
    manifest.repositoryInputs.solidityFileSetSha256
    !== sha256(canonicalJson(manifest.repositoryInputs.solidityFiles))
  ) {
    fail(`${label}.repositoryInputs.solidityFileSetSha256 is stale`)
  }

  if (!Array.isArray(manifest.compilerInputs) || manifest.compilerInputs.length === 0) {
    fail(`${label}.compilerInputs must be nonempty`)
  }
  assertSortedUnique(manifest.compilerInputs, 'id', `${label}.compilerInputs`)
  const compilerInputById = new Map()
  for (const [index, input] of manifest.compilerInputs.entries()) {
    const inputLabel = `${label}.compilerInputs[${index}]`
    assertExactKeys(
      input,
      ['compilerType', 'evmVersion', 'id', 'optimizer', 'sha256', 'solcLongVersion', 'solcVersion'],
      inputLabel
    )
    if (input.compilerType !== 'solc' || input.solcVersion !== REQUIRED_SOLC || !input.solcLongVersion.startsWith(`${REQUIRED_SOLC}+`)) {
      fail(`${inputLabel} compiler identity differs`)
    }
    if (input.evmVersion !== REQUIRED_EVM) fail(`${inputLabel}.evmVersion differs`)
    assertExactKeys(input.optimizer, ['enabled', 'runs'], `${inputLabel}.optimizer`)
    if (input.optimizer.enabled !== true || input.optimizer.runs !== REQUIRED_OPTIMIZER_RUNS) {
      fail(`${inputLabel}.optimizer differs`)
    }
    if (typeof input.id !== 'string' || input.id.length === 0) fail(`${inputLabel}.id is missing`)
    assertSha256(input.sha256, `${inputLabel}.sha256`)
    compilerInputById.set(input.id, input)
  }

  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) fail(`${label}.sources must be nonempty`)
  assertSortedUnique(manifest.sources, 'sourceName', `${label}.sources`)
  const sourceNames = new Set()
  for (const [index, source] of manifest.sources.entries()) {
    const sourceLabel = `${label}.sources[${index}]`
    assertExactKeys(source, ['byteLength', 'sha256', 'sourceName'], sourceLabel)
    normalizeRelativePath(source.sourceName, `${sourceLabel}.sourceName`)
    assertNonnegativeInteger(source.byteLength, `${sourceLabel}.byteLength`)
    assertSha256(source.sha256, `${sourceLabel}.sha256`)
    sourceNames.add(source.sourceName)
  }

  if (!Array.isArray(manifest.userSourceMap) || manifest.userSourceMap.length === 0) {
    fail(`${label}.userSourceMap must be nonempty`)
  }
  assertSortedUnique(manifest.userSourceMap, 'sourceName', `${label}.userSourceMap`)
  const userMappingBySource = new Map()
  for (const [index, mapping] of manifest.userSourceMap.entries()) {
    const mappingLabel = `${label}.userSourceMap[${index}]`
    assertExactKeys(mapping, ['buildInfoId', 'compilerInputSha256', 'inputSourceName', 'sourceName'], mappingLabel)
    if (!mapping.sourceName.startsWith('src/') || !mapping.sourceName.endsWith('.sol')) fail(`${mappingLabel}.sourceName differs`)
    normalizeRelativePath(mapping.inputSourceName, `${mappingLabel}.inputSourceName`)
    const input = compilerInputById.get(mapping.buildInfoId)
    if (!input || input.sha256 !== mapping.compilerInputSha256) fail(`${mappingLabel} compiler input binding differs`)
    if (!sourceNames.has(mapping.inputSourceName)) fail(`${mappingLabel} input source is missing`)
    userMappingBySource.set(mapping.sourceName, mapping)
  }
  const trackedUserSources = manifest.repositoryInputs.solidityFiles
    .map((file) => file.path.slice('contracts/'.length))
    .sort(compareText)
  assertEqual([...userMappingBySource.keys()].sort(compareText), trackedUserSources, `${label} tracked/user source bijection`)

  if (!Array.isArray(manifest.compilerContracts) || manifest.compilerContracts.length === 0) {
    fail(`${label}.compilerContracts must be nonempty`)
  }
  if (manifest.compilerContractCount !== manifest.compilerContracts.length) fail(`${label}.compilerContractCount differs`)
  assertSortedUnique(manifest.compilerContracts, 'compilerFqn', `${label}.compilerContracts`)
  const compilerContractsByFqn = new Map()
  const userContractsByFqn = new Map()
  for (const [index, contract] of manifest.compilerContracts.entries()) {
    const contractLabel = `${label}.compilerContracts[${index}]`
    assertExactKeys(
      contract,
      [
        'abiEntryCount', 'abiSha256', 'buildInfoId', 'compilerFqn', 'compilerInputSha256', 'contractName',
        'creationBytecode', 'deployedBytecode', 'deployedLinkReferences', 'immutableReferences',
        'inputSourceName', 'linkReferences', 'userFqn', 'userSourceName',
      ],
      contractLabel
    )
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contract.contractName)) fail(`${contractLabel}.contractName differs`)
    if (contract.compilerFqn !== `${contract.inputSourceName}:${contract.contractName}`) fail(`${contractLabel}.compilerFqn differs`)
    if (!sourceNames.has(contract.inputSourceName)) fail(`${contractLabel}.inputSourceName is absent`)
    const input = compilerInputById.get(contract.buildInfoId)
    if (!input || input.sha256 !== contract.compilerInputSha256) fail(`${contractLabel} compiler input binding differs`)
    if (!Number.isSafeInteger(contract.abiEntryCount) || contract.abiEntryCount < 0) fail(`${contractLabel}.abiEntryCount differs`)
    assertSha256(contract.abiSha256, `${contractLabel}.abiSha256`)
    validateBytecodeEvidence(contract.creationBytecode, `${contractLabel}.creationBytecode`)
    validateBytecodeEvidence(contract.deployedBytecode, `${contractLabel}.deployedBytecode`)
    validateLinkReferences(contract.linkReferences, contract.creationBytecode.byteLength, `${contractLabel}.linkReferences`)
    validateLinkReferences(
      contract.deployedLinkReferences,
      contract.deployedBytecode.byteLength,
      `${contractLabel}.deployedLinkReferences`
    )
    validateImmutableReferences(
      contract.immutableReferences,
      contract.deployedBytecode.byteLength,
      `${contractLabel}.immutableReferences`
    )
    if (contract.userSourceName === null) {
      if (contract.userFqn !== null) fail(`${contractLabel}.userFqn must be null`)
    } else {
      const mapping = userMappingBySource.get(contract.userSourceName)
      if (!mapping || mapping.inputSourceName !== contract.inputSourceName) fail(`${contractLabel} user mapping differs`)
      if (contract.userFqn !== `${contract.userSourceName}:${contract.contractName}`) fail(`${contractLabel}.userFqn differs`)
      if (userContractsByFqn.has(contract.userFqn)) fail(`${contractLabel}.userFqn is duplicate`)
      userContractsByFqn.set(contract.userFqn, contract)
    }
    compilerContractsByFqn.set(contract.compilerFqn, contract)
  }
  if (manifest.userContractCount !== userContractsByFqn.size || manifest.userContractCount === 0) {
    fail(`${label}.userContractCount differs`)
  }

  if (!Array.isArray(manifest.artifactFiles) || manifest.artifactFiles.length !== manifest.userContractCount) {
    fail(`${label}.artifactFiles must biject with user contracts`)
  }
  assertSortedUnique(manifest.artifactFiles, 'path', `${label}.artifactFiles`)
  const artifactUserFqns = new Set()
  for (const [index, artifact] of manifest.artifactFiles.entries()) {
    const artifactLabel = `${label}.artifactFiles[${index}]`
    assertExactKeys(artifact, ['byteLength', 'compilerFqn', 'path', 'sha256', 'userFqn'], artifactLabel)
    assertNonnegativeInteger(artifact.byteLength, `${artifactLabel}.byteLength`)
    assertSha256(artifact.sha256, `${artifactLabel}.sha256`)
    normalizeRelativePath(artifact.path, `${artifactLabel}.path`)
    const contract = userContractsByFqn.get(artifact.userFqn)
    if (!contract || contract.compilerFqn !== artifact.compilerFqn || artifactUserFqns.has(artifact.userFqn)) {
      fail(`${artifactLabel} user/compiler FQN binding differs`)
    }
    if (artifact.path !== `${contract.userSourceName}/${contract.contractName}.json`) {
      fail(`${artifactLabel}.path differs from its user FQN`)
    }
    artifactUserFqns.add(artifact.userFqn)
  }

  if (!Array.isArray(manifest.buildInfoFiles) || manifest.buildInfoFiles.length !== manifest.compilerInputs.length * 2) {
    fail(`${label}.buildInfoFiles must contain exact input/output pairs`)
  }
  assertSortedUnique(manifest.buildInfoFiles, 'path', `${label}.buildInfoFiles`)
  const pairCounts = new Map()
  for (const [index, entry] of manifest.buildInfoFiles.entries()) {
    const entryLabel = `${label}.buildInfoFiles[${index}]`
    assertExactKeys(entry, ['byteLength', 'id', 'kind', 'path', 'sha256'], entryLabel)
    assertNonnegativeInteger(entry.byteLength, `${entryLabel}.byteLength`)
    assertSha256(entry.sha256, `${entryLabel}.sha256`)
    if (!compilerInputById.has(entry.id) || !['input', 'output'].includes(entry.kind)) fail(`${entryLabel} binding differs`)
    const expectedPath = entry.kind === 'input' ? `build-info/${entry.id}.json` : `build-info/${entry.id}.output.json`
    if (entry.path !== expectedPath) fail(`${entryLabel}.path differs`)
    const identity = `${entry.id}:${entry.kind}`
    pairCounts.set(identity, (pairCounts.get(identity) || 0) + 1)
  }
  for (const input of manifest.compilerInputs) {
    if (pairCounts.get(`${input.id}:input`) !== 1 || pairCounts.get(`${input.id}:output`) !== 1) {
      fail(`${label} build-info pair differs for ${input.id}`)
    }
  }

  assertExactKeys(
    manifest.hashes,
    [
      'artifactSetSha256', 'buildInfoSetSha256', 'compilerContractSetSha256', 'compilerInputSetSha256',
      'soliditySourceSetSha256', 'userSourceMapSha256',
    ],
    `${label}.hashes`
  )
  for (const [key, value] of Object.entries(manifest.hashes)) assertSha256(value, `${label}.hashes.${key}`)
  if (manifest.hashes.artifactSetSha256 !== sha256(canonicalJson(manifest.artifactFiles))) fail(`${label} artifact hash is stale`)
  if (manifest.hashes.buildInfoSetSha256 !== sha256(canonicalJson(manifest.buildInfoFiles))) fail(`${label} build-info hash is stale`)
  if (manifest.hashes.compilerContractSetSha256 !== sha256(canonicalJson(manifest.compilerContracts))) {
    fail(`${label} compiler-contract hash is stale`)
  }
  if (manifest.hashes.compilerInputSetSha256 !== sha256(canonicalJson(manifest.compilerInputs))) {
    fail(`${label} compiler-input hash is stale`)
  }
  if (manifest.hashes.soliditySourceSetSha256 !== sha256(canonicalJson(manifest.sources))) {
    fail(`${label} Solidity-source hash is stale`)
  }
  if (manifest.hashes.userSourceMapSha256 !== sha256(canonicalJson(manifest.userSourceMap))) {
    fail(`${label} user-source-map hash is stale`)
  }

  assertExactKeys(manifest.toolchain, ['git', 'hardhat', 'node', 'npm', 'solidity'], `${label}.toolchain`)
  assertExactKeys(manifest.toolchain.git, ['executableSha256', 'version'], `${label}.toolchain.git`)
  assertSha256(manifest.toolchain.git.executableSha256, `${label}.toolchain.git.executableSha256`)
  if (!/^git version \d+\.\d+\.\d+/.test(manifest.toolchain.git.version)) fail(`${label}.toolchain.git.version differs`)
  assertExactKeys(manifest.toolchain.node, ['executableSha256', 'version'], `${label}.toolchain.node`)
  if (manifest.toolchain.node.version !== REQUIRED_NODE) fail(`${label} Node version differs`)
  assertSha256(manifest.toolchain.node.executableSha256, `${label}.toolchain.node.executableSha256`)
  assertExactKeys(manifest.toolchain.npm, ['cliSha256', 'packageJsonSha256', 'version'], `${label}.toolchain.npm`)
  if (manifest.toolchain.npm.version !== REQUIRED_NPM) fail(`${label} npm version differs`)
  assertSha256(manifest.toolchain.npm.cliSha256, `${label}.toolchain.npm.cliSha256`)
  assertSha256(manifest.toolchain.npm.packageJsonSha256, `${label}.toolchain.npm.packageJsonSha256`)
  assertExactKeys(manifest.toolchain.hardhat, ['lockIntegrity', 'packageJsonSha256', 'version'], `${label}.toolchain.hardhat`)
  if (manifest.toolchain.hardhat.version !== REQUIRED_HARDHAT) fail(`${label} Hardhat version differs`)
  if (typeof manifest.toolchain.hardhat.lockIntegrity !== 'string' || manifest.toolchain.hardhat.lockIntegrity.length === 0) {
    fail(`${label} Hardhat integrity differs`)
  }
  assertSha256(manifest.toolchain.hardhat.packageJsonSha256, `${label}.toolchain.hardhat.packageJsonSha256`)
  assertExactKeys(
    manifest.toolchain.solidity,
    ['compilerType', 'evmVersion', 'longVersion', 'optimizer', 'version'],
    `${label}.toolchain.solidity`
  )
  const firstInput = manifest.compilerInputs[0]
  assertEqual(
    manifest.toolchain.solidity,
    {
      compilerType: firstInput.compilerType,
      evmVersion: firstInput.evmVersion,
      longVersion: firstInput.solcLongVersion,
      optimizer: firstInput.optimizer,
      version: firstInput.solcVersion,
    },
    `${label}.toolchain.solidity`
  )
}

function comparableCompilerInput(input) {
  return {
    compilerType: input.compilerType,
    evmVersion: input.evmVersion,
    optimizer: input.optimizer,
    sha256: input.sha256,
    solcLongVersion: input.solcLongVersion,
    solcVersion: input.solcVersion,
  }
}

function comparableUserMapping(mapping) {
  return {
    compilerInputSha256: mapping.compilerInputSha256,
    inputSourceName: mapping.inputSourceName,
    sourceName: mapping.sourceName,
  }
}

function comparableCompilerContract(contract) {
  return {
    abiEntryCount: contract.abiEntryCount,
    abiSha256: contract.abiSha256,
    compilerFqn: contract.compilerFqn,
    compilerInputSha256: contract.compilerInputSha256,
    contractName: contract.contractName,
    creationBytecode: contract.creationBytecode,
    deployedBytecode: contract.deployedBytecode,
    deployedLinkReferences: contract.deployedLinkReferences,
    immutableReferences: contract.immutableReferences,
    inputSourceName: contract.inputSourceName,
    linkReferences: contract.linkReferences,
    userFqn: contract.userFqn,
    userSourceName: contract.userSourceName,
  }
}

function bindingSummary(manifest, bytes) {
  return {
    artifactSetSha256: manifest.hashes.artifactSetSha256,
    buildInfoSetSha256: manifest.hashes.buildInfoSetSha256,
    commit: manifest.provenance.commit,
    compilerContractSetSha256: manifest.hashes.compilerContractSetSha256,
    compilerInputSetSha256: manifest.hashes.compilerInputSetSha256,
    hardhatConfigSha256: manifest.repositoryInputs.hardhatConfig.sha256,
    label: manifest.provenance.label,
    manifestSha256: sha256(bytes),
    packageJsonSha256: manifest.repositoryInputs.packageJson.sha256,
    packageLockSha256: manifest.repositoryInputs.packageLock.sha256,
    solidityFileSetSha256: manifest.repositoryInputs.solidityFileSetSha256,
    soliditySourceSetSha256: manifest.hashes.soliditySourceSetSha256,
    tree: manifest.provenance.tree,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const gitExecutable = resolveReal(args['--git-executable'], 'file', 'Git executable')
  const gitRepo = resolveReal(args['--git-repo'], 'directory', 'Git repository')
  const repoContractsRoot = resolveReal(args['--repo-contracts-root'], 'directory', 'repository contracts root')
  const captureScript = resolveReal(args['--capture-script'], 'file', 'reviewed capture script')
  const outPath = resolveOutput(args['--out'])
  const gitTopLevel = resolveReal(gitText(gitExecutable, gitRepo, ['rev-parse', '--show-toplevel']), 'directory', 'Git top level')
  if (comparablePath(gitTopLevel) !== comparablePath(gitRepo)) fail('Git repository is not its exact top level')
  assertContained(gitRepo, repoContractsRoot, 'repository contracts root')
  const contractsRepoPath = normalizeRelativePath(path.relative(gitRepo, repoContractsRoot), 'repository contracts path')
  if (contractsRepoPath !== 'contracts') fail('repository contracts root must resolve to contracts')

  verifyGitObject(gitExecutable, gitRepo, args['--baseline-commit'], args['--baseline-tree'], 'baseline')
  verifyGitObject(gitExecutable, gitRepo, args['--candidate-commit'], args['--candidate-tree'], 'candidate')
  verifyGitObject(gitExecutable, gitRepo, args['--tool-commit'], args['--tool-tree'], 'capture tool')

  const toolBlob = gitBlob(gitExecutable, gitRepo, args['--tool-commit'], args['--tool-path'], 'capture tool')
  const captureScriptBytes = readFileSync(captureScript)
  if (!captureScriptBytes.equals(toolBlob.bytes)) fail('reviewed capture script bytes differ from the bound Git blob')
  const expectedCaptureTool = {
    byteLength: toolBlob.byteLength,
    commit: args['--tool-commit'],
    gitBlobOid: toolBlob.gitBlobOid,
    path: toolBlob.path,
    schemaVersion: 2,
    sha256: toolBlob.sha256,
    tree: args['--tool-tree'],
  }

  const baseline = readManifest(args['--baseline'], 'baseline manifest')
  const candidate = readManifest(args['--candidate'], 'candidate manifest')
  if (baseline.value.provenance.label !== 'c2-baseline') fail('baseline label must be c2-baseline')
  if (candidate.value.provenance.label !== 'task2-explicit-shanghai') {
    fail('candidate label must be task2-explicit-shanghai')
  }
  if (
    baseline.value.provenance.commit !== args['--baseline-commit']
    || baseline.value.provenance.tree !== args['--baseline-tree']
  ) {
    fail('baseline manifest provenance differs from reviewed Git objects')
  }
  if (
    candidate.value.provenance.commit !== args['--candidate-commit']
    || candidate.value.provenance.tree !== args['--candidate-tree']
  ) {
    fail('candidate manifest provenance differs from reviewed Git objects')
  }
  if (baseline.value.provenance.commit === candidate.value.provenance.commit) fail('baseline and candidate commits must differ')
  assertEqual(baseline.value.captureTool, expectedCaptureTool, 'baseline capture tool Git binding')
  assertEqual(candidate.value.captureTool, expectedCaptureTool, 'candidate capture tool Git binding')

  const expectedGit = {
    executableSha256: sha256(readFileSync(gitExecutable)),
    version: gitText(gitExecutable, gitRepo, ['--version']),
  }
  assertEqual(baseline.value.toolchain.git, expectedGit, 'baseline Git executable identity')
  assertEqual(candidate.value.toolchain.git, expectedGit, 'candidate Git executable identity')
  if (process.versions.node !== REQUIRED_NODE) fail(`comparator Node must be exactly ${REQUIRED_NODE}`)
  const comparatorNode = { executableSha256: sha256(readFileSync(process.execPath)), version: process.versions.node }
  assertEqual(baseline.value.toolchain.node, comparatorNode, 'baseline Node executable identity')
  assertEqual(candidate.value.toolchain.node, comparatorNode, 'candidate Node executable identity')

  assertEqual(
    baseline.value.repositoryInputs,
    expectedRepositoryInputs(gitExecutable, gitRepo, args['--baseline-commit'], contractsRepoPath),
    'baseline repository Git-blob bindings'
  )
  assertEqual(
    candidate.value.repositoryInputs,
    expectedRepositoryInputs(gitExecutable, gitRepo, args['--candidate-commit'], contractsRepoPath),
    'candidate repository Git-blob bindings'
  )

  assertEqual(candidate.value.toolchain, baseline.value.toolchain, 'complete toolchain identity')
  assertEqual(candidate.value.sources, baseline.value.sources, 'complete compiler source set')
  assertEqual(
    candidate.value.compilerInputs.map(comparableCompilerInput).sort((a, b) => compareText(canonicalJson(a), canonicalJson(b))),
    baseline.value.compilerInputs.map(comparableCompilerInput).sort((a, b) => compareText(canonicalJson(a), canonicalJson(b))),
    'canonical compiler input content'
  )
  assertEqual(
    candidate.value.userSourceMap.map(comparableUserMapping),
    baseline.value.userSourceMap.map(comparableUserMapping),
    'tracked user source mapping'
  )
  if (
    candidate.value.repositoryInputs.hardhatConfig.sha256
    === baseline.value.repositoryInputs.hardhatConfig.sha256
  ) {
    fail('Hardhat config Git blob must differ for the explicit-target candidate')
  }
  assertEqual(candidate.value.repositoryInputs.packageJson, baseline.value.repositoryInputs.packageJson, 'package.json Git blob')
  assertEqual(candidate.value.repositoryInputs.packageLock, baseline.value.repositoryInputs.packageLock, 'package-lock Git blob')
  assertEqual(candidate.value.repositoryInputs.solidityFiles, baseline.value.repositoryInputs.solidityFiles, 'tracked Solidity Git blobs')

  const baselineContracts = new Map(baseline.value.compilerContracts.map((contract) => [contract.compilerFqn, contract]))
  const candidateContracts = new Map(candidate.value.compilerContracts.map((contract) => [contract.compilerFqn, contract]))
  assertEqual([...candidateContracts.keys()].sort(compareText), [...baselineContracts.keys()].sort(compareText), 'complete compiler-output FQN set')
  for (const compilerFqn of [...baselineContracts.keys()].sort(compareText)) {
    assertEqual(
      comparableCompilerContract(candidateContracts.get(compilerFqn)),
      comparableCompilerContract(baselineContracts.get(compilerFqn)),
      `${compilerFqn} exact compiler output`
    )
  }
  assertEqual(
    candidate.value.artifactFiles.map(({ compilerFqn, path: artifactPath, userFqn }) => ({ compilerFqn, path: artifactPath, userFqn })),
    baseline.value.artifactFiles.map(({ compilerFqn, path: artifactPath, userFqn }) => ({ compilerFqn, path: artifactPath, userFqn })),
    'complete user artifact FQN/path set'
  )

  const comparisonToolBytes = readFileSync(fileURLToPath(import.meta.url))
  const result = {
    baseline: bindingSummary(baseline.value, baseline.bytes),
    candidate: bindingSummary(candidate.value, candidate.bytes),
    comparedFields: [
      'git-verified-commit-and-tree',
      'git-blob-bound-config-lock-package-and-tracked-solidity',
      'git-blob-bound-reviewed-capture-tool',
      'distinct-root-repeat-build-exact-artifact-tree-agreement',
      'complete-compiler-output-fqn-set-including-imported-dependencies',
      'complete-user-artifact-fqn-path-bijection',
      'abi-sha256-and-entry-count',
      'complete-creation-bytecode-including-metadata',
      'complete-deployed-bytecode-including-metadata',
      'link-deployed-link-and-immutable-references',
      'complete-compiler-source-set',
      'canonical-compiler-input-content',
      'exact-git-node-npm-hardhat-solc-optimizer-evm-identities',
    ],
    comparisonTool: { schemaVersion: 2, sha256: sha256(comparisonToolBytes) },
    compilerContractCount: baseline.value.compilerContractCount,
    intentionallyDifferentBindings: [
      'commit', 'tree', 'hardhat-config-git-blob', 'hardhat-build-info-id',
      'artifact-file-sha256', 'build-info-file-sha256',
    ],
    metadataStrippedOrNormalized: false,
    reviewedCaptureTool: expectedCaptureTool,
    schema: COMPARISON_SCHEMA,
    userContractCount: baseline.value.userContractCount,
    verdict: 'exact-complete-compiler-output-equality',
  }
  writeFileSync(outPath, prettyCanonicalJson(result), { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(
    `Compared ${result.compilerContractCount} complete compiler outputs and ${result.userContractCount} user artifacts exactly.\n`
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`Bytecode manifest comparison failed: ${error.message}\n`)
  process.exitCode = 1
}
