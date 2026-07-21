import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const MANIFEST_SCHEMA = 'blockxone-bytecode-manifest-v1'
const COMPARISON_SCHEMA = 'blockxone-bytecode-comparison-v1'
const REQUIRED_NODE = '22.23.1'
const REQUIRED_NPM = '10.9.8'
const REQUIRED_HARDHAT = '3.10.0'
const REQUIRED_SOLC = '0.8.20'
const REQUIRED_EVM = 'shanghai'
const REQUIRED_OPTIMIZER_RUNS = 200

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
  const values = items.map((item) => item[key])
  const sorted = [...values].sort(compareText)
  if (canonicalJson(values) !== canonicalJson(sorted)) fail(`${label} must be sorted by ${key}`)
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate ${key} values`)
}

function assertEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label} differs`)
}

function parseArgs(argv) {
  const allowed = new Set([
    '--baseline',
    '--candidate',
    '--baseline-commit',
    '--baseline-tree',
    '--candidate-commit',
    '--candidate-tree',
    '--out',
  ])
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key)) fail(`unknown argument: ${key || '<missing>'}`)
    if (values[key] !== undefined) fail(`duplicate argument: ${key}`)
    if (value === undefined || value.startsWith('--')) fail(`missing value for ${key}`)
    values[key] = value
  }
  for (const key of allowed) if (values[key] === undefined) fail(`required argument is missing: ${key}`)
  for (const key of ['--baseline-commit', '--baseline-tree', '--candidate-commit', '--candidate-tree']) {
    assertGitOid(values[key], key)
  }
  return values
}

function resolveExistingFile(value, label) {
  const resolved = path.resolve(value)
  let status
  try {
    status = statSync(resolved)
  } catch {
    fail(`${label} does not exist`)
  }
  if (!status.isFile()) fail(`${label} must be a file`)
  return resolved
}

function readManifest(filePath, label) {
  const bytes = readFileSync(resolveExistingFile(filePath, label))
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
  validateManifest(value, label)
  return { bytes, value }
}

function validateRanges(ranges, byteLength, label) {
  if (!Array.isArray(ranges) || ranges.length === 0) fail(`${label} must be a nonempty array`)
  const identities = new Set()
  for (const [index, range] of ranges.entries()) {
    assertExactKeys(range, ['length', 'start'], `${label}[${index}]`)
    assertNonnegativeInteger(range.start, `${label}[${index}].start`)
    if (!Number.isSafeInteger(range.length) || range.length <= 0) fail(`${label}[${index}].length must be positive`)
    if (range.start + range.length > byteLength) fail(`${label}[${index}] exceeds bytecode length`)
    const identity = `${range.start}:${range.length}`
    if (identities.has(identity)) fail(`${label} contains duplicate ranges`)
    identities.add(identity)
  }
}

function validateLinkReferences(value, byteLength, label) {
  assertObject(value, label)
  for (const [sourceName, contracts] of Object.entries(value)) {
    if (!sourceName || sourceName.includes('\\')) fail(`${label} has an invalid source name`)
    assertObject(contracts, `${label}.${sourceName}`)
    if (Object.keys(contracts).length === 0) fail(`${label}.${sourceName} must not be empty`)
    for (const [contractName, ranges] of Object.entries(contracts)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contractName)) fail(`${label} has an invalid contract name`)
      validateRanges(ranges, byteLength, `${label}.${sourceName}.${contractName}`)
    }
  }
}

