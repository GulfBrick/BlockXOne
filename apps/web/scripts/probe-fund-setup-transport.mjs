/** Original Step 9 public-provider qualification. No writes or admission evidence. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  || process.env.GITHUB_REPOSITORY !== 'GulfBrick/BlockXOne'
  || process.env.GITHUB_REF !== 'refs/heads/codex/investor-journey-20261016'
  || process.env.GITHUB_RUN_ATTEMPT !== '1'
  || !['original-step9-readonly-v1', 'original-step9-qualification-v2'].includes(process.env.BX1_FUND_SETUP_TRANSPORT_TRACE)
  || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '')
  || process.version !== 'v22.23.1') throw new Error('Approved manual cloud execution is required.')

const transaction = '0xd1b768d76b45f32df08d1553f5311854bc82a471dac7963ce583b4be4d989c95'
const contract = '0x11b091c80b8ba5253a32c7c54ef2b1e37a45186e'
const receiptHeight = '0x301d30c'
const receiptHash = '0x4cd32c8f60510e31f20dc92514eadb1f86d53a1b8073f24468c7285b4f93ff49'
const sender = '0x27d1b26be9c04f4fd81c5cfd3975dae8b0f806fb'
const authority = '0xb1753d770545e853f0495734632e516717c25887'
const runtimeHash = '0x86d3b73ec9b8a03f0ef25c72aba7e0b65665e20c3e5ea4c67383d0c9a87e42fb'
const qualification = process.env.BX1_FUND_SETUP_TRANSPORT_TRACE === 'original-step9-qualification-v2'
const urls = [qualification ? 'https://80002.rpc.thirdweb.com' : 'https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co']
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode', 'eth_call'])
const scope = 'Read-only original Step 9 RPC transport only; not admission, payment, settlement, issuance or ownership proof.'
const web = fileURLToPath(new URL('..', import.meta.url))
const localRequire = createRequire(import.meta.url)
const ts = localRequire('typescript')
const { keccak256 } = localRequire('ethers')
const context = new AsyncLocalStorage()
const pending = new Set()
const stop = new AbortController()
let temporary, firstFailure, callNumber = 0, successfulCalls = 0

function publicError(value) {
  if (!value || typeof value !== 'object' || !value.error || typeof value.error !== 'object') return undefined
  const { code, message } = value.error
  return {
    ...(Number.isSafeInteger(code) ? { rpc_error_code: code } : {}),
    ...(typeof message === 'string' ? { rpc_error_message: message.replace(/https?:\/\/\S+/gi, '[url]').replace(/0x[0-9a-f]{64,}/gi, '[hex]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) } : {}),
  }
}

function requireFact(valid, code) { if (!valid) throw new Error(code) }
function addressWord(address) { return '0x' + address.slice(2).padStart(64, '0') }
function originalReceipt(receipt) {
  requireFact(receipt?.blockNumber === receiptHeight && receipt.blockHash === receiptHash
    && receipt.transactionHash?.toLowerCase() === transaction && receipt.contractAddress?.toLowerCase() === contract
    && receipt.status === '0x1' && receipt.transactionIndex === '0x0', 'PINNED_ORIGINAL_RECEIPT_CHANGED')
}
function originalBlock(block) {
  requireFact(block?.number === receiptHeight && block.hash === receiptHash
    && Array.isArray(block.transactions) && typeof block.transactions[0] === 'string'
    && block.transactions[0].toLowerCase() === transaction,
  'PINNED_ORIGINAL_CANONICAL_BLOCK_CHANGED')
}

try {
  temporary = await mkdtemp(join(web, '.bx1-step9-transport-'))
  await writeFile(join(temporary, 'package.json'), '{"type":"commonjs"}\n')
  for (const name of ['funding-verifier', 'funding-claim']) {
    const source = await readFile(join(web, 'src', 'lib', 'portal', `${name}.ts`), 'utf8')
    const result = ts.transpileModule(source, { fileName: `${name}.ts`, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('TRANSPILATION_FAILED')
    await writeFile(join(temporary, `${name}.js`), result.outputText)
  }
  const { createFundingRpc, readBoundedFundingJson, FUNDING_RPC_URLS, FundingVerificationError } = localRequire(join(temporary, 'funding-verifier.js'))
  if (JSON.stringify(FUNDING_RPC_URLS) !== JSON.stringify(urls)) throw new Error('FIXED_SOURCE_ENDPOINTS_CHANGED')
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), stop.signal])
  const rpc = createFundingRpc(async (url, options) => {
    const current = context.getStore()
    const response = await fetch(url, options)
    current.http_status = response.status
    // Inspect a bounded clone concurrently. The untouched response still goes
    // through the real transport's HTTP, envelope and bounded-body validation.
    current.publicError = readBoundedFundingJson(response.clone(), 1_048_576, options.signal)
      .then(publicError, () => undefined)
    return response
  }, signal)

  function call(url, phase, method, params) {
    if (!urls.includes(url) || !methods.has(method)) throw new Error('TRACE_READ_NOT_ALLOWED')
    const item = { call: ++callNumber, provider: url, phase, method }, started = performance.now()
    const task = context.run(item, async () => {
      try {
        const result = await rpc(url, method, params)
        successfulCalls++
        console.log(JSON.stringify({ ...item, publicError: undefined, elapsed_ms: Math.round(performance.now() - started), status: 'PASSED' }))
        return result
      } catch (error) {
        const record = { ...item, publicError: undefined, elapsed_ms: Math.round(performance.now() - started), status: 'FAILED',
          error_code: error instanceof FundingVerificationError ? error.code : 'UNEXPECTED_TRANSPORT_ERROR',
          ...(await item.publicError), }
        if (!firstFailure) firstFailure = record
        console.error(JSON.stringify(record))
        throw new Error('ORIGINAL_STEP9_TRANSPORT_FAILED')
      }
    })
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }

  console.log(JSON.stringify({ status: 'ORIGINAL_STEP9_TRANSPORT_START', source_commit: process.env.GITHUB_SHA, qualification,
    transaction_hash: transaction, contract_address: contract, block: receiptHeight, scope }))
  const providers = await Promise.all(urls.map(async url => {
    const [chain, finalized] = await Promise.all([
      call(url, 'chain', 'eth_chainId', []),
      call(url, 'finalized-head', 'eth_getBlockByNumber', ['finalized', false]),
    ])
    if (chain !== '0x13882' || !finalized || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(finalized.number)
      || typeof finalized.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(finalized.hash)) throw new Error('TRACE_FINALIZED_HEAD_INVALID')
    const canonical = await call(url, 'finalized-canonical', 'eth_getBlockByNumber', [finalized.number, false])
    requireFact(canonical?.number === finalized.number && canonical.hash === finalized.hash
      && BigInt(finalized.number) >= BigInt(receiptHeight), 'TRACE_FINALIZED_CANONICAL_CHANGED')
    return { url, head: finalized.number }
  }))
  const original = await Promise.all(providers.map(async provider => {
    const [receipt, tx] = await Promise.all([
      call(provider.url, 'original-receipt', 'eth_getTransactionReceipt', [transaction]),
      call(provider.url, 'original-transaction', 'eth_getTransactionByHash', [transaction]),
    ])
    originalReceipt(receipt)
    requireFact(tx?.hash?.toLowerCase() === transaction && tx.from?.toLowerCase() === sender
      && tx.nonce === '0xa' && tx.chainId === '0x13882' && tx.value === '0x0' && tx.to === null
      && tx.blockNumber === receiptHeight && tx.blockHash === receiptHash && tx.transactionIndex === '0x0',
    'PINNED_ORIGINAL_TRANSACTION_CHANGED')
    return provider
  }))
  await Promise.all(original.map(async provider => {
    const { url, head } = provider
    originalBlock(await call(url, 'receipt-canonical', 'eth_getBlockByNumber', [receiptHeight, false]))
    for (const [phase, height] of [['runtime-at-receipt', receiptHeight], ['runtime-at-finalized', head]]) {
      const code = await call(url, phase, 'eth_getCode', [contract, height])
      requireFact(typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code)
        && keccak256(code) === runtimeHash, 'PINNED_ORIGINAL_RUNTIME_CHANGED')
    }
    requireFact(await call(url, 'owner-at-receipt', 'eth_call', [{ to: contract, data: '0x8da5cb5b' }, receiptHeight])
      === addressWord(sender), 'PINNED_ORIGINAL_OWNER_CHANGED')
    requireFact(await call(url, 'implementation-authority-at-receipt', 'eth_call', [{ to: contract, data: '0x2307f882' }, receiptHeight])
      === addressWord(authority), 'PINNED_ORIGINAL_AUTHORITY_CHANGED')
  }))
  await Promise.all(original.map(provider => Promise.all([
    call(provider.url, 'recheck-canonical', 'eth_getBlockByNumber', [receiptHeight, false]).then(originalBlock),
    call(provider.url, 'recheck-receipt', 'eth_getTransactionReceipt', [transaction]).then(originalReceipt),
  ])))
  if (successfulCalls !== 24) throw new Error('TRACE_CALL_COUNT_INVALID')
  console.log(JSON.stringify({ status: 'ORIGINAL_STEP9_TRANSPORT_PASSED', qualification, successful_calls: successfulCalls, scope,
    boundary: 'Pinned endpoint facts passed, not an independent-node quorum or archive-retention/SLA guarantee. Hosted full observer acceptance is separate.' }))
} catch (error) {
  stop.abort()
  await Promise.allSettled([...pending])
  const safeCodes = new Set(['TRANSPILATION_FAILED', 'FIXED_SOURCE_ENDPOINTS_CHANGED', 'TRACE_READ_NOT_ALLOWED', 'TRACE_FINALIZED_HEAD_INVALID',
    'TRACE_FINALIZED_CANONICAL_CHANGED', 'PINNED_ORIGINAL_RECEIPT_CHANGED', 'PINNED_ORIGINAL_TRANSACTION_CHANGED',
    'PINNED_ORIGINAL_CANONICAL_BLOCK_CHANGED', 'PINNED_ORIGINAL_RUNTIME_CHANGED', 'PINNED_ORIGINAL_OWNER_CHANGED',
    'PINNED_ORIGINAL_AUTHORITY_CHANGED', 'TRACE_CALL_COUNT_INVALID'])
  console.error(JSON.stringify({ status: 'ORIGINAL_STEP9_TRANSPORT_FAILED', first_failure: firstFailure,
    error_code: safeCodes.has(error?.message) ? error.message : 'TRANSPORT_TRACE_UNAVAILABLE', successful_calls: successfulCalls, scope }))
  process.exitCode = 1
} finally {
  stop.abort()
  if (temporary) await rm(temporary, { recursive: true, force: true })
}
