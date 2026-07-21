import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCHEMA = 'blockxone-bytecode-manifest-v1'
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

function parseJsonFile(filePath, label) {
  const bytes = readFileSync(filePath)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
  return { bytes, value }
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

function resolveExistingDirectory(value, label) {
  const resolved = path.resolve(value)
  let status
  try {
    status = statSync(resolved)
  } catch {
    fail(`${label} does not exist`)
  }
  if (!status.isDirectory()) fail(`${label} must be a directory`)
  return resolved
}

function resolveInside(root, relativeName, label) {
  const resolved = path.resolve(root, relativeName)
  const relative = path.relative(root, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} resolves outside its root`)
  }
  return resolved
}

function listFiles(root) {
  const output = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) fail(`artifact tree contains symbolic link: ${entry.name}`)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile()) output.push(fullPath)
      else fail(`artifact tree contains unsupported filesystem entry: ${entry.name}`)
    }
  }
  visit(root)
  return output
}

function parseArgs(argv) {
  const allowed = new Set([
    '--artifacts',
    '--source-root',
    '--config',
    '--package-lock',
    '--npm-cli',
    '--commit',
    '--tree',
    '--label',
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
  for (const key of allowed) {
    if (values[key] === undefined) fail(`required argument is missing: ${key}`)
  }
  if (!/^[0-9a-f]{40}$/.test(values['--commit'])) fail('--commit must be a full lowercase Git object ID')
  if (!/^[0-9a-f]{40}$/.test(values['--tree'])) fail('--tree must be a full lowercase Git object ID')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(values['--label'])) fail('--label must be a stable lowercase evidence label')
  return values
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
  if (cborByteLength === 0 || suffixCharacters > body.length) fail(`${label} has an invalid Solidity metadata length`)
  const suffix = body.slice(-suffixCharacters)
  if (!/^[0-9a-fA-F]+$/.test(suffix)) fail(`${label} metadata is malformed`)
  return { byteLength: cborByteLength + 2, sha256: sha256(`0x${suffix}`) }
}

function creationMetadataEvidence(creationBytecode, deployedBytecode, deployedMetadata, label) {
  if (creationBytecode === '0x') return { byteLength: 0, sha256: sha256('0x') }
  if (deployedBytecode === '0x' || deployedMetadata.byteLength === 0) {
    fail(`${label} has creation code without a corresponding deployed metadata segment`)
  }
  const deployedBody = deployedBytecode.slice(2)
  const metadataCharacters = deployedMetadata.byteLength * 2
  const metadataBody = deployedBody.slice(-metadataCharacters)
  if (!creationBytecode.slice(2).includes(metadataBody)) {
    fail(`${label} does not contain the exact deployed metadata bytes`)
  }
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
    if (seen.has(identity)) fail(`${label} contains a duplicate range`)
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

function validateCompilerInput(header, label) {
  assertExactKeys(header.input, ['language', 'settings', 'sources'], `${label}.input`)
  if (header.input.language !== 'Solidity') fail(`${label} language must be Solidity`)
  assertObject(header.input.settings, `${label}.input.settings`)
  assertExactKeys(header.input.settings.optimizer, ['enabled', 'runs'], `${label}.input.settings.optimizer`)
  if (header.input.settings.optimizer.enabled !== true || header.input.settings.optimizer.runs !== REQUIRED_OPTIMIZER_RUNS) {
    fail(`${label} optimizer must be enabled with ${REQUIRED_OPTIMIZER_RUNS} runs`)
  }
  if (header.input.settings.evmVersion !== REQUIRED_EVM) fail(`${label} EVM target must resolve to ${REQUIRED_EVM}`)
  assertObject(header.input.sources, `${label}.input.sources`)
  if (Object.keys(header.input.sources).length === 0) fail(`${label} has zero compiler sources`)
  for (const [sourceName, source] of Object.entries(header.input.sources)) {
    normalizeRelativePath(sourceName, `${label} compiler source`)
    assertExactKeys(source, ['content'], `${label}.input.sources.${sourceName}`)
    if (typeof source.content !== 'string') fail(`${label} source content must be a string`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const artifactRoot = resolveExistingDirectory(args['--artifacts'], '--artifacts')
  const sourceRoot = resolveExistingDirectory(args['--source-root'], '--source-root')
  const configPath = resolveExistingFile(args['--config'], '--config')
  const packageLockPath = resolveExistingFile(args['--package-lock'], '--package-lock')
  const npmCliPath = resolveExistingFile(args['--npm-cli'], '--npm-cli')
  const outPath = path.resolve(args['--out'])
  resolveExistingDirectory(path.dirname(outPath), 'output parent')

  const captureScriptPath = fileURLToPath(import.meta.url)
  const captureScriptSha256 = sha256(readFileSync(captureScriptPath))

  if (process.versions.node !== REQUIRED_NODE) fail(`Node must be exactly ${REQUIRED_NODE}`)
  const nodeExecutableSha256 = sha256(readFileSync(process.execPath))

  const npmPackagePath = resolveExistingFile(path.resolve(path.dirname(npmCliPath), '..', 'package.json'), 'npm package.json')
  const npmPackage = parseJsonFile(npmPackagePath, 'npm package.json')
  if (npmPackage.value.version !== REQUIRED_NPM) fail(`npm must be exactly ${REQUIRED_NPM}`)

  const hardhatPackagePath = resolveExistingFile(path.join(sourceRoot, 'node_modules', 'hardhat', 'package.json'), 'Hardhat package.json')
  const hardhatPackage = parseJsonFile(hardhatPackagePath, 'Hardhat package.json')
  if (hardhatPackage.value.version !== REQUIRED_HARDHAT) fail(`Hardhat must be exactly ${REQUIRED_HARDHAT}`)

  const packageLock = parseJsonFile(packageLockPath, 'package-lock.json')
  const lockedRootHardhat = packageLock.value.packages?.['']?.devDependencies?.hardhat
  const lockedHardhat = packageLock.value.packages?.['node_modules/hardhat']
  if (lockedRootHardhat !== REQUIRED_HARDHAT || lockedHardhat?.version !== REQUIRED_HARDHAT) {
    fail(`package-lock.json must pin Hardhat ${REQUIRED_HARDHAT}`)
  }
  if (typeof lockedHardhat.integrity !== 'string' || lockedHardhat.integrity.length === 0) {
    fail('package-lock.json Hardhat integrity is missing')
  }

  const buildInfoRoot = resolveExistingDirectory(path.join(artifactRoot, 'build-info'), 'Hardhat build-info directory')
  const buildInfoFiles = listFiles(buildInfoRoot)
  const headerFiles = buildInfoFiles.filter((file) => file.endsWith('.json') && !file.endsWith('.output.json'))
  const outputFiles = buildInfoFiles.filter((file) => file.endsWith('.output.json'))
  if (headerFiles.length === 0) fail('Hardhat build-info contains zero compiler inputs')
  if (headerFiles.length !== outputFiles.length || headerFiles.length * 2 !== buildInfoFiles.length) {
    fail('Hardhat build-info must contain one header and one output file per compiler input')
  }

  const buildInfos = new Map()
  const compilerInputs = []
  const buildInfoEvidence = []
  const sourceContents = new Map()
  const expectedContracts = new Map()

  for (const headerPath of headerFiles.sort()) {
    const relativeHeaderPath = normalizeRelativePath(path.relative(artifactRoot, headerPath), 'build-info header path')
    const headerFile = parseJsonFile(headerPath, relativeHeaderPath)
    const header = headerFile.value
    assertExactKeys(
      header,
      ['_format', 'compilerType', 'id', 'input', 'solcLongVersion', 'solcVersion', 'userSourceNameMap'],
      relativeHeaderPath
    )
    if (header._format !== 'hh3-sol-build-info-1') fail(`${relativeHeaderPath} has an unexpected format`)
    if (header.compilerType !== 'solc') fail(`${relativeHeaderPath} compilerType must be solc`)
    if (header.solcVersion !== REQUIRED_SOLC) fail(`${relativeHeaderPath} solc version must be ${REQUIRED_SOLC}`)
    if (typeof header.solcLongVersion !== 'string' || !header.solcLongVersion.startsWith(`${REQUIRED_SOLC}+`)) {
      fail(`${relativeHeaderPath} solc long version is malformed`)
    }
    if (typeof header.id !== 'string' || header.id.length === 0) fail(`${relativeHeaderPath} build-info id is missing`)
    if (path.basename(headerPath) !== `${header.id}.json`) fail(`${relativeHeaderPath} filename does not match its id`)
    if (buildInfos.has(header.id)) fail(`duplicate build-info id: ${header.id}`)
    assertObject(header.userSourceNameMap, `${relativeHeaderPath}.userSourceNameMap`)
    validateCompilerInput(header, relativeHeaderPath)

    const outputPath = path.join(buildInfoRoot, `${header.id}.output.json`)
    const relativeOutputPath = normalizeRelativePath(path.relative(artifactRoot, outputPath), 'build-info output path')
    const outputFile = parseJsonFile(resolveExistingFile(outputPath, relativeOutputPath), relativeOutputPath)
    const output = outputFile.value
    assertExactKeys(output, ['_format', 'id', 'output'], relativeOutputPath)
    if (output._format !== 'hh3-sol-build-info-output-1' || output.id !== header.id) {
      fail(`${relativeOutputPath} does not match its build-info header`)
    }
    assertObject(output.output, `${relativeOutputPath}.output`)
    assertObject(output.output.contracts, `${relativeOutputPath}.output.contracts`)

    const inputSha256 = sha256(canonicalJson(header.input))
    compilerInputs.push({
      compilerType: header.compilerType,
      evmVersion: header.input.settings.evmVersion,
      id: header.id,
      optimizer: header.input.settings.optimizer,
      sha256: inputSha256,
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
      if (prior !== undefined && prior !== source.content) fail(`compiler source content differs across build inputs: ${inputSourceName}`)
      sourceContents.set(inputSourceName, source.content)
    }

    for (const [userSourceNameValue, inputSourceNameValue] of Object.entries(header.userSourceNameMap)) {
      const userSourceName = normalizeRelativePath(userSourceNameValue, 'user source name')
      const inputSourceName = normalizeRelativePath(inputSourceNameValue, 'compiler input source name')
      const compilerSource = header.input.sources[inputSourceName]
      if (!compilerSource) fail(`${userSourceName} is absent from its compiler input`)
      const userSourcePath = resolveExistingFile(resolveInside(sourceRoot, userSourceName, userSourceName), userSourceName)
      if (readFileSync(userSourcePath, 'utf8') !== compilerSource.content) {
        fail(`${userSourceName} content differs from the exact compiler input`)
      }

      const sourceContracts = output.output.contracts[inputSourceName]
      if (sourceContracts === undefined) continue
      assertObject(sourceContracts, `${relativeOutputPath}.output.contracts.${inputSourceName}`)
      for (const [contractName, contractOutput] of Object.entries(sourceContracts)) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(contractName)) fail(`invalid contract name: ${contractName}`)
        const fqn = `${userSourceName}:${contractName}`
        if (expectedContracts.has(fqn)) fail(`duplicate fully qualified contract in build-info: ${fqn}`)
        expectedContracts.set(fqn, {
          buildInfoId: header.id,
          compilerInputSha256: inputSha256,
          contractName,
          contractOutput,
          inputSourceName,
          sourceName: userSourceName,
        })
      }
    }

    buildInfos.set(header.id, { header, output })
  }

  if (expectedContracts.size === 0) fail('Hardhat build-info contains zero user contracts')

  const artifactJsonFiles = listFiles(artifactRoot).filter((file) => {
    const relative = path.relative(artifactRoot, file).replaceAll('\\', '/')
    return relative.endsWith('.json') && !relative.startsWith('build-info/') && !relative.endsWith('.dbg.json')
  })
  if (artifactJsonFiles.length === 0) fail('Hardhat artifact tree contains zero contract artifacts')

  const contracts = []
  const artifactEvidence = []
  const observedContracts = new Set()

  for (const artifactPath of artifactJsonFiles.sort()) {
    const relativePath = normalizeRelativePath(path.relative(artifactRoot, artifactPath), 'artifact path')
    const artifactFile = parseJsonFile(artifactPath, relativePath)
    const artifact = artifactFile.value
    assertExactKeys(
      artifact,
      [
        '_format',
        'abi',
        'buildInfoId',
        'bytecode',
        'contractName',
        'deployedBytecode',
        'deployedLinkReferences',
        'immutableReferences',
        'inputSourceName',
        'linkReferences',
        'sourceName',
      ],
      relativePath
    )
    if (artifact._format !== 'hh3-artifact-1') fail(`${relativePath} has an unexpected artifact format`)
    const sourceName = normalizeRelativePath(artifact.sourceName, `${relativePath}.sourceName`)
    const inputSourceName = normalizeRelativePath(artifact.inputSourceName, `${relativePath}.inputSourceName`)
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(artifact.contractName)) fail(`${relativePath} has an invalid contract name`)
    const expectedPath = `${sourceName}/${artifact.contractName}.json`
    if (relativePath !== expectedPath) fail(`${relativePath} does not match ${expectedPath}`)

    const fqn = `${sourceName}:${artifact.contractName}`
    if (observedContracts.has(fqn)) fail(`duplicate contract artifact: ${fqn}`)
    observedContracts.add(fqn)
    const expected = expectedContracts.get(fqn)
    if (!expected) fail(`artifact has no matching build-info contract: ${fqn}`)
    if (
      artifact.buildInfoId !== expected.buildInfoId
      || inputSourceName !== expected.inputSourceName
      || artifact.contractName !== expected.contractName
    ) {
      fail(`artifact provenance does not match build-info: ${fqn}`)
    }

    if (!Array.isArray(artifact.abi)) fail(`${fqn} ABI must be an array`)
    assertObject(expected.contractOutput, `${fqn} compiler output`)
    assertObject(expected.contractOutput.evm, `${fqn} compiler EVM output`)
    assertObject(expected.contractOutput.evm.bytecode, `${fqn} compiler creation bytecode`)
    assertObject(expected.contractOutput.evm.deployedBytecode, `${fqn} compiler deployed bytecode`)
    if (canonicalJson(artifact.abi) !== canonicalJson(expected.contractOutput.abi)) fail(`${fqn} ABI differs from build-info`)
    if (artifact.bytecode !== `0x${expected.contractOutput.evm.bytecode.object}`) fail(`${fqn} creation bytecode differs from build-info`)
    if (artifact.deployedBytecode !== `0x${expected.contractOutput.evm.deployedBytecode.object}`) {
      fail(`${fqn} deployed bytecode differs from build-info`)
    }
    if (canonicalJson(artifact.linkReferences) !== canonicalJson(expected.contractOutput.evm.bytecode.linkReferences)) {
      fail(`${fqn} creation link references differ from build-info`)
    }
    if (
      canonicalJson(artifact.deployedLinkReferences)
      !== canonicalJson(expected.contractOutput.evm.deployedBytecode.linkReferences)
    ) {
      fail(`${fqn} deployed link references differ from build-info`)
    }
    if (
      canonicalJson(artifact.immutableReferences)
      !== canonicalJson(expected.contractOutput.evm.deployedBytecode.immutableReferences)
    ) {
      fail(`${fqn} immutable references differ from build-info`)
    }

    const creationByteLength = validateBytecode(artifact.bytecode, `${fqn} creation bytecode`)
    const deployedByteLength = validateBytecode(artifact.deployedBytecode, `${fqn} deployed bytecode`)
    validateLinkReferences(artifact.linkReferences, creationByteLength, `${fqn} linkReferences`)
    validateLinkReferences(artifact.deployedLinkReferences, deployedByteLength, `${fqn} deployedLinkReferences`)
    validateImmutableReferences(artifact.immutableReferences, deployedByteLength, `${fqn} immutableReferences`)

    const deployedMetadata = deployedMetadataEvidence(artifact.deployedBytecode, `${fqn} deployed bytecode`)
    const creationMetadata = creationMetadataEvidence(
      artifact.bytecode,
      artifact.deployedBytecode,
      deployedMetadata,
      `${fqn} creation bytecode`
    )

    contracts.push({
      abiEntryCount: artifact.abi.length,
      abiSha256: sha256(canonicalJson(artifact.abi)),
      buildInfoId: artifact.buildInfoId,
      compilerInputSha256: expected.compilerInputSha256,
      contractName: artifact.contractName,
      creationBytecode: {
        byteLength: creationByteLength,
        metadata: creationMetadata,
        sha256: sha256(artifact.bytecode),
      },
      deployedBytecode: {
        byteLength: deployedByteLength,
        metadata: deployedMetadata,
        sha256: sha256(artifact.deployedBytecode),
      },
      deployedLinkReferences: artifact.deployedLinkReferences,
      fqn,
      immutableReferences: artifact.immutableReferences,
      inputSourceName,
      linkReferences: artifact.linkReferences,
      sourceName,
    })
    artifactEvidence.push({
      byteLength: artifactFile.bytes.length,
      fqn,
      path: relativePath,
      sha256: sha256(artifactFile.bytes),
    })
  }

  const missingArtifacts = [...expectedContracts.keys()].filter((fqn) => !observedContracts.has(fqn)).sort()
  if (missingArtifacts.length > 0) fail(`build-info contracts missing artifacts: ${missingArtifacts.join(', ')}`)

  contracts.sort((a, b) => compareText(a.fqn, b.fqn))
  artifactEvidence.sort((a, b) => compareText(a.path, b.path))
  buildInfoEvidence.sort((a, b) => compareText(a.path, b.path))
  compilerInputs.sort((a, b) => compareText(a.id, b.id))

  const sources = [...sourceContents.entries()]
    .map(([sourceName, content]) => ({
      byteLength: Buffer.byteLength(content, 'utf8'),
      sha256: sha256(content),
      sourceName,
    }))
    .sort((a, b) => compareText(a.sourceName, b.sourceName))

  const compilerIdentities = new Set(
    compilerInputs.map((entry) => `${entry.compilerType}:${entry.solcVersion}:${entry.solcLongVersion}`)
  )
  if (compilerIdentities.size !== 1) fail('all build inputs must use one exact compiler identity')

  const manifest = {
    artifactFiles: artifactEvidence,
    buildInfoFiles: buildInfoEvidence,
    captureTool: {
      schemaVersion: 1,
      sha256: captureScriptSha256,
    },
    compilerInputs,
    contractCount: contracts.length,
    contracts,
    hashes: {
      artifactSetSha256: sha256(canonicalJson(artifactEvidence)),
      buildInfoSetSha256: sha256(canonicalJson(buildInfoEvidence)),
      compilerInputSetSha256: sha256(canonicalJson(compilerInputs)),
      contractSetSha256: sha256(canonicalJson(contracts)),
      soliditySourceSetSha256: sha256(canonicalJson(sources)),
    },
    inputs: {
      hardhatConfigSha256: sha256(readFileSync(configPath)),
      packageLockSha256: sha256(packageLock.bytes),
    },
    provenance: {
      commit: args['--commit'],
      label: args['--label'],
      method: 'git-archive',
      tree: args['--tree'],
    },
    schema: SCHEMA,
    sources,
    toolchain: {
      hardhat: {
        lockIntegrity: lockedHardhat.integrity,
        packageJsonSha256: sha256(hardhatPackage.bytes),
        version: hardhatPackage.value.version,
      },
      node: {
        executableSha256: nodeExecutableSha256,
        version: process.versions.node,
      },
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
  }

  if (manifest.contractCount === 0) fail('refusing to write a zero-contract manifest')
  writeFileSync(outPath, prettyCanonicalJson(manifest), { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(
    `Captured ${manifest.contractCount} contracts for ${manifest.provenance.label}; contract set ${manifest.hashes.contractSetSha256}.\n`
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`Bytecode manifest capture failed: ${error.message}\n`)
  process.exitCode = 1
}
