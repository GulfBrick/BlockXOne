import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCHEMA = 'blockxone-bytecode-manifest-v2'
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

function assertContained(root, candidate, label, allowRoot = false) {
  const relative = path.relative(root, candidate)
  if ((!allowRoot && relative === '') || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} is not really contained by its required root`)
  }
}

function resolveRealInside(root, relativeName, expectedType, label) {
  const relative = normalizeRelativePath(relativeName, label)
  const resolved = resolveReal(path.join(root, ...relative.split('/')), expectedType, label)
  assertContained(root, resolved, label)
  return resolved
}

function assertSamePath(actual, expected, label) {
  if (comparablePath(actual) !== comparablePath(expected)) fail(`${label} is not the required exact path`)
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
}

function parseJsonFile(filePath, label) {
  const bytes = readFileSync(filePath)
  return { bytes, value: parseJsonBytes(bytes, label) }
}

function listFiles(root, label) {
  const files = []
  function visit(directory) {
    const realDirectory = resolveReal(directory, 'directory', `${label} directory`)
    assertContained(root, realDirectory, `${label} directory`, true)
    for (const entry of readdirSync(realDirectory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const fullPath = path.join(realDirectory, entry.name)
      const status = lstatSync(fullPath)
      if (status.isSymbolicLink() || entry.isSymbolicLink()) fail(`${label} contains a symbolic link or junction`)
      const real = realpathSync.native(fullPath)
      if (comparablePath(real) !== comparablePath(fullPath)) fail(`${label} contains a reparse-point path`)
      assertContained(root, real, `${label} entry`)
      if (status.isDirectory()) visit(real)
      else if (status.isFile()) files.push(real)
      else fail(`${label} contains an unsupported filesystem entry`)
    }
  }
  visit(root)
  return files
}

function artifactTreeEvidence(root, label) {
  return listFiles(root, label)
    .map((file) => {
      const relative = normalizeRelativePath(path.relative(root, file), `${label} relative path`)
      const bytes = readFileSync(file)
      return { byteLength: bytes.length, path: relative, sha256: sha256(bytes) }
    })
    .sort((left, right) => compareText(left.path, right.path))
}

function resolveOutput(value) {
  const output = path.resolve(value)
  if (existsSync(output)) fail('output file must not already exist')
  const parent = resolveReal(path.dirname(output), 'directory', 'output parent')
  if (comparablePath(parent) !== comparablePath(path.dirname(output))) {
    fail('output parent contains path ambiguity')
  }
  return output
}

function parseArgs(argv) {
  const allowed = new Set([
    '--artifacts',
    '--reference-artifacts',
    '--source-root',
    '--config',
    '--package-lock',
    '--package-json',
    '--npm-cli',
    '--git-executable',
    '--git-repo',
    '--repo-contracts-root',
    '--commit',
    '--tree',
    '--tool-commit',
    '--tool-tree',
    '--tool-path',
    '--label',
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
  for (const key of ['--commit', '--tree', '--tool-commit', '--tool-tree']) {
    if (!/^[0-9a-f]{40}$/.test(values[key]) || /^0+$/.test(values[key])) {
      fail(`${key} must be a nonzero full lowercase Git object ID`)
    }
  }
  if (values['--tool-path'] !== CAPTURE_TOOL_PATH) fail(`--tool-path must be exactly ${CAPTURE_TOOL_PATH}`)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(values['--label'])) fail('--label is invalid')
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
  const resolvedCommit = gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}^{commit}`])
  if (resolvedCommit !== commit) fail(`${label} commit does not resolve exactly`)
  const resolvedTree = gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}^{tree}`])
  if (resolvedTree !== tree) fail(`${label} commit tree differs from the supplied tree`)
}

function gitBlob(gitExecutable, repo, commit, repoPath, label) {
  const normalizedPath = normalizeRelativePath(repoPath, `${label} path`)
  const oid = gitText(gitExecutable, repo, ['rev-parse', '--verify', `${commit}:${normalizedPath}`])
  if (!/^[0-9a-f]{40}$/.test(oid)) fail(`${label} does not resolve to a Git blob`)
  const type = gitText(gitExecutable, repo, ['cat-file', '-t', oid])
  if (type !== 'blob') fail(`${label} Git object is not a blob`)
  const bytes = runGit(gitExecutable, repo, ['cat-file', 'blob', oid], null)
  return {
    byteLength: bytes.length,
    bytes,
    gitBlobOid: oid,
    path: normalizedPath,
    sha256: sha256(bytes),
  }
}

function bindFileToBlob(gitExecutable, repo, commit, repoPath, filePath, label) {
  const evidence = gitBlob(gitExecutable, repo, commit, repoPath, label)
  const actual = readFileSync(filePath)
  if (!actual.equals(evidence.bytes)) fail(`${label} bytes differ from the bound Git blob`)
  const { bytes: _bytes, ...serializable } = evidence
  return serializable
}

function trackedSolidity(gitExecutable, repo, commit, contractsRepoPath) {
  const prefix = `${contractsRepoPath}/src`
  const raw = runGit(
    gitExecutable,
    repo,
    ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix],
    null
  )
  const entries = []
  for (const record of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^([0-7]{6}) (blob) ([0-9a-f]{40})\t(.+)$/.exec(record)
    if (!match) fail('Git Solidity tree contains a malformed or non-blob entry')
    const [, mode, , gitBlobOid, repoPathValue] = match
    const repoPath = normalizeRelativePath(repoPathValue, 'tracked repository path')
    if (!repoPath.startsWith(`${prefix}/`)) fail('Git returned a path outside contracts/src')
    if (!repoPath.endsWith('.sol')) continue
    if (mode !== '100644') fail(`tracked Solidity source has unexpected mode: ${repoPath}`)
    entries.push({
      contractsPath: repoPath.slice(contractsRepoPath.length + 1),
      gitBlobOid,
      path: repoPath,
    })
  }
  entries.sort((a, b) => compareText(a.contractsPath, b.contractsPath))
  if (entries.length === 0) fail('Git commit contains zero tracked contracts/src Solidity files')
  const paths = entries.map((entry) => entry.contractsPath)
  if (new Set(paths).size !== paths.length) fail('Git Solidity file set contains duplicates')
  return entries
}

function validateBytecode(bytecode, label) {
  if (typeof bytecode !== 'string' || !bytecode.startsWith('0x')) fail(`${label} must start with 0x`)
  const body = bytecode.slice(2)
  if (body.length % 2 !== 0) fail(`${label} must have an even encoded length`)
  for (let index = 0; index < body.length;) {
    if (body.startsWith('__$', index)) {
      const placeholder = body.slice(index, index + 40)
      if (!/^__\$[0-9a-fA-F]{34}\$__$/.test(placeholder)) fail(`${label} has a malformed link placeholder`)
      index += 40
    } else {
      if (!/^[0-9a-fA-F]{2}$/.test(body.slice(index, index + 2))) fail(`${label} contains non-byte data`)
      index += 2
    }
  }
  return body.length / 2
}

function deployedMetadataEvidence(bytecode, label) {
  if (bytecode === '0x') return { byteLength: 0, sha256: sha256('0x') }
  const body = bytecode.slice(2)
  if (body.length < 4 || !/^[0-9a-fA-F]{4}$/.test(body.slice(-4))) {
    fail(`${label} has no valid Solidity metadata length suffix`)
  }
  const cborByteLength = Number.parseInt(body.slice(-4), 16)
  const suffixCharacters = (cborByteLength + 2) * 2
  if (cborByteLength === 0 || suffixCharacters > body.length) fail(`${label} has invalid Solidity metadata`)
  const suffix = body.slice(-suffixCharacters)
  if (!/^[0-9a-fA-F]+$/.test(suffix)) fail(`${label} metadata is malformed`)
  return { byteLength: cborByteLength + 2, sha256: sha256(`0x${suffix}`) }
}

function creationMetadataEvidence(creationBytecode, deployedBytecode, deployedMetadata, label) {
  if (creationBytecode === '0x') return { byteLength: 0, sha256: sha256('0x') }
  if (deployedBytecode === '0x' || deployedMetadata.byteLength === 0) {
    fail(`${label} has creation code without deployed metadata`)
  }
  const metadataBody = deployedBytecode.slice(2).slice(-(deployedMetadata.byteLength * 2))
  if (!creationBytecode.slice(2).includes(metadataBody)) fail(`${label} does not contain exact deployed metadata bytes`)
  return { ...deployedMetadata }
}

function validateRanges(ranges, byteLength, label) {
  if (!Array.isArray(ranges) || ranges.length === 0) fail(`${label} must be a nonempty array`)
  const seen = new Set()
  for (const [index, range] of ranges.entries()) {
    assertExactKeys(range, ['length', 'start'], `${label}[${index}]`)
    if (!Number.isSafeInteger(range.start) || range.start < 0) fail(`${label}[${index}].start is invalid`)
    if (!Number.isSafeInteger(range.length) || range.length <= 0) fail(`${label}[${index}].length is invalid`)
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

function contractEvidence({ buildInfoId, compilerInputSha256, contractName, contractOutput, inputSourceName, userSourceName }) {
  const compilerFqn = `${inputSourceName}:${contractName}`
  if (!Array.isArray(contractOutput?.abi)) fail(`${compilerFqn} ABI must be an array`)
  assertObject(contractOutput.evm, `${compilerFqn} EVM output`)
  assertObject(contractOutput.evm.bytecode, `${compilerFqn} creation output`)
  assertObject(contractOutput.evm.deployedBytecode, `${compilerFqn} deployed output`)
  const creation = `0x${contractOutput.evm.bytecode.object}`
  const deployed = `0x${contractOutput.evm.deployedBytecode.object}`
  const creationByteLength = validateBytecode(creation, `${compilerFqn} creation bytecode`)
  const deployedByteLength = validateBytecode(deployed, `${compilerFqn} deployed bytecode`)
  const linkReferences = contractOutput.evm.bytecode.linkReferences
  const deployedLinkReferences = contractOutput.evm.deployedBytecode.linkReferences
  const immutableReferences = contractOutput.evm.deployedBytecode.immutableReferences
  validateLinkReferences(linkReferences, creationByteLength, `${compilerFqn} linkReferences`)
  validateLinkReferences(deployedLinkReferences, deployedByteLength, `${compilerFqn} deployedLinkReferences`)
  validateImmutableReferences(immutableReferences, deployedByteLength, `${compilerFqn} immutableReferences`)
  const deployedMetadata = deployedMetadataEvidence(deployed, `${compilerFqn} deployed bytecode`)
  const creationMetadata = creationMetadataEvidence(creation, deployed, deployedMetadata, `${compilerFqn} creation bytecode`)
  return {
    abiEntryCount: contractOutput.abi.length,
    abiSha256: sha256(canonicalJson(contractOutput.abi)),
    buildInfoId,
    compilerFqn,
    compilerInputSha256,
    contractName,
    creationBytecode: { byteLength: creationByteLength, metadata: creationMetadata, sha256: sha256(creation) },
    deployedBytecode: { byteLength: deployedByteLength, metadata: deployedMetadata, sha256: sha256(deployed) },
    deployedLinkReferences,
    immutableReferences,
    inputSourceName,
    linkReferences,
    userFqn: userSourceName === null ? null : `${userSourceName}:${contractName}`,
    userSourceName,
  }
}

function validateCompilerInput(header, label) {
  assertExactKeys(header.input, ['language', 'settings', 'sources'], `${label}.input`)
  if (header.input.language !== 'Solidity') fail(`${label} language must be Solidity`)
  assertObject(header.input.settings, `${label}.input.settings`)
  assertExactKeys(header.input.settings.optimizer, ['enabled', 'runs'], `${label}.input.settings.optimizer`)
  if (header.input.settings.optimizer.enabled !== true || header.input.settings.optimizer.runs !== REQUIRED_OPTIMIZER_RUNS) {
    fail(`${label} optimizer policy differs`)
  }
  if (header.input.settings.evmVersion !== REQUIRED_EVM) fail(`${label} EVM target must resolve to ${REQUIRED_EVM}`)
  assertObject(header.input.sources, `${label}.input.sources`)
  if (Object.keys(header.input.sources).length === 0) fail(`${label} has zero compiler sources`)
  for (const [sourceName, source] of Object.entries(header.input.sources)) {
    normalizeRelativePath(sourceName, `${label} compiler source`)
    assertExactKeys(source, ['content'], `${label}.input.sources.${sourceName}`)
    if (typeof source.content !== 'string') fail(`${label} compiler source content must be text`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const artifactRoot = resolveReal(args['--artifacts'], 'directory', 'artifact root')
  const referenceArtifactRoot = resolveReal(args['--reference-artifacts'], 'directory', 'reference artifact root')
  const sourceRoot = resolveReal(args['--source-root'], 'directory', 'source root')
  const configPath = resolveReal(args['--config'], 'file', 'Hardhat config')
  const packageLockPath = resolveReal(args['--package-lock'], 'file', 'package lock')
  const packageJsonPath = resolveReal(args['--package-json'], 'file', 'package JSON')
  const npmCliPath = resolveReal(args['--npm-cli'], 'file', 'npm CLI')
  const gitExecutable = resolveReal(args['--git-executable'], 'file', 'Git executable')
  const gitRepo = resolveReal(args['--git-repo'], 'directory', 'Git repository')
  const repoContractsRoot = resolveReal(args['--repo-contracts-root'], 'directory', 'repository contracts root')
  const outPath = resolveOutput(args['--out'])

  if (comparablePath(artifactRoot) === comparablePath(referenceArtifactRoot)) {
    fail('artifact root and reference artifact root must be distinct real directories')
  }
  const artifactRelativeToReference = path.relative(referenceArtifactRoot, artifactRoot)
  const referenceRelativeToArtifact = path.relative(artifactRoot, referenceArtifactRoot)
  if (
    (!artifactRelativeToReference.startsWith('..') && !path.isAbsolute(artifactRelativeToReference))
    || (!referenceRelativeToArtifact.startsWith('..') && !path.isAbsolute(referenceRelativeToArtifact))
  ) {
    fail('artifact roots must not contain one another')
  }

  const artifactTree = artifactTreeEvidence(artifactRoot, 'artifact root')
  const referenceArtifactTree = artifactTreeEvidence(referenceArtifactRoot, 'reference artifact root')
  if (canonicalJson(artifactTree) !== canonicalJson(referenceArtifactTree)) {
    fail('artifact tree differs from the distinct-root repeat build')
  }
  const repeatBuild = {
    fileCount: artifactTree.length,
    method: 'distinct-root-exact-relative-path-byte-agreement',
    treeSha256: sha256(canonicalJson(artifactTree)),
  }

  assertSamePath(configPath, resolveRealInside(sourceRoot, 'hardhat.config.ts', 'file', 'source Hardhat config'), 'Hardhat config')
  assertSamePath(packageLockPath, resolveRealInside(sourceRoot, 'package-lock.json', 'file', 'source package lock'), 'package lock')
  assertSamePath(packageJsonPath, resolveRealInside(sourceRoot, 'package.json', 'file', 'source package JSON'), 'package JSON')

  const gitTopLevel = resolveReal(gitText(gitExecutable, gitRepo, ['rev-parse', '--show-toplevel']), 'directory', 'Git top level')
  assertSamePath(gitRepo, gitTopLevel, 'Git repository')
  assertContained(gitRepo, repoContractsRoot, 'repository contracts root')
  const contractsRepoPath = normalizeRelativePath(path.relative(gitRepo, repoContractsRoot), 'repository contracts path')
  if (contractsRepoPath !== 'contracts') fail('repository contracts root must resolve to tracked path contracts')

  verifyGitObject(gitExecutable, gitRepo, args['--commit'], args['--tree'], 'source')
  verifyGitObject(gitExecutable, gitRepo, args['--tool-commit'], args['--tool-tree'], 'capture tool')

  const captureScriptPath = resolveReal(fileURLToPath(import.meta.url), 'file', 'running capture script')
  const toolBinding = bindFileToBlob(
    gitExecutable,
    gitRepo,
    args['--tool-commit'],
    args['--tool-path'],
    captureScriptPath,
    'capture tool'
  )

  const gitVersion = gitText(gitExecutable, gitRepo, ['--version'])
  if (!/^git version \d+\.\d+\.\d+/.test(gitVersion)) fail('Git version output is malformed')
  if (process.versions.node !== REQUIRED_NODE) fail(`Node must be exactly ${REQUIRED_NODE}`)

  const npmPackagePath = resolveReal(path.resolve(path.dirname(npmCliPath), '..', 'package.json'), 'file', 'npm package JSON')
  const npmPackage = parseJsonFile(npmPackagePath, 'npm package JSON')
  if (npmPackage.value.version !== REQUIRED_NPM) fail(`npm must be exactly ${REQUIRED_NPM}`)

  const hardhatPackagePath = resolveRealInside(sourceRoot, 'node_modules/hardhat/package.json', 'file', 'Hardhat package JSON')
  const hardhatPackage = parseJsonFile(hardhatPackagePath, 'Hardhat package JSON')
  if (hardhatPackage.value.version !== REQUIRED_HARDHAT) fail(`Hardhat must be exactly ${REQUIRED_HARDHAT}`)

  const sourceConfigBinding = bindFileToBlob(
    gitExecutable,
    gitRepo,
    args['--commit'],
    `${contractsRepoPath}/hardhat.config.ts`,
    configPath,
    'Hardhat config'
  )
  const sourceLockBinding = bindFileToBlob(
    gitExecutable,
    gitRepo,
    args['--commit'],
    `${contractsRepoPath}/package-lock.json`,
    packageLockPath,
    'package lock'
  )
  const sourcePackageBinding = bindFileToBlob(
    gitExecutable,
    gitRepo,
    args['--commit'],
    `${contractsRepoPath}/package.json`,
    packageJsonPath,
    'package JSON'
  )

  const packageLock = parseJsonFile(packageLockPath, 'package-lock.json')
  const packageJson = parseJsonFile(packageJsonPath, 'package.json')
  if (packageJson.value.devDependencies?.hardhat !== REQUIRED_HARDHAT) fail('package.json Hardhat pin differs')
  const lockedHardhat = packageLock.value.packages?.['node_modules/hardhat']
  if (
    packageLock.value.packages?.['']?.devDependencies?.hardhat !== REQUIRED_HARDHAT
    || lockedHardhat?.version !== REQUIRED_HARDHAT
    || typeof lockedHardhat.integrity !== 'string'
  ) {
    fail('package-lock.json Hardhat identity differs')
  }

  const trackedFiles = trackedSolidity(gitExecutable, gitRepo, args['--commit'], contractsRepoPath)
  const actualSolidityPaths = listFiles(resolveRealInside(sourceRoot, 'src', 'directory', 'source Solidity root'), 'source Solidity root')
    .filter((file) => file.endsWith('.sol'))
    .map((file) => normalizeRelativePath(path.relative(sourceRoot, file), 'actual Solidity path'))
    .sort(compareText)
  const trackedContractsPaths = trackedFiles.map((entry) => entry.contractsPath)
  if (canonicalJson(actualSolidityPaths) !== canonicalJson(trackedContractsPaths)) {
    fail('source-root Solidity file set does not biject with tracked commit Solidity files')
  }

  const solidityFiles = []
  const trackedBlobBytes = new Map()
  for (const tracked of trackedFiles) {
    const sourcePath = resolveRealInside(sourceRoot, tracked.contractsPath, 'file', `tracked Solidity ${tracked.contractsPath}`)
    const binding = bindFileToBlob(
      gitExecutable,
      gitRepo,
      args['--commit'],
      tracked.path,
      sourcePath,
      `tracked Solidity ${tracked.contractsPath}`
    )
    if (binding.gitBlobOid !== tracked.gitBlobOid) fail(`tracked Solidity tree/blob mismatch: ${tracked.contractsPath}`)
    solidityFiles.push(binding)
    trackedBlobBytes.set(tracked.contractsPath, readFileSync(sourcePath))
  }
  solidityFiles.sort((a, b) => compareText(a.path, b.path))

  const buildInfoRoot = resolveRealInside(artifactRoot, 'build-info', 'directory', 'Hardhat build-info root')
  const allBuildInfoFiles = listFiles(buildInfoRoot, 'Hardhat build-info root')
  const headerFiles = allBuildInfoFiles.filter((file) => file.endsWith('.json') && !file.endsWith('.output.json'))
  const outputFiles = allBuildInfoFiles.filter((file) => file.endsWith('.output.json'))
  if (headerFiles.length === 0) fail('Hardhat build-info contains zero compiler inputs')
  if (headerFiles.length !== outputFiles.length || headerFiles.length * 2 !== allBuildInfoFiles.length) {
    fail('Hardhat build-info must contain exact input/output pairs only')
  }

  const compilerInputs = []
  const buildInfoEvidence = []
  const sourceContents = new Map()
  const userSourceMap = []
  const mappedUserSources = new Set()
  const compilerContracts = []
  const compilerContractByFqn = new Map()
  const userContractOutputs = new Map()
  const buildInfoIds = new Set()

  for (const headerPath of headerFiles.sort(compareText)) {
    const relativeHeaderPath = normalizeRelativePath(path.relative(artifactRoot, headerPath), 'build-info header path')
    const headerFile = parseJsonFile(headerPath, relativeHeaderPath)
    const header = headerFile.value
    assertExactKeys(
      header,
      ['_format', 'compilerType', 'id', 'input', 'solcLongVersion', 'solcVersion', 'userSourceNameMap'],
      relativeHeaderPath
    )
    if (header._format !== 'hh3-sol-build-info-1' || header.compilerType !== 'solc') fail(`${relativeHeaderPath} format differs`)
    if (header.solcVersion !== REQUIRED_SOLC || !header.solcLongVersion.startsWith(`${REQUIRED_SOLC}+`)) {
      fail(`${relativeHeaderPath} compiler identity differs`)
    }
    if (typeof header.id !== 'string' || header.id.length === 0 || buildInfoIds.has(header.id)) {
      fail(`${relativeHeaderPath} build-info id is missing or duplicate`)
    }
    buildInfoIds.add(header.id)
    if (path.basename(headerPath) !== `${header.id}.json`) fail(`${relativeHeaderPath} filename/id mismatch`)
    validateCompilerInput(header, relativeHeaderPath)
    assertObject(header.userSourceNameMap, `${relativeHeaderPath}.userSourceNameMap`)

    const outputPath = resolveRealInside(buildInfoRoot, `${header.id}.output.json`, 'file', 'build-info output')
    const relativeOutputPath = normalizeRelativePath(path.relative(artifactRoot, outputPath), 'build-info output path')
    const outputFile = parseJsonFile(outputPath, relativeOutputPath)
    const output = outputFile.value
    assertExactKeys(output, ['_format', 'id', 'output'], relativeOutputPath)
    if (output._format !== 'hh3-sol-build-info-output-1' || output.id !== header.id) {
      fail(`${relativeOutputPath} does not match its input`)
    }
    assertObject(output.output, `${relativeOutputPath}.output`)
    assertObject(output.output.contracts, `${relativeOutputPath}.output.contracts`)

    const compilerInputSha256 = sha256(canonicalJson(header.input))
    compilerInputs.push({
      compilerType: header.compilerType,
      evmVersion: header.input.settings.evmVersion,
      id: header.id,
      optimizer: header.input.settings.optimizer,
      sha256: compilerInputSha256,
      solcLongVersion: header.solcLongVersion,
      solcVersion: header.solcVersion,
    })
    buildInfoEvidence.push({
      byteLength: headerFile.bytes.length,
      id: header.id,
      kind: 'input',
      path: relativeHeaderPath,
      sha256: sha256(headerFile.bytes),
    })
    buildInfoEvidence.push({
      byteLength: outputFile.bytes.length,
      id: header.id,
      kind: 'output',
      path: relativeOutputPath,
      sha256: sha256(outputFile.bytes),
    })

    for (const [inputSourceName, source] of Object.entries(header.input.sources)) {
      const prior = sourceContents.get(inputSourceName)
      if (prior !== undefined && prior !== source.content) fail(`compiler source differs across inputs: ${inputSourceName}`)
      sourceContents.set(inputSourceName, source.content)
    }

    const inputToUser = new Map()
    for (const [userSourceNameValue, inputSourceNameValue] of Object.entries(header.userSourceNameMap)) {
      const userSourceName = normalizeRelativePath(userSourceNameValue, 'user source name')
      const inputSourceName = normalizeRelativePath(inputSourceNameValue, 'mapped compiler source name')
      if (!userSourceName.startsWith('src/') || !userSourceName.endsWith('.sol')) fail(`mapped user source is outside src: ${userSourceName}`)
      if (mappedUserSources.has(userSourceName)) fail(`user source is mapped more than once: ${userSourceName}`)
      if (inputToUser.has(inputSourceName)) fail(`compiler input source maps to multiple user sources: ${inputSourceName}`)
      const compilerSource = header.input.sources[inputSourceName]
      if (!compilerSource) fail(`mapped compiler input is missing: ${inputSourceName}`)
      const trackedBytes = trackedBlobBytes.get(userSourceName)
      if (!trackedBytes) fail(`mapped user source is not tracked at the bound commit: ${userSourceName}`)
      if (!Buffer.from(compilerSource.content, 'utf8').equals(trackedBytes)) {
        fail(`compiler input bytes differ from tracked Git blob: ${userSourceName}`)
      }
      mappedUserSources.add(userSourceName)
      inputToUser.set(inputSourceName, userSourceName)
      userSourceMap.push({ buildInfoId: header.id, compilerInputSha256, inputSourceName, sourceName: userSourceName })
    }

    for (const [inputSourceNameValue, sourceContracts] of Object.entries(output.output.contracts)) {
      const inputSourceName = normalizeRelativePath(inputSourceNameValue, 'compiler output source name')
      if (!header.input.sources[inputSourceName]) fail(`compiler output source is absent from compiler input: ${inputSourceName}`)
      assertObject(sourceContracts, `${relativeOutputPath}.contracts.${inputSourceName}`)
      const userSourceName = inputToUser.get(inputSourceName) || null
      for (const [contractName, contractOutput] of Object.entries(sourceContracts)) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contractName)) fail(`compiler output contract name is invalid: ${contractName}`)
        const evidence = contractEvidence({
          buildInfoId: header.id,
          compilerInputSha256,
          contractName,
          contractOutput,
          inputSourceName,
          userSourceName,
        })
        if (compilerContractByFqn.has(evidence.compilerFqn)) fail(`duplicate compiler-output FQN: ${evidence.compilerFqn}`)
        compilerContractByFqn.set(evidence.compilerFqn, evidence)
        compilerContracts.push(evidence)
        if (evidence.userFqn !== null) {
          if (userContractOutputs.has(evidence.userFqn)) fail(`duplicate user-contract FQN: ${evidence.userFqn}`)
          userContractOutputs.set(evidence.userFqn, { contractOutput, evidence })
        }
      }
    }
  }

  userSourceMap.sort((a, b) => compareText(a.sourceName, b.sourceName))
  const mappedPaths = userSourceMap.map((entry) => entry.sourceName)
  if (canonicalJson(mappedPaths) !== canonicalJson(trackedContractsPaths)) {
    fail('Hardhat userSourceNameMap does not biject with every tracked contracts/src Solidity file')
  }
  if (compilerContracts.length === 0) fail('compiler output contains zero contracts')

  const artifactJsonFiles = listFiles(artifactRoot, 'artifact root').filter((file) => {
    const relative = normalizeRelativePath(path.relative(artifactRoot, file), 'artifact candidate path')
    return relative.endsWith('.json') && !relative.startsWith('build-info/') && !relative.endsWith('.dbg.json')
  })
  if (artifactJsonFiles.length === 0) fail('artifact tree contains zero user artifacts')
  const artifactFiles = []
  const observedUserFqns = new Set()

  for (const artifactPath of artifactJsonFiles.sort(compareText)) {
    const relativePath = normalizeRelativePath(path.relative(artifactRoot, artifactPath), 'artifact path')
    const artifactFile = parseJsonFile(artifactPath, relativePath)
    const artifact = artifactFile.value
    assertExactKeys(
      artifact,
      [
        '_format', 'abi', 'buildInfoId', 'bytecode', 'contractName', 'deployedBytecode',
        'deployedLinkReferences', 'immutableReferences', 'inputSourceName', 'linkReferences', 'sourceName',
      ],
      relativePath
    )
    if (artifact._format !== 'hh3-artifact-1') fail(`${relativePath} format differs`)
    const sourceName = normalizeRelativePath(artifact.sourceName, `${relativePath}.sourceName`)
    const inputSourceName = normalizeRelativePath(artifact.inputSourceName, `${relativePath}.inputSourceName`)
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(artifact.contractName)) fail(`${relativePath} contract name is invalid`)
    const userFqn = `${sourceName}:${artifact.contractName}`
    if (relativePath !== `${sourceName}/${artifact.contractName}.json`) fail(`${relativePath} path/FQN mismatch`)
    if (observedUserFqns.has(userFqn)) fail(`duplicate artifact FQN: ${userFqn}`)
    observedUserFqns.add(userFqn)
    const expected = userContractOutputs.get(userFqn)
    if (!expected) fail(`artifact has no complete mapped compiler output: ${userFqn}`)
    const output = expected.contractOutput
    const compilerEvidence = expected.evidence
    if (
      artifact.buildInfoId !== compilerEvidence.buildInfoId
      || inputSourceName !== compilerEvidence.inputSourceName
      || sourceName !== compilerEvidence.userSourceName
    ) {
      fail(`artifact provenance differs from compiler output: ${userFqn}`)
    }
    if (canonicalJson(artifact.abi) !== canonicalJson(output.abi)) fail(`${userFqn} artifact ABI differs`)
    if (artifact.bytecode !== `0x${output.evm.bytecode.object}`) fail(`${userFqn} creation bytecode differs`)
    if (artifact.deployedBytecode !== `0x${output.evm.deployedBytecode.object}`) fail(`${userFqn} deployed bytecode differs`)
    if (canonicalJson(artifact.linkReferences) !== canonicalJson(output.evm.bytecode.linkReferences)) {
      fail(`${userFqn} link references differ`)
    }
    if (canonicalJson(artifact.deployedLinkReferences) !== canonicalJson(output.evm.deployedBytecode.linkReferences)) {
      fail(`${userFqn} deployed link references differ`)
    }
    if (canonicalJson(artifact.immutableReferences) !== canonicalJson(output.evm.deployedBytecode.immutableReferences)) {
      fail(`${userFqn} immutable references differ`)
    }
    artifactFiles.push({
      byteLength: artifactFile.bytes.length,
      compilerFqn: compilerEvidence.compilerFqn,
      path: relativePath,
      sha256: sha256(artifactFile.bytes),
      userFqn,
    })
  }

  const missingArtifacts = [...userContractOutputs.keys()].filter((fqn) => !observedUserFqns.has(fqn)).sort(compareText)
  if (missingArtifacts.length > 0) fail(`mapped compiler outputs missing artifacts: ${missingArtifacts.join(', ')}`)

  compilerInputs.sort((a, b) => compareText(a.id, b.id))
  buildInfoEvidence.sort((a, b) => compareText(a.path, b.path))
  compilerContracts.sort((a, b) => compareText(a.compilerFqn, b.compilerFqn))
  artifactFiles.sort((a, b) => compareText(a.path, b.path))
  const sources = [...sourceContents.entries()]
    .map(([sourceName, content]) => ({ byteLength: Buffer.byteLength(content), sha256: sha256(content), sourceName }))
    .sort((a, b) => compareText(a.sourceName, b.sourceName))

  const manifest = {
    artifactFiles,
    buildInfoFiles: buildInfoEvidence,
    captureTool: {
      byteLength: toolBinding.byteLength,
      commit: args['--tool-commit'],
      gitBlobOid: toolBinding.gitBlobOid,
      path: toolBinding.path,
      schemaVersion: 2,
      sha256: toolBinding.sha256,
      tree: args['--tool-tree'],
    },
    compilerContractCount: compilerContracts.length,
    compilerContracts,
    compilerInputs,
    hashes: {
      artifactSetSha256: sha256(canonicalJson(artifactFiles)),
      buildInfoSetSha256: sha256(canonicalJson(buildInfoEvidence)),
      compilerContractSetSha256: sha256(canonicalJson(compilerContracts)),
      compilerInputSetSha256: sha256(canonicalJson(compilerInputs)),
      soliditySourceSetSha256: sha256(canonicalJson(sources)),
      userSourceMapSha256: sha256(canonicalJson(userSourceMap)),
    },
    provenance: {
      commit: args['--commit'],
      label: args['--label'],
      method: 'git-object-bound-archive',
      repositoryContractsRoot: contractsRepoPath,
      tree: args['--tree'],
    },
    repositoryInputs: {
      hardhatConfig: sourceConfigBinding,
      packageJson: sourcePackageBinding,
      packageLock: sourceLockBinding,
      solidityFiles,
      solidityFileSetSha256: sha256(canonicalJson(solidityFiles)),
    },
    repeatBuild,
    schema: SCHEMA,
    sources,
    toolchain: {
      git: { executableSha256: sha256(readFileSync(gitExecutable)), version: gitVersion },
      hardhat: {
        lockIntegrity: lockedHardhat.integrity,
        packageJsonSha256: sha256(hardhatPackage.bytes),
        version: hardhatPackage.value.version,
      },
      node: { executableSha256: sha256(readFileSync(process.execPath)), version: process.versions.node },
      npm: {
        cliSha256: sha256(readFileSync(npmCliPath)),
        packageJsonSha256: sha256(npmPackage.bytes),
        version: npmPackage.value.version,
      },
      solidity: {
        compilerType: compilerInputs[0].compilerType,
        evmVersion: compilerInputs[0].evmVersion,
        longVersion: compilerInputs[0].solcLongVersion,
        optimizer: compilerInputs[0].optimizer,
        version: compilerInputs[0].solcVersion,
      },
    },
    userContractCount: userContractOutputs.size,
    userSourceMap,
  }

  if (manifest.compilerContractCount === 0 || manifest.userContractCount === 0) fail('refusing zero-contract manifest')
  writeFileSync(outPath, prettyCanonicalJson(manifest), { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(
    `Captured ${manifest.compilerContractCount} compiler-output contracts and ${manifest.userContractCount} user artifacts for ${manifest.provenance.label}.\n`
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`Bytecode manifest capture failed: ${error.message}\n`)
  process.exitCode = 1
}
