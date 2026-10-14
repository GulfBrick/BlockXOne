/** Cloud-only source compilation. No wallets, signing keys, RPC writes or deployment. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') {
  throw new Error('Canonical compilation is restricted to the GitHub-hosted Linux workflow.')
}
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (resolve(process.cwd()) !== repository) throw new Error('Run from the checked-out repository root.')
const lockPath = join(repository, 'contracts/canonical/cloud-package.json')
const lockBytes = await readFile(lockPath)
const lock = JSON.parse(lockBytes.toString('utf8'))
if (lock.schema_version !== 1 || process.version !== `v${lock.node}`
  || lock.compiler !== '0.8.17+commit.8df45f5f' || lock.network?.chain_id !== 80002) {
  throw new Error('The locked cloud runtime or compiler contract does not match.')
}
const runnerTemp = process.env.RUNNER_TEMP && resolve(process.env.RUNNER_TEMP)
if (!runnerTemp || !isAbsolute(process.env.RUNNER_TEMP)) throw new Error('RUNNER_TEMP is required.')
const argumentsMap = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--packages', '--out'].includes(key) || !value || argumentsMap.has(key)) throw new Error('Invalid output arguments.')
  argumentsMap.set(key, resolve(value))
}
const packageDirectory = argumentsMap.get('--packages'), outputDirectory = argumentsMap.get('--out')
if (packageDirectory !== join(runnerTemp, 'bx1-canonical-packages')
  || outputDirectory !== join(runnerTemp, 'bx1-canonical-artifacts')
  || existsSync(packageDirectory) || existsSync(outputDirectory)) {
  throw new Error('Fresh, fixed GitHub runner directories are required; no existing files are overwritten.')
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const packageNames = new Set(lock.packages.map(item => item.name))
if (lock.packages.length !== 13 || packageNames.size !== 13) throw new Error('Unexpected dependency lock cardinality.')
const moduleDirectory = join(packageDirectory, 'node_modules')
await mkdir(moduleDirectory, { recursive: true })

async function download(url, limit) {
  const target = new URL(url)
  if (target.origin !== 'https://registry.npmjs.org' || target.username || target.password || target.search || target.hash) {
    throw new Error('Only exact unauthenticated npm registry URLs are allowed.')
  }
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok || response.redirected || !response.body) throw new Error(`Archive request failed: ${target.pathname}`)
  const chunks = []; let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > limit) throw new Error(`Registry response exceeds the bound: ${target.pathname}`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Pinned archive inspection/extraction failed.')
  return result.stdout
}
const installed = []
for (const [index, item] of lock.packages.entries()) {
  if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(item.name) || !/^\d+\.\d+\.\d+$/.test(item.version)
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity)) throw new Error('Malformed dependency lock.')
  const metadata = JSON.parse((await download(`https://registry.npmjs.org/${item.name}/${item.version}`, 1024 * 1024)).toString('utf8'))
  if (metadata.name !== item.name || metadata.version !== item.version || metadata.dist?.integrity !== item.integrity
    || metadata.dist?.tarball !== item.tarball || (item.git_head && metadata.gitHead !== item.git_head)) {
    throw new Error(`Dependency provenance mismatch: ${item.name}`)
  }
  // Every compiler transitive dependency is pinned and supplied in the same
  // private module tree. npm install and all package lifecycle scripts are absent.
  if (Object.keys(metadata.dependencies ?? {}).some(name => !packageNames.has(name))) {
    throw new Error(`Unpinned transitive dependency: ${item.name}`)
  }
  const archive = await download(item.tarball, 50 * 1024 * 1024)
  if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== item.integrity) {
    throw new Error(`Archive integrity mismatch: ${item.name}`)
  }
  const archivePath = join(packageDirectory, `${index}.tgz`)
  await writeFile(archivePath, archive, { flag: 'wx' })
  const names = tar(['-tzf', archivePath]).trim().split('\n')
  const modes = tar(['-tvzf', archivePath]).trim().split('\n')
  if (names.some(name => !name.startsWith('package/') || name.includes('\\') || name.includes('\0')
    || name.split('/').some(part => part === '..' || part === '.'))
    || modes.some(line => !['-', 'd'].includes(line[0]))) {
    throw new Error(`Unsafe archive member/link: ${item.name}`)
  }
  const destination = join(moduleDirectory, item.name)
  await mkdir(destination, { recursive: true })
  tar(['-xzf', archivePath, '-C', destination, '--strip-components=1', '--no-same-owner', '--no-same-permissions'])
  const extracted = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
  if (extracted.name !== item.name || extracted.version !== item.version) throw new Error('Extracted package identity differs.')
  installed.push({ ...item, archive_sha256: sha256(archive) })
}
const require = createRequire(join(moduleDirectory, 'solc/package.json'))
const solc = require(join(moduleDirectory, 'solc/index.js'))
const { keccak_256: keccak256 } = require(join(moduleDirectory, 'js-sha3/src/sha3.js'))
if (!solc.version().startsWith(lock.compiler)) throw new Error('Unexpected actual Solidity compiler.')

const trex = '@erc3643org/erc-3643/contracts/'
const oid = '@onchain-id/solidity/contracts/'
const targets = [
  ['Token', `${trex}token/Token.sol`],
  ['IdentityRegistry', `${trex}registry/implementation/IdentityRegistry.sol`],
  ['IdentityRegistryStorage', `${trex}registry/implementation/IdentityRegistryStorage.sol`],
  ['TrustedIssuersRegistry', `${trex}registry/implementation/TrustedIssuersRegistry.sol`],
  ['ClaimTopicsRegistry', `${trex}registry/implementation/ClaimTopicsRegistry.sol`],
  ['ModularCompliance', `${trex}compliance/modular/ModularCompliance.sol`],
  ...['TokenProxy', 'IdentityRegistryProxy', 'IdentityRegistryStorageProxy', 'TrustedIssuersRegistryProxy', 'ClaimTopicsRegistryProxy', 'ModularComplianceProxy']
    .map(name => [name, `${trex}proxy/${name}.sol`]),
  ['TREXImplementationAuthority', `${trex}proxy/authority/TREXImplementationAuthority.sol`],
  ['IAFactory', `${trex}proxy/authority/IAFactory.sol`],
  ['TREXFactory', `${trex}factory/TREXFactory.sol`],
  ['Identity', `${oid}Identity.sol`], ['ClaimIssuer', `${oid}ClaimIssuer.sol`],
  ['IdentityProxy', `${oid}proxy/IdentityProxy.sol`],
  ['ImplementationAuthority', `${oid}proxy/ImplementationAuthority.sol`],
  ['IdFactory', `${oid}factory/IdFactory.sol`],
  ['Bx1FundController', 'contracts/canonical/Bx1FundController.sol'],
  ['Bx1MaximumHoldingModule', 'contracts/canonical/Bx1MaximumHoldingModule.sol'],
  ['Bx1TestSettlementToken', 'contracts/canonical/Bx1TestSettlementToken.sol'],
]
const localSources = new Set(targets.filter(([, path]) => path.startsWith('contracts/')).map(([, path]) => path))
function sourceFile(key) {
  if (key.includes('\\') || key.includes('\0') || posix.normalize(key) !== key || isAbsolute(key)) throw new Error('Invalid Solidity source key.')
  if (localSources.has(key)) return join(repository, key)
  const prefix = ['@erc3643org/erc-3643/', '@onchain-id/solidity/', '@openzeppelin/contracts/', '@openzeppelin/contracts-upgradeable/']
    .find(value => key.startsWith(value))
  if (!prefix) throw new Error(`Unadmitted Solidity import: ${key}`)
  const resolved = resolve(moduleDirectory, key)
  if (relative(moduleDirectory, resolved).startsWith('..')) throw new Error('Solidity import leaves the package tree.')
  return resolved
}
const sources = new Map()
function loadSource(key) {
  if (sources.has(key)) return
  const bytes = readFileSync(sourceFile(key))
  const content = bytes.toString('utf8')
  if (!Buffer.from(content).equals(bytes)) throw new Error(`Non-UTF8 Solidity source: ${key}`)
  sources.set(key, { content })
  // Resolve the closed import graph before compilation, retaining the complete
  // standard JSON input. The compiler's callback below refuses omitted imports.
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
  const imports = /\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']\s*;/g
  for (const match of withoutComments.matchAll(imports)) {
    const request = match[1]
    const imported = request.startsWith('.') ? posix.normalize(posix.join(posix.dirname(key), request)) : request
    loadSource(imported)
  }
}
for (const [, path] of targets) loadSource(path)
const input = {
  language: 'Solidity', sources: Object.fromEntries([...sources.entries()].sort(([a], [b]) => a.localeCompare(b))),
  settings: { ...lock.settings, outputSelection: { '*': { '*': ['abi', 'metadata', 'storageLayout', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } },
}
const rawOutput = solc.compile(JSON.stringify(input), { import: key => ({ error: `Import was not included in the closed input: ${key}` }) })
const output = JSON.parse(rawOutput)
const errors = (output.errors ?? []).filter(item => item.severity === 'error')
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage ?? error.message)
  throw new Error('Canonical Solidity compilation failed. No artifacts are admitted or deployed.')
}
const sourceHashes = Object.fromEntries([...sources.entries()].map(([path, value]) => [path, sha256(value.content)]))
const sourceIds = Object.fromEntries(Object.entries(output.sources ?? {}).map(([path, value]) => [value.id, path]))
const astNodes = new Map()
function visit(node, path) {
  if (!node || typeof node !== 'object') return
  if (Number.isInteger(node.id)) astNodes.set(String(node.id), { source: path, name: node.name ?? null, node_type: node.nodeType ?? null })
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, path))
    else if (value && typeof value === 'object') visit(value, path)
  }
}
for (const [path, value] of Object.entries(output.sources ?? {})) visit(value.ast, path)
function bytecode(code, name) {
  if (!code || !/^(?:[0-9a-fA-F]{2})+$/.test(code.object)) throw new Error(`Empty/unlinked bytecode: ${name}`)
  if (Object.keys(code.linkReferences ?? {}).length) throw new Error(`Unresolved library binding: ${name}`)
  const bytes = Buffer.from(code.object, 'hex')
  return { code: `0x${code.object}`, sha256: sha256(bytes), keccak256: `0x${keccak256(bytes)}`, link_references: code.linkReferences ?? {}, source_map: code.sourceMap }
}
await mkdir(join(outputDirectory, 'artifacts'), { recursive: true })
const artifactIndex = []
for (const [name, source] of targets) {
  const compiled = output.contracts?.[source]?.[name]
  if (!compiled) throw new Error(`Missing canonical compiled contract: ${name}`)
  const creation = bytecode(compiled.evm?.bytecode, name), runtime = bytecode(compiled.evm?.deployedBytecode, name)
  const immutableReferences = compiled.evm.deployedBytecode.immutableReferences ?? {}
  const immutables = Object.fromEntries(Object.entries(immutableReferences).map(([id, references]) => [id, { ...astNodes.get(id), references }]))
  const artifact = {
    schema: 'blockxone.canonical-fund-artifact.v1', status: 'COMPILED_SOURCE_NOT_DEPLOYED_NOT_ADMITTED',
    chain_id: 80002, contract_name: name, source_path: source, source_sha256: sourceHashes[source],
    application_commit: process.env.GITHUB_SHA ?? null, release_source: lock.source_references,
    compiler_version: solc.version(), settings: input.settings, abi: compiled.abi,
    constructor: compiled.abi.find(fragment => fragment.type === 'constructor') ?? { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
    constructor_arguments: null, deployed_address: null, deployment_transaction: null,
    creation, runtime_template: runtime, immutable_references: immutableReferences, immutable_bindings: immutables,
    deployed_runtime_keccak256: null,
    runtime_hash_warning: 'Template hash is not deployed runtime proof. Patch/verify all immutable constructor bindings and compare independently observed code after finality.',
    storage_layout: compiled.storageLayout, compiler_metadata: JSON.parse(compiled.metadata), source_hashes: sourceHashes,
  }
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`
  await writeFile(join(outputDirectory, 'artifacts', `${name}.json`), serialized, { flag: 'wx' })
  artifactIndex.push({ name, source, file: `artifacts/${name}.json`, sha256: sha256(serialized), constructor: artifact.constructor,
    runtime_has_immutables: Object.keys(immutableReferences).length > 0, deployed_address: null })
}
const zeroAddress = `0x${'0'.repeat(40)}`
const bootstrap = {
  schema: 'blockxone.canonical-fund-bootstrap.v1', status: 'COMPILED_DEPLOYMENT_PLAN_NOT_DEPLOYED_NOT_ADMITTED',
  chain_id: 80002, application_commit: process.env.GITHUB_SHA ?? null, addresses: {},
  human_wallet_interface: 'METAMASK', routine_execution: 'SAFE_TRANSACTION', eoa_routine_fallback: false,
  externally_required: ['An actually deployed and verified Safe, singleton, >=2 independently appointed human owners and threshold, nonce, zero modules and admitted guard/fallback',
    'Reviewed product/class/offering, claim topics, identity/claim signing authorities, maximum holding/base-unit limits, settlement beneficiary and fixed TST initial supply/holder',
    'Actual cryptographic claims, authority/appointment evidence and owner review; compiler artifacts do not establish any of these'],
  steps: [
    { id: 'safe', kind: 'EXTERNAL_REQUIRED', artifact: null, note: 'No address/default Safe is supplied or admitted.' },
    { id: 'implementations', kind: 'CONTRACT_DEPLOYMENTS', artifacts: ['Token', 'ClaimTopicsRegistry', 'IdentityRegistryStorage', 'IdentityRegistry', 'TrustedIssuersRegistry', 'ModularCompliance'], constructor_args: [] },
    { id: 'oid-implementation', artifact: 'Identity', constructor_args: ['approved initial management key', true] },
    { id: 'oid-authority', artifact: 'ImplementationAuthority', depends_on: ['oid-implementation'], constructor_args: ['oid-implementation.address'] },
    { id: 'oid-factory', artifact: 'IdFactory', depends_on: ['oid-authority'], constructor_args: ['oid-authority.address'] },
    { id: 'trex-authority', artifact: 'TREXImplementationAuthority', depends_on: ['implementations'], constructor_args: [true, zeroAddress, zeroAddress] },
    { id: 'trex-version', kind: 'OWNER_TRANSACTION', depends_on: ['implementations', 'trex-authority'], method: 'addAndUseTREXVersion', args: [{ major: 4, minor: 1, patch: 3 }, 'exact six implementation addresses'] },
    { id: 'trex-factory', artifact: 'TREXFactory', depends_on: ['trex-version', 'oid-factory'], constructor_args: ['trex-authority.address', 'oid-factory.address'] },
    { id: 'ia-factory', artifact: 'IAFactory', depends_on: ['trex-factory'], constructor_args: ['trex-factory.address'] },
    { id: 'authority-factory-bindings', kind: 'OWNER_TRANSACTIONS', depends_on: ['ia-factory'], methods: ['TREXImplementationAuthority.setTREXFactory(trex-factory.address)', 'TREXImplementationAuthority.setIAFactory(ia-factory.address)', 'IdFactory.addTokenFactory(trex-factory.address)'] },
    { id: 'controller', artifact: 'Bx1FundController', depends_on: ['safe', 'trex-factory'], constructor_args: ['safe.address', 'trex-factory.address'] },
    { id: 'ownership-handoff', kind: 'OWNER_TRANSACTIONS', depends_on: ['controller', 'authority-factory-bindings'], methods: ['TREXFactory.transferOwnership(controller.address)', 'TREXImplementationAuthority.transferOwnership(safe.address)', 'ImplementationAuthority.transferOwnership(safe.address)', 'IdFactory.transferOwnership(safe.address)'], note: 'Independently observe current owners and effective implementations after finality before product release admission.' },
    { id: 'holding-module', artifact: 'Bx1MaximumHoldingModule', constructor_args: ['reviewed product maximumHoldingBaseUnits'], note: 'Immutable cap is a source candidate, not a legal policy or approval; governance/settings readbacks must bind the exact getter result.' },
    { id: 'claim-issuer', artifact: 'ClaimIssuer', constructor_args: ['approved claim issuer management key'], note: 'Admit exact cryptographic claim key/topic policy; no fabricated claims or secrets are generated.' },
    { id: 'token-identity', artifact: 'IdentityProxy', depends_on: ['oid-authority', 'ownership-handoff'], constructor_args: ['oid-authority.address', 'approved token identity management key'] },
    { id: 'settlement', artifact: 'Bx1TestSettlementToken', constructor_args: ['reviewed initialHolder', 'reviewed initialSupplyBaseUnits'], note: 'Amoy-only immutable six-decimal valueless TST, not a fund token. No extra mint or privileged transfer exists.' },
    { id: 'product-manifest', kind: 'OWNER_ADMISSION_REQUIRED', depends_on: ['controller', 'ownership-handoff', 'holding-module', 'claim-issuer', 'token-identity', 'settlement'], note: 'Calculate six suite CREATE2 addresses using exact creation bytecode, constructor arguments, factory and salt; record actual code/owners/settings, Safe policy, appointment evidence and product/configuration hashes. Nothing in this file writes database admission.' },
    { id: 'deploy-product', kind: 'EXISTING_APP_SAFE_OPERATION', depends_on: ['product-manifest'], method: 'Bx1FundController.deployFund', note: 'Existing app binds approvals and MetaMask Safe signatures. Factory creates proxies atomically, controller hands IRS to Safe, and no investor units are minted at deployment.' },
    { id: 'recipient-identities', kind: 'IDENTITY_AND_CLAIM_TRANSACTIONS', depends_on: ['deploy-product', 'claim-issuer'], note: 'Deploy each real test recipient ONCHAINID, obtain actual authorised signature, add claim and register exact wallet/country through appointed identity authority. A sandbox KYC decision alone is not an on-chain claim.' },
    { id: 'business-journey', kind: 'EXISTING_APP_REQUIRED', depends_on: ['recipient-identities', 'settlement'], note: 'Reviewed route -> actual investor TST transfer -> dual-provider evidence -> separate Treasury/Controller balanced reconciliation -> current eligible allocation/wallet -> Safe issuance -> inner success/finality -> reconciled register/holdings. No chain, money, register or admission state is fabricated.' },
  ],
  observation_sources: ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'],
  completion_boundary: 'Compilation is not EVM execution, contract conformance/audit, deployment, provider/route admission or a proved business journey.',
}
const files = {
  'cloud-package.json': lock,
  'standard-input.json': input,
  'standard-output.json': output,
  'source-hashes.json': { sha256: sourceHashes, compiler_source_ids: sourceIds },
  'bootstrap.json': bootstrap,
  'manifest.json': { schema: 'blockxone.canonical-fund-cloud-compile.v1', status: 'COMPILED_SOURCE_NOT_DEPLOYED_NOT_ADMITTED',
    application_commit: process.env.GITHUB_SHA ?? null, chain_id: 80002, compiler: solc.version(), settings: input.settings,
    package_lock_sha256: sha256(lockBytes), packages: installed, artifacts: artifactIndex,
    warnings: (output.errors ?? []).map(item => ({ severity: item.severity, code: item.errorCode ?? null, source_location: item.sourceLocation ?? null, message: item.message })),
    deployment_addresses: {}, admission_receipt: null, tested_evm_execution: false, business_journey_proven: false },
}
for (const [name, value] of Object.entries(files)) await writeFile(join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ status: 'COMPILED_SOURCE_NOT_DEPLOYED_NOT_ADMITTED', compiler: solc.version(), artifact_count: artifactIndex.length,
  source_count: sources.size, application_commit: process.env.GITHUB_SHA ?? null, chain_id: 80002, deployment_addresses: {}, business_journey_proven: false }))