function validateImmutableReferences(value, byteLength, label) {
  assertObject(value, label)
  for (const [identifier, ranges] of Object.entries(value)) {
    if (!/^[0-9]+$/.test(identifier)) fail(`${label} has an invalid identifier`)
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
      'artifactFiles',
      'buildInfoFiles',
      'captureTool',
      'compilerInputs',
      'contractCount',
      'contracts',
      'hashes',
      'inputs',
      'provenance',
      'schema',
      'sources',
      'toolchain',
    ],
    label
  )
  if (manifest.schema !== MANIFEST_SCHEMA) fail(`${label}.schema must be ${MANIFEST_SCHEMA}`)
  assertExactKeys(manifest.captureTool, ['schemaVersion', 'sha256'], `${label}.captureTool`)
  if (manifest.captureTool.schemaVersion !== 1) fail(`${label}.captureTool.schemaVersion must be 1`)
  assertSha256(manifest.captureTool.sha256, `${label}.captureTool.sha256`)

  assertExactKeys(manifest.provenance, ['commit', 'label', 'method', 'tree'], `${label}.provenance`)
  assertGitOid(manifest.provenance.commit, `${label}.provenance.commit`)
  assertGitOid(manifest.provenance.tree, `${label}.provenance.tree`)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.provenance.label)) fail(`${label}.provenance.label is invalid`)
  if (manifest.provenance.method !== 'git-archive') fail(`${label}.provenance.method must be git-archive`)

  assertExactKeys(manifest.inputs, ['hardhatConfigSha256', 'packageLockSha256'], `${label}.inputs`)
  assertSha256(manifest.inputs.hardhatConfigSha256, `${label}.inputs.hardhatConfigSha256`)
  assertSha256(manifest.inputs.packageLockSha256, `${label}.inputs.packageLockSha256`)

  assertExactKeys(
    manifest.hashes,
    ['artifactSetSha256', 'buildInfoSetSha256', 'compilerInputSetSha256', 'contractSetSha256', 'soliditySourceSetSha256'],
    `${label}.hashes`
  )
  for (const [key, value] of Object.entries(manifest.hashes)) assertSha256(value, `${label}.hashes.${key}`)

  if (!Array.isArray(manifest.compilerInputs) || manifest.compilerInputs.length === 0) {
    fail(`${label}.compilerInputs must be nonempty`)
  }
  assertSortedUnique(manifest.compilerInputs, 'id', `${label}.compilerInputs`)
  for (const [index, entry] of manifest.compilerInputs.entries()) {
    const entryLabel = `${label}.compilerInputs[${index}]`
    assertExactKeys(
      entry,
      ['compilerType', 'evmVersion', 'id', 'optimizer', 'sha256', 'solcLongVersion', 'solcVersion'],
      entryLabel
    )
    if (entry.compilerType !== 'solc') fail(`${entryLabel}.compilerType must be solc`)
    if (typeof entry.id !== 'string' || entry.id.length === 0) fail(`${entryLabel}.id is missing`)
    if (entry.solcVersion !== REQUIRED_SOLC || !entry.solcLongVersion.startsWith(`${REQUIRED_SOLC}+`)) {
      fail(`${entryLabel} has the wrong compiler identity`)
    }
    if (entry.evmVersion !== REQUIRED_EVM) fail(`${entryLabel}.evmVersion must be ${REQUIRED_EVM}`)
    assertExactKeys(entry.optimizer, ['enabled', 'runs'], `${entryLabel}.optimizer`)
    if (entry.optimizer.enabled !== true || entry.optimizer.runs !== REQUIRED_OPTIMIZER_RUNS) {
      fail(`${entryLabel}.optimizer must be enabled with ${REQUIRED_OPTIMIZER_RUNS} runs`)
    }
    assertSha256(entry.sha256, `${entryLabel}.sha256`)
  }

  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) fail(`${label}.sources must be nonempty`)
  assertSortedUnique(manifest.sources, 'sourceName', `${label}.sources`)
  for (const [index, source] of manifest.sources.entries()) {
    const sourceLabel = `${label}.sources[${index}]`
    assertExactKeys(source, ['byteLength', 'sha256', 'sourceName'], sourceLabel)
    if (typeof source.sourceName !== 'string' || source.sourceName.length === 0 || source.sourceName.includes('\\')) {
      fail(`${sourceLabel}.sourceName is invalid`)
    }
    assertNonnegativeInteger(source.byteLength, `${sourceLabel}.byteLength`)
    assertSha256(source.sha256, `${sourceLabel}.sha256`)
  }

  if (!Array.isArray(manifest.contracts) || manifest.contracts.length === 0) fail(`${label}.contracts must be nonempty`)
  if (!Number.isSafeInteger(manifest.contractCount) || manifest.contractCount !== manifest.contracts.length) {
    fail(`${label}.contractCount does not match contracts`)
  }
  assertSortedUnique(manifest.contracts, 'fqn', `${label}.contracts`)
  const compilerInputById = new Map(manifest.compilerInputs.map((entry) => [entry.id, entry]))
  for (const [index, contract] of manifest.contracts.entries()) {
    const contractLabel = `${label}.contracts[${index}]`
    assertExactKeys(
      contract,
      [
        'abiEntryCount',
        'abiSha256',
        'buildInfoId',
        'compilerInputSha256',
        'contractName',
        'creationBytecode',
        'deployedBytecode',
        'deployedLinkReferences',
        'fqn',
        'immutableReferences',
        'inputSourceName',
        'linkReferences',
        'sourceName',
      ],
      contractLabel
    )
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contract.contractName)) fail(`${contractLabel}.contractName is invalid`)
    if (contract.fqn !== `${contract.sourceName}:${contract.contractName}`) fail(`${contractLabel}.fqn is inconsistent`)
    if (typeof contract.inputSourceName !== 'string' || contract.inputSourceName.length === 0) {
      fail(`${contractLabel}.inputSourceName is invalid`)
    }
    if (!Number.isSafeInteger(contract.abiEntryCount) || contract.abiEntryCount < 0) {
      fail(`${contractLabel}.abiEntryCount is invalid`)
    }
    assertSha256(contract.abiSha256, `${contractLabel}.abiSha256`)
    assertSha256(contract.compilerInputSha256, `${contractLabel}.compilerInputSha256`)
    const compilerInput = compilerInputById.get(contract.buildInfoId)
    if (!compilerInput || compilerInput.sha256 !== contract.compilerInputSha256) {
      fail(`${contractLabel} references an unknown compiler input`)
    }
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
  }

  if (!Array.isArray(manifest.artifactFiles) || manifest.artifactFiles.length !== manifest.contractCount) {
    fail(`${label}.artifactFiles must biject with contracts`)
  }
  assertSortedUnique(manifest.artifactFiles, 'path', `${label}.artifactFiles`)
  const contractsByFqn = new Map(manifest.contracts.map((contract) => [contract.fqn, contract]))
  const contractFqns = new Set(contractsByFqn.keys())
  const artifactFqns = new Set()
  for (const [index, artifact] of manifest.artifactFiles.entries()) {
    const artifactLabel = `${label}.artifactFiles[${index}]`
    assertExactKeys(artifact, ['byteLength', 'fqn', 'path', 'sha256'], artifactLabel)
    assertNonnegativeInteger(artifact.byteLength, `${artifactLabel}.byteLength`)
    assertSha256(artifact.sha256, `${artifactLabel}.sha256`)
    if (typeof artifact.path !== 'string' || artifact.path.includes('\\') || artifact.path.startsWith('/')) {
      fail(`${artifactLabel}.path is invalid`)
    }
    if (!contractFqns.has(artifact.fqn) || artifactFqns.has(artifact.fqn)) fail(`${artifactLabel}.fqn breaks bijection`)
    const artifactContract = contractsByFqn.get(artifact.fqn)
    if (artifact.path !== `${artifactContract.sourceName}/${artifactContract.contractName}.json`) {
      fail(`${artifactLabel}.path does not match its fully qualified contract`)
    }
    artifactFqns.add(artifact.fqn)
  }

  if (!Array.isArray(manifest.buildInfoFiles) || manifest.buildInfoFiles.length !== manifest.compilerInputs.length * 2) {
    fail(`${label}.buildInfoFiles must contain one input/output pair per compiler input`)
  }
  assertSortedUnique(manifest.buildInfoFiles, 'path', `${label}.buildInfoFiles`)
  const pairCounts = new Map()
  for (const [index, entry] of manifest.buildInfoFiles.entries()) {
    const entryLabel = `${label}.buildInfoFiles[${index}]`
    assertExactKeys(entry, ['byteLength', 'id', 'kind', 'path', 'sha256'], entryLabel)
    assertNonnegativeInteger(entry.byteLength, `${entryLabel}.byteLength`)
    assertSha256(entry.sha256, `${entryLabel}.sha256`)
    if (!compilerInputById.has(entry.id) || !['input', 'output'].includes(entry.kind)) fail(`${entryLabel} is invalid`)
    const expectedPath = entry.kind === 'input'
      ? `build-info/${entry.id}.json`
      : `build-info/${entry.id}.output.json`
    if (entry.path !== expectedPath) fail(`${entryLabel}.path does not match its build-info identity`)
    const identity = `${entry.id}:${entry.kind}`
    pairCounts.set(identity, (pairCounts.get(identity) || 0) + 1)
  }
  for (const compilerInput of manifest.compilerInputs) {
    if (pairCounts.get(`${compilerInput.id}:input`) !== 1 || pairCounts.get(`${compilerInput.id}:output`) !== 1) {
      fail(`${label} build-info pair is incomplete for ${compilerInput.id}`)
    }
  }

  assertExactKeys(manifest.toolchain, ['hardhat', 'node', 'npm', 'solidity'], `${label}.toolchain`)
  assertExactKeys(manifest.toolchain.node, ['executableSha256', 'version'], `${label}.toolchain.node`)
  if (manifest.toolchain.node.version !== REQUIRED_NODE) fail(`${label} Node version must be ${REQUIRED_NODE}`)
  assertSha256(manifest.toolchain.node.executableSha256, `${label}.toolchain.node.executableSha256`)
  assertExactKeys(manifest.toolchain.npm, ['cliSha256', 'packageJsonSha256', 'version'], `${label}.toolchain.npm`)
  if (manifest.toolchain.npm.version !== REQUIRED_NPM) fail(`${label} npm version must be ${REQUIRED_NPM}`)
  assertSha256(manifest.toolchain.npm.cliSha256, `${label}.toolchain.npm.cliSha256`)
  assertSha256(manifest.toolchain.npm.packageJsonSha256, `${label}.toolchain.npm.packageJsonSha256`)
  assertExactKeys(
    manifest.toolchain.hardhat,
    ['lockIntegrity', 'packageJsonSha256', 'version'],
    `${label}.toolchain.hardhat`
  )
  if (manifest.toolchain.hardhat.version !== REQUIRED_HARDHAT) fail(`${label} Hardhat version must be ${REQUIRED_HARDHAT}`)
  if (typeof manifest.toolchain.hardhat.lockIntegrity !== 'string' || manifest.toolchain.hardhat.lockIntegrity.length === 0) {
    fail(`${label} Hardhat lock integrity is missing`)
  }
  assertSha256(manifest.toolchain.hardhat.packageJsonSha256, `${label}.toolchain.hardhat.packageJsonSha256`)
  assertExactKeys(
    manifest.toolchain.solidity,
    ['compilerType', 'evmVersion', 'longVersion', 'optimizer', 'version'],
    `${label}.toolchain.solidity`
  )
  const firstCompiler = manifest.compilerInputs[0]
  assertEqual(
    manifest.toolchain.solidity,
    {
      compilerType: firstCompiler.compilerType,
      evmVersion: firstCompiler.evmVersion,
      longVersion: firstCompiler.solcLongVersion,
      optimizer: firstCompiler.optimizer,
      version: firstCompiler.solcVersion,
    },
    `${label}.toolchain.solidity`
  )

  if (manifest.hashes.artifactSetSha256 !== sha256(canonicalJson(manifest.artifactFiles))) {
    fail(`${label}.hashes.artifactSetSha256 is stale`)
  }
  if (manifest.hashes.buildInfoSetSha256 !== sha256(canonicalJson(manifest.buildInfoFiles))) {
    fail(`${label}.hashes.buildInfoSetSha256 is stale`)
  }
  if (manifest.hashes.compilerInputSetSha256 !== sha256(canonicalJson(manifest.compilerInputs))) {
    fail(`${label}.hashes.compilerInputSetSha256 is stale`)
  }
  if (manifest.hashes.contractSetSha256 !== sha256(canonicalJson(manifest.contracts))) {
    fail(`${label}.hashes.contractSetSha256 is stale`)
  }
  if (manifest.hashes.soliditySourceSetSha256 !== sha256(canonicalJson(manifest.sources))) {
    fail(`${label}.hashes.soliditySourceSetSha256 is stale`)
  }
}

