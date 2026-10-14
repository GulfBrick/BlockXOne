/** Selected real-EVM proof, ONLY in the existing secret-free GitHub workflow.
 * Uses the canonical compiler output and pinned official Safe artifacts.
 * Not an audit, blanket ERC-3643 conformance, Amoy deployment or business proof.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux'
  || process.version !== 'v22.23.1' || resolve(process.cwd()) !== repository
  || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '')) {
  throw new Error('Conformance execution is restricted to the pinned GitHub Linux runtime.')
}
const runnerTemp = process.env.RUNNER_TEMP && resolve(process.env.RUNNER_TEMP)
if (!runnerTemp || !isAbsolute(process.env.RUNNER_TEMP)) throw new Error('RUNNER_TEMP is required.')
const args = new Map()
for (let n = 2; n < process.argv.length; n += 2) {
  const key = process.argv[n], value = process.argv[n + 1]
  if (!['--packages', '--artifacts', '--out'].includes(key) || !value || args.has(key)) throw new Error('Invalid proof arguments.')
  args.set(key, resolve(value))
}
const packages = args.get('--packages'), packet = args.get('--artifacts'), output = args.get('--out')
if (packages !== join(runnerTemp, 'bx1-conformance-packages') || packet !== join(runnerTemp, 'bx1-canonical-artifacts')
  || output !== join(runnerTemp, 'bx1-canonical-conformance') || existsSync(packages) || existsSync(output)
  || !existsSync(join(packet, 'manifest.json'))) throw new Error('Fresh fixed runner proof paths and the completed compiler packet are required.')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const serialized = value => `${JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)}\n`
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'))
const packageBytes = await readFile(join(repository, 'contracts/canonical/conformance-package.json'))
const lockBytes = await readFile(join(repository, 'contracts/canonical/conformance-package-lock.json'))
const packageConfig = JSON.parse(packageBytes), packageLock = JSON.parse(lockBytes)
assert.equal(packageLock.lockfileVersion, 3)
assert.deepEqual(packageLock.packages[''].dependencies, { ethers: '6.17.0', hardhat: '3.8.0' })
assert.deepEqual(packageConfig.dependencies, packageLock.packages[''].dependencies)
assert.equal(packageConfig.engines.node, '22.23.1')
assert.equal(packageLock.packages['node_modules/hardhat'].integrity, packageConfig.blockxone_proof.hardhat_integrity)
assert.equal(packageLock.packages['node_modules/ethers'].integrity, packageConfig.blockxone_proof.ethers_integrity)
for (const [path, item] of Object.entries(packageLock.packages)) {
  if (path === '') continue
  const url = new URL(item.resolved)
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity) || item.link) throw new Error('Every proof dependency must have a closed registry integrity pin.')
}
await mkdir(packages)
await mkdir(output)
await writeFile(join(output, 'bootstrap.json'), serialized({ status: 'INITIALISING_NOT_ACCEPTED', application_commit: process.env.GITHUB_SHA,
  execution_environment: 'GITHUB_IN_PROCESS_EVM_NOT_POLYGON_AMOY', proof_package_sha256: sha(packageBytes), proof_lock_sha256: sha(lockBytes),
  lifecycle_hooks_enabled: false, actual_amoy_deployment: false, audited: false }), { flag: 'wx' })
await writeFile(join(packages, 'package.json'), packageBytes, { flag: 'wx' })
await writeFile(join(packages, 'package-lock.json'), lockBytes, { flag: 'wx' })
await writeFile(join(packages, 'npmrc'), 'registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\n', { flag: 'wx' })
const install = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/',
  `--userconfig=${join(packages, 'npmrc')}`], { cwd: packages, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
  env: { PATH: process.env.PATH, HOME: packages, CI: 'true', npm_config_cache: join(packages, 'npm-cache') } })
if (install.error || install.status !== 0) throw new Error('Pinned hook-free proof dependency installation failed.')
const require = createRequire(join(packages, 'package.json'))
const hardhatMeta = await readJSON(join(packages, 'node_modules/hardhat/package.json'))
const ethersMeta = await readJSON(join(packages, 'node_modules/ethers/package.json'))
assert.equal(hardhatMeta.version, '3.8.0')
assert.equal(ethersMeta.version, '6.17.0')
for (const [path, item] of Object.entries(packageLock.packages)) {
  if (path === '') continue
  const installedPath = join(packages, path, 'package.json')
  if (!existsSync(installedPath)) { assert.equal(item.optional, true, `Missing non-optional proof dependency: ${path}`); continue }
  assert.equal((await readJSON(installedPath)).version, item.version, `Proof dependency changed: ${path}`)
}
const { BrowserProvider, Wallet, Contract, ContractFactory, Interface, AbiCoder, ZeroAddress,
  keccak256, toUtf8Bytes, getBytes, getAddress } = require('ethers')
const { createHardhatRuntimeEnvironment } = await import(pathToFileURL(require.resolve('hardhat/hre')).href)
const compilerBytes = await readFile(join(packet, 'manifest.json'))
const compiler = JSON.parse(compilerBytes)
assert.equal(compiler.application_commit, process.env.GITHUB_SHA)
assert.equal(compiler.chain_id, 80002)
assert.equal(compiler.compiler, '0.8.17+commit.8df45f5f.Emscripten.clang')
assert.equal(compiler.artifacts.length, 23)
assert.equal(compiler.settings.evmVersion, 'london')
assert.equal(compiler.settings.viaIR, false)
assert.deepEqual(compiler.settings.optimizer, { enabled: true, runs: 200 })
const artifacts = new Map()
const references = join(repository, 'apps/web/src/lib/portal/fund-setup-artifacts')
const acceptedManifest = await readJSON(join(references, 'manifest.json'))
assert.equal(sha(serialized(acceptedManifest)), '2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2')
for (const entry of compiler.artifacts) {
  assert.match(entry.name, /^[A-Za-z][A-Za-z0-9]*$/)
  assert.equal(entry.file, `artifacts/${entry.name}.json`)
  const bytes = await readFile(join(packet, entry.file)), artifact = JSON.parse(bytes)
  assert.equal(sha(bytes), entry.sha256)
  const accepted = await readJSON(join(references, `${entry.name}.json`))
  const pin = acceptedManifest.artifacts.find(item => item.name === entry.name)
  assert.ok(pin)
  assert.equal(sha(serialized(accepted)), pin.sha256)
  for (const field of ['creation', 'runtime_template', 'abi', 'immutable_references', 'immutable_bindings', 'source_hashes']) {
    assert.deepEqual(artifact[field], accepted[field], `Compiler output changed from accepted source: ${entry.name}/${field}`)
  }
  assert.equal(artifact.deployed_address, null)
  assert.equal(artifact.deployment_transaction, null)
  artifacts.set(entry.name, artifact)
}
const safeArtifacts = new Map()
for (const [name, pin] of Object.entries(packageConfig.blockxone_proof.safe_artifact_sha256)) {
  const artifact = await readJSON(join(references, `${name}-1.4.1.json`))
  assert.equal(sha(serialized(artifact)), pin, `Official Safe artifact changed: ${name}`)
  safeArtifacts.set(name, artifact)
}
assert.equal(keccak256(safeArtifacts.get('SafeL2').deployedBytecode), '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff')
assert.equal(keccak256(safeArtifacts.get('SafeProxy').deployedBytecode), '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c')
assert.equal(keccak256(safeArtifacts.get('SafeProxyFactory').deployedBytecode), '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317')

// Public, synthetic fixture keys exist only in this in-process EVM. Never read
// environment wallet keys, real user wallets, credentials, RPC URLs or a fork.
const keys = Array.from({ length: 8 }, (_, index) => new Wallet(`0x${BigInt(index + 1).toString(16).padStart(64, '0')}`))
const hre = await createHardhatRuntimeEnvironment({ networks: { proof: { type: 'edr-simulated', chainType: 'l1',
  chainId: 80002, hardfork: 'london', blockGasLimit: 30000000, allowUnlimitedContractSize: false,
  throwOnTransactionFailures: false, throwOnCallFailures: true, mining: { auto: true },
  accounts: keys.map(wallet => ({ privateKey: wallet.privateKey, balance: '1000000000000000000000000' })) } },
  paths: { artifacts: join(packages, 'unused-hardhat-artifacts'), cache: join(packages, 'unused-hardhat-cache') } }, {}, packages)
const connection = await hre.network.create('proof')
const allowed = new Set(['eth_chainId', 'eth_accounts', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionCount',
  'eth_sendTransaction', 'eth_sendRawTransaction', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
  'eth_call', 'eth_getCode', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas', 'eth_getLogs', 'eth_getBalance'])
const provider = new BrowserProvider({ request: request => {
  if (!allowed.has(request.method)) throw new Error(`Unexpected proof RPC method: ${request.method}`)
  return connection.provider.request(request)
} }, { name: 'in-process-proof-not-amoy', chainId: 80002 }, { cacheTimeout: 0, pollingInterval: 50 })
assert.equal((await provider.getNetwork()).chainId, 80002n)
const signers = await Promise.all(keys.map(wallet => provider.getSigner(wallet.address)))
const [deployer, , , identityAgent, claimManager, investorA, investorB, unverified] = signers
const fixture = { deployer: keys[0].address, owners: [keys[1].address, keys[2].address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  identityAgent: keys[3].address, claimManager: keys[4].address, investorA: keys[5].address, investorB: keys[6].address,
  unverified: keys[7].address, threshold: 2, claim_topic: '1', country: 710, security_decimals: 0, maximum_holding: '150',
  supply_limit: '1000', operation_limit: '100', settlement_decimals: 6, settlement_payment_base_units: '1000000000' }
const evidence = { schema: 'blockxone.canonical-selected-evm-proof.v1', status: 'RUNNING', application_commit: process.env.GITHUB_SHA,
  execution_environment: 'GITHUB_IN_PROCESS_EVM_NOT_POLYGON_AMOY', chain_id: 80002, node: process.version,
  hardhat: hardhatMeta.version, ethers: ethersMeta.version, edr: (await readJSON(join(packages, 'node_modules/@nomicfoundation/edr/package.json'))).version,
  proof_package_sha256: sha(packageBytes), proof_lock_sha256: sha(lockBytes), compiler_manifest_sha256: sha(compilerBytes),
  accepted_catalog_sha256: sha(serialized(acceptedManifest)), accepted_compiler_commit: acceptedManifest.application_commit,
  compiler_package_lock_sha256: compiler.package_lock_sha256, safe_source: packageConfig.blockxone_proof.safe_source,
  safe_artifact_sha256: packageConfig.blockxone_proof.safe_artifact_sha256, fixture, cases: [], deployments: [], operations: [], callbacks: [],
  coverage_boundary: { complete_erc3643_conformance: false, independent_security_audit: false, legal_or_provider_acceptance: false,
    actual_amoy_deployment: false, hosted_business_journey: false, production_admission: false, claim_expiry_enforced: false,
    all_outbound_transfers_from_revoked_identity_blocked: false,
    burn_is_app_routine: false, burn_fixture: 'SEPARATE_SAFE_OWNER_GOVERNANCE_APPOINTMENT_REMOVED_AFTER_PROOF',
    independent_human_approval: false, signer_keys: 'TWO_DISTINCT_SYNTHETIC_KEYS_NOT_TWO_PROVEN_HUMANS' } }
let activeCase = 'bootstrap'
const address = contract => getAddress(contract.target)
const hash = text => keccak256(toUtf8Bytes(text))
const abi = AbiCoder.defaultAbiCoder()
async function scenario(name, action) { activeCase = name; await action(); evidence.cases.push({ name, result: 'PASSED' }) }
function expectedRuntime(artifact, values = {}) {
  const code = Buffer.from(artifact.runtime_template.code.slice(2), 'hex')
  const bindings = Object.values(artifact.immutable_bindings)
  assert.equal(Object.keys(values).length, bindings.length)
  for (const binding of bindings) {
    assert.ok(Object.hasOwn(values, binding.name), `Missing immutable ${binding.name}`)
    const word = BigInt(values[binding.name]).toString(16).padStart(64, '0')
    assert.equal(word.length, 64)
    for (const offset of binding.references) { assert.equal(offset.length, 32); Buffer.from(word, 'hex').copy(code, offset.start) }
  }
  return `0x${code.toString('hex')}`
}
async function deploy(name, constructor = [], values = {}, signer = deployer) {
  const artifact = artifacts.get(name)
  const factory = new ContractFactory(artifact.abi, artifact.creation.code, signer)
  const contract = await factory.deploy(...constructor, { gasLimit: 15000000 })
  const receipt = await contract.deploymentTransaction().wait()
  assert.equal(receipt.status, 1)
  const code = await provider.getCode(address(contract))
  assert.equal(code.toLowerCase(), expectedRuntime(artifact, values).toLowerCase(), `${name} runtime/immutable mismatch`)
  evidence.deployments.push({ name, address: address(contract), transaction_hash: receipt.hash, runtime_hash: keccak256(code),
    creation_hash: artifact.creation.keccak256, block_number: receipt.blockNumber })
  return contract
}
async function direct(transaction) { const receipt = await (await transaction).wait(); assert.equal(receipt.status, 1); return receipt }
async function rejectedCall(action, expectedReason) {
  let rejected = false
  try { await action() } catch (error) {
    assert.equal(error.code, 'CALL_EXCEPTION', 'An RPC/transport failure is not a contract-negative proof')
    if (expectedReason) assert.ok(String(error.reason ?? error.message).includes(expectedReason), `Unexpected revert: ${error.reason}`)
    rejected = true
  }
  assert.equal(rejected, true, 'Expected actual EVM revert')
}
let safe, controller, token, registry, compliance, module, claimIssuer, factory, settlement
const safeTypes = { SafeTx: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' }] }
async function prepareSafe(to, data, nonce = null) {
  const tx = { to, value: 0n, data, operation: 0, safeTxGas: 12000000n, baseGas: 0n, gasPrice: 0n,
    gasToken: ZeroAddress, refundReceiver: ZeroAddress, nonce: nonce ?? await safe.nonce() }
  const owners = [keys[1], keys[2]].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
  const signatures = await Promise.all(owners.map(owner => owner.signTypedData({ chainId: 80002, verifyingContract: address(safe) }, safeTypes, tx)))
  return { tx, signatures: `0x${signatures.map(signature => signature.slice(2)).join('')}`, first_signature: signatures[0] }
}
async function executeSafe(prepared, expectedSuccess = true) {
  const { tx, signatures } = prepared
  assert.equal(await safe.nonce(), tx.nonce)
  const receipt = await direct(safe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice,
    tx.gasToken, tx.refundReceiver, signatures, { gasLimit: 20000000 }))
  const events = receipt.logs.filter(log => log.address.toLowerCase() === address(safe).toLowerCase())
    .map(log => { try { return safe.interface.parseLog(log) } catch { return null } }).filter(Boolean)
  const success = events.filter(event => event.name === 'ExecutionSuccess'), failure = events.filter(event => event.name === 'ExecutionFailure')
  assert.equal(success.length, expectedSuccess ? 1 : 0)
  assert.equal(failure.length, expectedSuccess ? 0 : 1)
  assert.equal(await safe.nonce(), tx.nonce + 1n)
  evidence.operations.push({ case: activeCase, transaction_hash: receipt.hash, outer_status: receipt.status,
    inner_execution_success: expectedSuccess, safe_nonce: tx.nonce.toString(), target: tx.to, data_hash: keccak256(tx.data),
    block_number: receipt.blockNumber, block_hash: receipt.blockHash })
  return receipt
}
async function governed(contract, method, values = [], expectedSuccess = true) {
  return executeSafe(await prepareSafe(address(contract), contract.interface.encodeFunctionData(method, values)), expectedSuccess)
}
async function callback(receipt, method) {
  const trace = await connection.provider.request({ method: 'debug_traceTransaction', params: [receipt.hash,
    { disableStorage: true, disableStack: false, disableMemory: false }] })
  assert.ok(Array.isArray(trace.structLogs) && trace.structLogs.length > 0 && trace.structLogs.length <= 50000)
  const selector = module.interface.getFunction(method).selector.toLowerCase(), observed = []
  const word = value => String(value).replace(/^0x/, '')
  for (const frame of trace.structLogs) {
    if (!['CALL', 'STATICCALL'].includes(frame.op) || !Array.isArray(frame.stack) || !Array.isArray(frame.memory)) continue
    const stack = frame.stack, n = stack.length
    if (`0x${word(stack[n - 2]).slice(-40)}`.toLowerCase() !== address(module).toLowerCase()) continue
    const offset = Number(BigInt(`0x${word(stack[n - (frame.op === 'CALL' ? 4 : 3)])}`))
    assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset < 16777216)
    const memory = frame.memory.map(word).join('')
    if (`0x${memory.slice(offset * 2, offset * 2 + 8)}`.toLowerCase() === selector) observed.push({ depth: frame.depth, selector })
  }
  assert.ok(observed.length > 0, `Actual ${method} callback was not observed`)
  evidence.callbacks.push({ transaction_hash: receipt.hash, target: address(module), method, calls: observed })
}
const productBinding = hash('BX1_EXPLICIT_SYNTHETIC_FUND_CLASS_TERMS'), operationBinding = label => hash(`BX1_SYNTHETIC_OPERATION:${label}`)
async function issuance(label, recipient, units, options = {}) {
  const expires = BigInt((await provider.getBlock('latest')).timestamp) + 3600n
  return [hash(label), operationBinding(label), productBinding, options.epoch ?? await controller.authorityEpoch(), options.expires ?? expires,
    address(token), recipient, units, options.supply ?? await token.totalSupply(), options.balance ?? await token.balanceOf(recipient)]
}
try {
  await scenario('Official Safe factory atomically creates a two-key threshold account', async () => {
    const l2 = safeArtifacts.get('SafeL2'), proxyFactory = safeArtifacts.get('SafeProxyFactory')
    const singleton = await new ContractFactory(l2.abi, l2.bytecode, deployer).deploy({ gasLimit: 15000000 })
    await singleton.waitForDeployment()
    const safeFactory = await new ContractFactory(proxyFactory.abi, proxyFactory.bytecode, deployer).deploy({ gasLimit: 15000000 })
    await safeFactory.waitForDeployment()
    assert.equal(keccak256(await provider.getCode(address(singleton))), keccak256(l2.deployedBytecode))
    assert.equal(keccak256(await provider.getCode(address(safeFactory))), keccak256(proxyFactory.deployedBytecode))
    const initializer = new Interface(l2.abi).encodeFunctionData('setup', [fixture.owners, 2, ZeroAddress, '0x', ZeroAddress, ZeroAddress, 0, ZeroAddress])
    const receipt = await direct(safeFactory.createProxyWithNonce(address(singleton), initializer, 141n))
    const creations = receipt.logs.map(log => { try { return safeFactory.interface.parseLog(log) } catch { return null } })
      .filter(event => event?.name === 'ProxyCreation')
    assert.equal(creations.length, 1)
    safe = new Contract(creations[0].args.proxy, l2.abi, deployer)
    assert.equal(keccak256(await provider.getCode(address(safe))), keccak256(safeArtifacts.get('SafeProxy').deployedBytecode))
    assert.deepEqual((await safe.getOwners()).map(owner => owner.toLowerCase()).sort(), fixture.owners.map(owner => owner.toLowerCase()).sort())
    assert.equal(await safe.getThreshold(), 2n)
    assert.equal(await safe.VERSION(), '1.4.1')
    const modules = await safe.getModulesPaginated('0x0000000000000000000000000000000000000001', 20)
    assert.equal(modules[0].length, 0)
    evidence.safe = { address: address(safe), singleton: address(singleton), factory: address(safeFactory), threshold: 2,
      owners: fixture.owners, creation_transaction_hash: receipt.hash, initializer_hash: keccak256(initializer), atomic_initialisation: true }
  })
  await scenario('The accepted canonical implementations and factory/controller are deployed with exact runtime bindings', async () => {
    const implementations = {}
    for (const name of ['Token', 'ClaimTopicsRegistry', 'IdentityRegistryStorage', 'IdentityRegistry', 'TrustedIssuersRegistry', 'ModularCompliance']) implementations[name] = await deploy(name)
    const oid = await deploy('Identity', [fixture.deployer, true])
    const oidAuthority = await deploy('ImplementationAuthority', [address(oid)])
    const oidFactory = await deploy('IdFactory', [address(oidAuthority)], { _implementationAuthority: address(oidAuthority) })
    const trexAuthority = await deploy('TREXImplementationAuthority', [true, ZeroAddress, ZeroAddress])
    await direct(trexAuthority.addAndUseTREXVersion({ major: 4, minor: 1, patch: 3 }, {
      tokenImplementation: address(implementations.Token), ctrImplementation: address(implementations.ClaimTopicsRegistry),
      irImplementation: address(implementations.IdentityRegistry), irsImplementation: address(implementations.IdentityRegistryStorage),
      tirImplementation: address(implementations.TrustedIssuersRegistry), mcImplementation: address(implementations.ModularCompliance) }))
    factory = await deploy('TREXFactory', [address(trexAuthority), address(oidFactory)])
    const iaFactory = await deploy('IAFactory', [address(factory)])
    await direct(trexAuthority.setTREXFactory(address(factory)))
    await direct(trexAuthority.setIAFactory(address(iaFactory)))
    await direct(oidFactory.addTokenFactory(address(factory)))
    controller = await deploy('Bx1FundController', [address(safe), address(factory)], { institutionalAuthority: address(safe), factory: address(factory) })
    await direct(factory.transferOwnership(address(controller)))
    await direct(trexAuthority.transferOwnership(address(safe)))
    await direct(oidAuthority.transferOwnership(address(safe)))
    await direct(oidFactory.transferOwnership(address(safe)))
    module = await deploy('Bx1MaximumHoldingModule', [150n], { maximumHolding: '150' })
    claimIssuer = await deploy('ClaimIssuer', [fixture.claimManager], {}, claimManager)
    const tokenIdentity = await deploy('IdentityProxy', [address(oidAuthority), fixture.deployer])
    settlement = await deploy('Bx1TestSettlementToken', [fixture.investorA, 1000000000000n])
    evidence.infrastructure = { identity_authority: address(oidAuthority), token_identity: address(tokenIdentity),
      controller: address(controller), factory: address(factory), claim_issuer: address(claimIssuer), module: address(module), settlement: address(settlement) }
  })
  await scenario('A single Safe signature cannot execute a privileged transaction', async () => {
    const prepared = await prepareSafe(address(controller), controller.interface.encodeFunctionData('setOperationalPause', [true, hash('invalid-quorum')]))
    const tx = prepared.tx
    await rejectedCall(() => safe.execTransaction.staticCall(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice,
      tx.gasToken, tx.refundReceiver, prepared.first_signature), 'GS020')
    assert.equal(await safe.nonce(), tx.nonce)
    assert.equal(await controller.paused(), false)
  })
  await scenario('Two actual Safe signatures deploy the canonical isolated fund and prove successful inner execution', async () => {
    const expires = BigInt((await provider.getBlock('latest')).timestamp) + 3600n
    await governed(controller, 'deployFund', [hash('fund-deployment'), operationBinding('fund-deployment'), productBinding, 1n, expires,
      'bx1-selected-proof-fund', { owner: address(safe), name: 'BX1 Synthetic Fund', symbol: 'BX1F', decimals: 0, irs: ZeroAddress,
        ONCHAINID: evidence.infrastructure.token_identity, irAgents: [fixture.identityAgent], tokenAgents: [address(controller)],
        complianceModules: [address(module)], complianceSettings: [] }, { claimTopics: [1n], issuers: [address(claimIssuer)], issuerClaims: [[1n]] }, 1000n, 100n])
    token = new Contract(await factory.getToken('bx1-selected-proof-fund'), artifacts.get('Token').abi, deployer)
    registry = new Contract(await token.identityRegistry(), artifacts.get('IdentityRegistry').abi, identityAgent)
    compliance = new Contract(await token.compliance(), artifacts.get('ModularCompliance').abi, deployer)
    assert.equal(await token.owner(), address(safe))
    assert.equal(await registry.owner(), address(safe))
    const storage = new Contract(await registry.identityStorage(), artifacts.get('IdentityRegistryStorage').abi, deployer)
    assert.equal(await storage.owner(), address(safe))
    assert.equal(await token.totalSupply(), 0n)
    assert.equal(await token.decimals(), 0n)
    assert.equal(await token.paused(), false)
    assert.equal(await token.isAgent(address(controller)), true)
    assert.equal(await token.isAgent(fixture.deployer), false)
    assert.equal(await compliance.isModuleBound(address(module)), true)
    assert.equal(await module.maximumHolding(), 150n)
    for (const [name, target] of [['TokenProxy', address(token)], ['IdentityRegistryProxy', address(registry)],
      ['IdentityRegistryStorageProxy', address(storage)], ['ModularComplianceProxy', address(compliance)],
      ['TrustedIssuersRegistryProxy', await registry.issuersRegistry()], ['ClaimTopicsRegistryProxy', await registry.topicsRegistry()]]) {
      assert.equal((await provider.getCode(target)).toLowerCase(), artifacts.get(name).runtime_template.code.toLowerCase())
      const owned = new Contract(target, ['function owner() view returns(address)'], deployer)
      assert.equal(await owned.owner(), address(safe))
      evidence.deployments.push({ name, address: target, runtime_hash: keccak256(await provider.getCode(target)), created_by: 'CANONICAL_FACTORY_SAFE_CONTROLLER_OPERATION' })
    }
    evidence.fund = { token: address(token), identity_registry: address(registry), compliance: address(compliance), binding_hash: productBinding }
  })
  const identities = new Map(), claims = new Map()
  await scenario('Actual signed ONCHAINID claims admit only the correctly bound recipient identities', async () => {
    for (const [wallet, signer] of [[fixture.investorA, investorA], [fixture.investorB, investorB], [fixture.unverified, unverified]]) {
      const identity = await deploy('IdentityProxy', [evidence.infrastructure.identity_authority, wallet], {}, signer)
      const instance = new Contract(address(identity), artifacts.get('Identity').abi, signer)
      identities.set(wallet, instance)
      await direct(registry.registerIdentity(wallet, address(instance), 710))
      assert.equal(await registry.isVerified(wallet), false)
      if (wallet === fixture.unverified) continue
      const data = abi.encode(['string', 'address'], ['BX1_SYNTHETIC_KYC_NOT_PROVIDER_OR_LEGAL_ACCEPTANCE', wallet])
      const digest = keccak256(abi.encode(['address', 'uint256', 'bytes'], [address(instance), 1n, data]))
      const signature = await keys[4].signMessage(getBytes(digest))
      assert.equal(await claimIssuer.isClaimValid(address(instance), 1n, signature, data), true)
      const wrong = await keys[0].signMessage(getBytes(digest))
      assert.equal(await claimIssuer.isClaimValid(address(instance), 1n, wrong, data), false)
      await direct(instance.addClaim(1n, 1n, address(claimIssuer), signature, data, ''))
      claims.set(wallet, { signature, data })
      assert.equal(await registry.isVerified(wallet), true)
    }
  })
  await scenario('Unverified mint and transfer are rejected without balance or supply effects', async () => {
    await governed(controller, 'issueFund', await issuance('unverified-mint', fixture.unverified, 1n), false)
    assert.equal(await token.totalSupply(), 0n)
    assert.equal(await token.balanceOf(fixture.unverified), 0n)
    await governed(controller, 'issueFund', await issuance('eligible-first-mint', fixture.investorA, 100n))
    await rejectedCall(() => token.connect(investorA).transfer.staticCall(fixture.unverified, 1n), 'Transfer not possible')
    assert.equal(await token.balanceOf(fixture.investorA), 100n)
    assert.equal(await token.balanceOf(fixture.unverified), 0n)
  })
  await scenario('Eligible mint/transfer, mint callback, self-transfer and exact holding-limit boundaries execute', async () => {
    await direct(token.connect(investorA).transfer(fixture.investorB, 20n))
    const receipt = await governed(controller, 'issueFund', await issuance('eligible-cap-boundary', fixture.investorA, 70n))
    await callback(receipt, 'moduleMintAction')
    assert.equal(await token.totalSupply(), 170n)
    assert.equal(await token.balanceOf(fixture.investorA), 150n)
    assert.equal(await token.balanceOf(fixture.investorB), 20n)
    await governed(controller, 'issueFund', await issuance('above-holding-cap', fixture.investorA, 1n), false)
    await rejectedCall(() => token.connect(investorB).transfer.staticCall(fixture.investorA, 1n), 'Transfer not possible')
    await direct(token.connect(investorA).transfer(fixture.investorA, 150n))
    assert.equal(await token.balanceOf(fixture.investorA), 150n)
    assert.equal(await token.totalSupply(), 170n)
  })
  await scenario('Ordinary EOAs cannot bypass the institutional controller or token agent boundary', async () => {
    await rejectedCall(async () => controller.issueFund.staticCall(...await issuance('eoa-bypass', fixture.investorB, 1n)), 'institutional authority only')
    await rejectedCall(() => token.mint.staticCall(fixture.investorB, 1n))
    await rejectedCall(() => module.moduleMintAction.staticCall(fixture.investorA, 1n))
    assert.equal(await token.totalSupply(), 170n)
  })
  await scenario('Separate Safe-governance burn/forced-transfer fixtures invoke real hooks, rollback over-cap effects and remove temporary authority', async () => {
    await governed(token, 'addAgent', [address(safe)])
    const burn = await governed(token, 'burn', [fixture.investorA, 10n])
    await callback(burn, 'moduleBurnAction')
    assert.equal(await token.balanceOf(fixture.investorA), 140n)
    assert.equal(await token.totalSupply(), 160n)
    const failed = await governed(token, 'forcedTransfer', [fixture.investorB, fixture.investorA, 11n], false)
    await callback(failed, 'moduleTransferAction')
    assert.equal(await token.balanceOf(fixture.investorA), 140n)
    assert.equal(await token.balanceOf(fixture.investorB), 20n)
    assert.equal(await token.totalSupply(), 160n)
    await governed(token, 'removeAgent', [address(safe)])
    assert.equal(await token.isAgent(address(safe)), false)
    assert.equal(await token.isAgent(address(controller)), true)
  })
  await scenario('Cryptographic claim revocation prevents new receipt/mint; a fresh authorised signed claim restores it', async () => {
    await direct(claimIssuer.revokeClaimBySignature(claims.get(fixture.investorB).signature))
    assert.equal(await registry.isVerified(fixture.investorB), false)
    await rejectedCall(() => token.connect(investorA).transfer.staticCall(fixture.investorB, 1n), 'Transfer not possible')
    await governed(controller, 'issueFund', await issuance('revoked-recipient', fixture.investorB, 1n), false)
    assert.equal(await token.balanceOf(fixture.investorB), 20n)
    const identity = identities.get(fixture.investorB), data = abi.encode(['string'], ['BX1_SYNTHETIC_REVERIFIED_CLAIM_V2'])
    const signature = await keys[4].signMessage(getBytes(keccak256(abi.encode(['address', 'uint256', 'bytes'], [address(identity), 1n, data]))))
    await direct(identity.addClaim(1n, 1n, address(claimIssuer), signature, data, ''))
    assert.equal(await registry.isVerified(fixture.investorB), true)
  })
  await scenario('Previously signed Safe issuance cannot execute after final on-chain operation revocation', async () => {
    const values = await issuance('signed-then-revoked', fixture.investorB, 1n), nonce = await safe.nonce()
    const signed = await prepareSafe(address(controller), controller.interface.encodeFunctionData('issueFund', values), nonce + 1n)
    await governed(controller, 'revokeOperation', [values[0], hash('SCOPED_SYNTHETIC_REVOCATION')])
    await executeSafe(signed, false)
    assert.equal(await controller.revokedOperations(values[0]), true)
    assert.equal(await controller.executedOperations(values[0]), false)
    assert.equal(await token.totalSupply(), 160n)
  })
  await scenario('Authority epoch changes fence pre-signed operations; stale snapshots, expiry, operation limit and duplicate execution are rejected', async () => {
    const values = await issuance('signed-old-epoch', fixture.investorB, 1n), nonce = await safe.nonce()
    const signed = await prepareSafe(address(controller), controller.interface.encodeFunctionData('issueFund', values), nonce + 1n)
    await governed(controller, 'advanceAuthorityEpoch', [2n, hash('SCOPED_SYNTHETIC_EPOCH_CHANGE')])
    await executeSafe(signed, false)
    await governed(controller, 'issueFund', await issuance('stale-supply', fixture.investorB, 1n, { supply: 159n }), false)
    await governed(controller, 'issueFund', await issuance('expired', fixture.investorB, 1n, { expires: 1n }), false)
    // Only the per-operation limit is exceeded: 20 + 101 stays below the
    // recipient cap of 150, and 160 + 101 stays below the supply cap of 1000.
    assert.equal(await token.balanceOf(fixture.investorB), 20n)
    assert.equal(await token.totalSupply(), 160n)
    assert.equal(await controller.maximumOperationUnits(address(token)), 100n)
    await governed(controller, 'issueFund', await issuance('operation-limit', fixture.investorB, 101n), false)
    const current = await issuance('new-epoch-valid', fixture.investorB, 1n)
    await governed(controller, 'issueFund', current)
    assert.equal(await token.totalSupply(), 161n)
    assert.equal(await controller.executedOperations(current[0]), true)
    // Refresh supply/balance/expiry while retaining the exact business operation
    // identifier, isolating duplicate-ID rejection from stale snapshot checks.
    const duplicate = await issuance('new-epoch-valid', fixture.investorB, 1n)
    assert.equal(duplicate[0], current[0])
    assert.equal(duplicate[8], 161n)
    assert.equal(duplicate[9], 21n)
    await governed(controller, 'issueFund', duplicate, false)
    assert.equal(await controller.executedOperations(current[0]), true)
    assert.equal(await token.totalSupply(), 161n)
    assert.equal(await token.balanceOf(fixture.investorB), 21n)
  })
  await scenario('Actual six-decimal TST transfer has exact amounts and does not create fund units', async () => {
    assert.equal(await settlement.decimals(), 6n)
    const prior = await settlement.balanceOf(fixture.investorA), supply = await token.totalSupply()
    await direct(settlement.connect(investorA).transfer(address(safe), 1000000000n))
    assert.equal(await settlement.balanceOf(address(safe)), 1000000000n)
    assert.equal(await settlement.balanceOf(fixture.investorA), prior - 1000000000n)
    assert.equal(await token.totalSupply(), supply)
  })
  evidence.status = 'PASSED_SELECTED_CANONICAL_EVM_BEHAVIOURS'
  evidence.final_state = { supply: (await token.totalSupply()).toString(), investor_a_balance: (await token.balanceOf(fixture.investorA)).toString(),
    investor_b_balance: (await token.balanceOf(fixture.investorB)).toString(), unverified_balance: (await token.balanceOf(fixture.unverified)).toString(),
    authority_epoch: (await controller.authorityEpoch()).toString(), safe_nonce: (await safe.nonce()).toString(), safe_is_token_agent: await token.isAgent(address(safe)) }
  await writeFile(join(output, 'selected-conformance.json'), serialized(evidence), { flag: 'wx' })
  await writeFile(join(output, 'manifest.json'), serialized({ schema: 'blockxone.canonical-selected-conformance-manifest.v1', status: evidence.status,
    application_commit: process.env.GITHUB_SHA, files: { 'selected-conformance.json': sha(serialized(evidence)),
      'conformance-package.json': sha(packageBytes), 'conformance-package-lock.json': sha(lockBytes) },
    compiler_manifest_sha256: sha(compilerBytes), case_count: evidence.cases.length, acceptance_boundary: evidence.coverage_boundary }), { flag: 'wx' })
  await writeFile(join(output, 'conformance-package.json'), packageBytes, { flag: 'wx' })
  await writeFile(join(output, 'conformance-package-lock.json'), lockBytes, { flag: 'wx' })
  console.log(JSON.stringify({ status: evidence.status, cases: evidence.cases.length, actual_evm: true, real_amoy: false, audited: false, hosted_business_journey: false }))
} catch (error) {
  evidence.status = 'FAILED_SELECTED_CANONICAL_EVM_BEHAVIOURS'
  evidence.failed_case = activeCase
  evidence.error = String(error.shortMessage ?? error.message ?? error).slice(0, 1000)
  await writeFile(join(output, 'failed-conformance.json'), serialized(evidence), { flag: 'wx' })
  throw new Error(`Selected canonical EVM proof failed at ${activeCase}: ${evidence.error}`)
} finally {
  provider.destroy()
  await connection.close()
}
