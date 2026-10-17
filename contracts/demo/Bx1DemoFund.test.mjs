import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Compile-output tests only. No EVM, wallet, key, signing or transaction is used.
const artifactPath = process.env.BX1_DEMO_ARTIFACT_JSON
if (!artifactPath) throw new Error('Compiled artifact path is required')
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
const source = await readFile('contracts/demo/Bx1DemoFund.sol')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('artifact is bound to the exact source and pinned compiler', () => {
  assert.equal(artifact.schema, 'blockxone.amoy-demo-fund-compile.v1')
  assert.equal(artifact.chainId, 80002)
  assert.equal(artifact.sourcePath, 'contracts/demo/Bx1DemoFund.sol')
  assert.equal(artifact.sourceSha256, sha256(source))
  assert.match(artifact.compilerVersion, /^0\.8\.24\+commit\.e11b9ed9/)
  assert.equal(artifact.settings.evmVersion, 'paris')
  assert.equal(artifact.settings.optimizer.enabled, true)
})

test('compiler emitted nonempty creation and runtime bytecode with matching hashes', () => {
  for (const [field, digest] of [
    ['bytecode', 'bytecodeSha256'],
    ['deployedBytecode', 'deployedBytecodeSha256'],
  ]) {
    assert.match(artifact[field], /^0x(?:[0-9a-fA-F]{2})+$/)
    assert.ok(artifact[field].length > 200)
    assert.equal(artifact[digest], sha256(Buffer.from(artifact[field].slice(2), 'hex')))
  }
})

test('compiled ABI is demo-only, owner-operated, nonpayable and nontransferable', () => {
  const abi = artifact.abi
  assert.ok(Array.isArray(abi))
  for (const required of [
    'constructor()',
    'function mintWithOperation(bytes32 operationId, address wallet, uint256 units)',
    'function burnWithOperation(bytes32 operationId, address wallet, uint256 units)',
    'function owner() view returns (address)',
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function consumedOperationIds(bytes32) view returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 units)',
    'event OperationExecuted(bytes32 indexed operationId, uint8 kind, address indexed wallet, uint256 units)',
  ]) {
    assert.ok(abi.includes(required), `Missing ${required}`)
  }
  assert.ok(abi.every((fragment) => !/\bpayable\b/.test(fragment)))
  assert.ok(abi.every((fragment) => !/^(?:function (?:transfer|transferFrom|approve|redeem)\(|receive\(|fallback\()/.test(fragment)))
})