function comparableContract(contract) {
  return {
    abiEntryCount: contract.abiEntryCount,
    abiSha256: contract.abiSha256,
    contractName: contract.contractName,
    creationBytecode: contract.creationBytecode,
    deployedBytecode: contract.deployedBytecode,
    deployedLinkReferences: contract.deployedLinkReferences,
    fqn: contract.fqn,
    immutableReferences: contract.immutableReferences,
    inputSourceName: contract.inputSourceName,
    linkReferences: contract.linkReferences,
    sourceName: contract.sourceName,
  }
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

function bindingSummary(manifest, manifestBytes) {
  return {
    artifactSetSha256: manifest.hashes.artifactSetSha256,
    buildInfoSetSha256: manifest.hashes.buildInfoSetSha256,
    captureToolSha256: manifest.captureTool.sha256,
    commit: manifest.provenance.commit,
    compilerInputSetSha256: manifest.hashes.compilerInputSetSha256,
    contractSetSha256: manifest.hashes.contractSetSha256,
    hardhatConfigSha256: manifest.inputs.hardhatConfigSha256,
    label: manifest.provenance.label,
    manifestSha256: sha256(manifestBytes),
    packageLockSha256: manifest.inputs.packageLockSha256,
    soliditySourceSetSha256: manifest.hashes.soliditySourceSetSha256,
    tree: manifest.provenance.tree,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseline = readManifest(args['--baseline'], 'baseline manifest')
  const candidate = readManifest(args['--candidate'], 'candidate manifest')

  if (baseline.value.provenance.label !== 'c2-baseline') fail('baseline label must be c2-baseline')
  if (candidate.value.provenance.label !== 'task2-explicit-shanghai') {
    fail('candidate label must be task2-explicit-shanghai')
  }
  if (baseline.value.provenance.commit !== args['--baseline-commit']) fail('baseline commit binding differs')
  if (baseline.value.provenance.tree !== args['--baseline-tree']) fail('baseline tree binding differs')
  if (candidate.value.provenance.commit !== args['--candidate-commit']) fail('candidate commit binding differs')
  if (candidate.value.provenance.tree !== args['--candidate-tree']) fail('candidate tree binding differs')
  if (baseline.value.provenance.commit === candidate.value.provenance.commit) fail('baseline and candidate commits must differ')
  if (baseline.value.provenance.tree === candidate.value.provenance.tree) fail('baseline and candidate trees must differ')

  assertEqual(candidate.value.captureTool, baseline.value.captureTool, 'capture tool identity')
  assertEqual(candidate.value.toolchain, baseline.value.toolchain, 'toolchain identity')
  assertEqual(candidate.value.inputs.packageLockSha256, baseline.value.inputs.packageLockSha256, 'package-lock hash')
  if (candidate.value.inputs.hardhatConfigSha256 === baseline.value.inputs.hardhatConfigSha256) {
    fail('Hardhat config hash must differ for the explicit-target candidate')
  }
  assertEqual(candidate.value.sources, baseline.value.sources, 'complete Solidity source set')
  assertEqual(
    candidate.value.compilerInputs.map(comparableCompilerInput),
    baseline.value.compilerInputs.map(comparableCompilerInput),
    'canonical compiler input content'
  )
  assertEqual(candidate.value.contractCount, baseline.value.contractCount, 'contract count')

  const baselineContracts = new Map(baseline.value.contracts.map((contract) => [contract.fqn, contract]))
  const candidateContracts = new Map(candidate.value.contracts.map((contract) => [contract.fqn, contract]))
  assertEqual([...candidateContracts.keys()].sort(), [...baselineContracts.keys()].sort(), 'fully qualified contract set')
  for (const fqn of [...baselineContracts.keys()].sort()) {
    assertEqual(comparableContract(candidateContracts.get(fqn)), comparableContract(baselineContracts.get(fqn)), `${fqn} exact output`)
  }

  const outPath = path.resolve(args['--out'])
  let outParentStatus
  try {
    outParentStatus = statSync(path.dirname(outPath))
  } catch {
    fail('output parent does not exist')
  }
  if (!outParentStatus.isDirectory()) fail('output parent must be a directory')

  const comparisonScriptSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)))
  const result = {
    baseline: bindingSummary(baseline.value, baseline.bytes),
    candidate: bindingSummary(candidate.value, candidate.bytes),
    comparedFields: [
      'fully-qualified-contract-set',
      'abi-sha256-and-entry-count',
      'complete-creation-bytecode-including-metadata',
      'complete-deployed-bytecode-including-metadata',
      'link-references',
      'deployed-link-references',
      'immutable-references',
      'complete-solidity-source-set',
      'canonical-compiler-input-content',
      'package-lock',
      'node-npm-hardhat-solc-optimizer-evm-identities',
      'capture-tool-bytes',
    ],
    comparisonTool: {
      schemaVersion: 1,
      sha256: comparisonScriptSha256,
    },
    contractCount: baseline.value.contractCount,
    intentionallyDifferentBindings: [
      'commit',
      'tree',
      'hardhat-config-sha256',
      'compiler-input-set-sha256-if-hardhat-serialization-differs',
      'artifact-set-sha256-if-hardhat-serialization-differs',
      'build-info-set-sha256',
    ],
    metadataStrippedOrNormalized: false,
    schema: COMPARISON_SCHEMA,
    verdict: 'exact-contract-output-equality',
  }

  writeFileSync(outPath, prettyCanonicalJson(result), { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(
    `Compared ${result.contractCount} contracts: ABI, full creation/deployed bytecode and references are exactly equal.\n`
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`Bytecode manifest comparison failed: ${error.message}\n`)
  process.exitCode = 1
}
