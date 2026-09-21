import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourcePath = resolve('contracts/demo/Bx1DemoFund.sol')
const sourceName = 'contracts/demo/Bx1DemoFund.sol'
const expectedCompiler = '0.8.24+commit.e11b9ed9'

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length || process.argv[index + 1].startsWith('--')) {
    throw new Error(`Missing ${name}`)
  }
  return resolve(process.argv[index + 1])
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function typeAndName(input, indexed = false) {
  return `${input.type}${indexed && input.indexed ? ' indexed' : ''}${input.name ? ` ${input.name}` : ''}`
}

function humanReadable(fragment) {
  const inputs = (fragment.inputs ?? []).map((input) => typeAndName(input, fragment.type === 'event')).join(', ')
  if (fragment.type === 'constructor') return `constructor(${inputs})`
  if (fragment.type === 'event') return `event ${fragment.name}(${inputs})`
  if (fragment.type === 'error') return `error ${fragment.name}(${inputs})`
  if (fragment.type !== 'function') throw new Error(`Unexpected ABI fragment ${fragment.type}`)
  const mutability = fragment.stateMutability === 'view' || fragment.stateMutability === 'pure'
    ? ` ${fragment.stateMutability}`
    : ''
  const outputs = fragment.outputs?.length
    ? ` returns (${fragment.outputs.map((output) => typeAndName(output)).join(', ')})`
    : ''
  return `function ${fragment.name}(${inputs})${mutability}${outputs}`
}

function requireInterface(abi) {
  const functions = abi.filter((fragment) => fragment.type === 'function')
  const signature = (fragment) => `${fragment.name}(${fragment.inputs.map((input) => input.type).join(',')})`
  const signatures = new Set(functions.map(signature))
  for (const required of [
    'mintWithOperation(bytes32,address,uint256)',
    'burnWithOperation(bytes32,address,uint256)',
    'owner()', 'balanceOf(address)', 'totalSupply()', 'consumedOperationIds(bytes32)',
  ]) {
    if (!signatures.has(required)) throw new Error(`Compiled ABI lacks ${required}`)
  }
  for (const forbidden of ['transfer(', 'transferFrom(', 'approve(', 'redeem(']) {
    if ([...signatures].some((entry) => entry.startsWith(forbidden))) {
      throw new Error(`Demo units must be non-transferable: ${forbidden}`)
    }
  }
  if (abi.some((fragment) => ['fallback', 'receive'].includes(fragment.type)
    || fragment.stateMutability === 'payable')) {
    throw new Error('Demo fund must not receive native funds')
  }
  const constructor = abi.find((fragment) => fragment.type === 'constructor')
  if (!constructor || constructor.inputs.length !== 0) throw new Error('Expected a no-argument constructor')
  const event = abi.find((fragment) => fragment.type === 'event' && fragment.name === 'OperationExecuted')
  if (!event || event.inputs.map((input) => `${input.type}:${input.indexed}`).join(',')
    !== 'bytes32:true,uint8:false,address:true,uint256:false') {
    throw new Error('OperationExecuted event shape drifted')
  }
}

const solcEntry = process.env.BX1_SOLC_ENTRY
if (!solcEntry) throw new Error('BX1_SOLC_ENTRY must point to the installed solc 0.8.24 package')
const { default: solc } = await import(pathToFileURL(resolve(solcEntry)).href)
const compilerVersion = solc.version()
if (!compilerVersion.startsWith(expectedCompiler)) throw new Error(`Expected solc ${expectedCompiler}`)

const source = await readFile(sourcePath)
const input = {
  language: 'Solidity',
  sources: { [sourceName]: { content: source.toString('utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors ?? []).filter((item) => item.severity === 'error')
if (errors.length) throw new Error(`Solidity compilation failed: ${errors.map((item) => item.message).join('; ')}`)
const contract = output.contracts?.[sourceName]?.Bx1DemoFund
if (!contract) throw new Error('Compiled Bx1DemoFund is absent')
requireInterface(contract.abi)

const bytecode = `0x${contract.evm?.bytecode?.object ?? ''}`
const deployedBytecode = `0x${contract.evm?.deployedBytecode?.object ?? ''}`
if (!/^0x[0-9a-fA-F]+$/.test(bytecode) || !/^0x[0-9a-fA-F]+$/.test(deployedBytecode)) {
  throw new Error('Compiler returned empty or unresolved bytecode')
}
const artifact = {
  schema: 'blockxone.amoy-demo-fund-compile.v1',
  chainId: 80002,
  sourcePath: sourceName,
  sourceSha256: hash(source),
  compilerVersion,
  settings: input.settings,
  abi: contract.abi.map(humanReadable),
  bytecode,
  deployedBytecode,
  bytecodeSha256: hash(Buffer.from(bytecode.slice(2), 'hex')),
  deployedBytecodeSha256: hash(Buffer.from(deployedBytecode.slice(2), 'hex')),
}

const jsonOut = argument('--json-out')
const tsOut = argument('--ts-out')
await mkdir(resolve(jsonOut, '..'), { recursive: true })
await mkdir(resolve(tsOut, '..'), { recursive: true })
await writeFile(jsonOut, `${JSON.stringify(artifact, null, 2)}\n`)
await writeFile(tsOut, `// Generated only by contracts/demo/compile.mjs with solc ${compilerVersion}.\n`
  + `export const demoFundArtifact: {\n`
  + `  abi: readonly string[]\n  bytecode: string\n  deployedBytecode: string\n`
  + `  compilerVersion: string\n  sourceSha256: string\n} | null = ${JSON.stringify({
    abi: artifact.abi,
    bytecode,
    deployedBytecode,
    compilerVersion,
    sourceSha256: artifact.sourceSha256,
  }, null, 2)}\n`)
console.log(JSON.stringify({
  schema: artifact.schema,
  compilerVersion,
  sourceSha256: artifact.sourceSha256,
  bytecodeSha256: artifact.bytecodeSha256,
  deployedBytecodeSha256: artifact.deployedBytecodeSha256,
  abiFragments: artifact.abi.length,
}))
