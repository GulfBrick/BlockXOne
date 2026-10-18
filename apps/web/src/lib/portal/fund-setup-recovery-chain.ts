import 'server-only'
import { Interface, keccak256 } from 'ethers'
import { canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, getCanonicalFundArtifact } from './fund-setup-artifacts'
import { fundSetupHash, observeSetupStep, type FundSetupIntent, type FundSetupObservers } from './fund-setup-chain'
import { fundSetupIntentSchema } from './fund-setup-contracts'
import type { FundSetupRecoveryProof } from './fund-setup-recovery-contracts'
import { createFundServerRpc } from './fund-rpc-server'
import { FUNDING_RPC_URLS } from './funding-verifier'

export type { FundSetupRecoveryProof } from './fund-setup-recovery-contracts'
export type FundSetupRecoveryAnchor = FundSetupRecoveryProof['anchor']
export type FundSetupRecoveryOptions = FundSetupObservers & { signal?: AbortSignal; now?: () => number }
type Rpc = NonNullable<FundSetupObservers['rpc']>
type Row = Record<string, unknown>
const ZERO = `0x${'0'.repeat(40)}`
const MAX_UINT = (1n << 256n) - 1n
const abi = new Interface(getCanonicalFundArtifact('TREXImplementationAuthority').abi)
const version = [4, 1, 3]
const implementations = ['Token', 'ClaimTopicsRegistry', 'IdentityRegistry', 'IdentityRegistryStorage', 'TrustedIssuersRegistry', 'ModularCompliance'] as const
const getters = ['getTokenImplementation', 'getCTRImplementation', 'getIRImplementation', 'getIRSImplementation', 'getTIRImplementation', 'getMCImplementation'] as const
const hex = (value: bigint) => `0x${value.toString(16)}`

/** Fixed, redacted failures are not evidence of nonce consumption or a retry grant. */
export class FundSetupRecoveryChainError extends Error {
  constructor(public readonly code: string, public readonly status = 503) {
    super('The original setup recovery could not be independently verified. Keep its original nonce and transaction history.')
  }
}
function fail(code: string): never { throw new FundSetupRecoveryChainError(code) }
function row(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('RECOVERY_RECORD_INVALID'); return value as Row }
function address(value: unknown): string { if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value) || value.toLowerCase() === ZERO) return fail('RECOVERY_ADDRESS_INVALID'); return value.toLowerCase() }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0{64}$/i.test(value)) return fail('RECOVERY_HASH_INVALID'); return value.toLowerCase() }
function decimal(value: unknown): bigint { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX_UINT) return fail('RECOVERY_QUANTITY_INVALID'); return BigInt(value) }
function quantity(value: unknown): bigint { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)) return fail('RECOVERY_QUANTITY_INVALID'); return BigInt(value) }
function header(value: unknown, expected?: bigint) {
  const data = row(value), number = quantity(data.number), timestamp = quantity(data.timestamp)
  if (expected !== undefined && number !== expected || timestamp > 8640000000000n) return fail('RECOVERY_BLOCK_INVALID')
  return { number, hash: hash(data.hash), timestamp: timestamp.toString() }
}
function comparable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item)]))
  return value
}
function same<T>(values: T[]): T { if (values.length !== 2 || fundSetupHash(comparable(values[0])) !== fundSetupHash(comparable(values[1]))) return fail('RECOVERY_OBSERVERS_DISAGREE'); return values[0] }

function checkedIntent(value: FundSetupIntent) {
  const parsed = fundSetupIntentSchema.safeParse(value)
  if (!parsed.success) return fail('RECOVERY_INTENT_INVALID')
  const intent = parsed.data
  if (intent.step_key !== 'trex_version' || intent.kind !== 'CALL' || intent.artifact_name !== 'TREXImplementationAuthority'
    || intent.chain_id !== 80002 || intent.catalog_hash !== FUND_SETUP_CATALOG_HASH || decimal(intent.nonce) >= 2n ** 64n || intent.to !== intent.expected_address
    || address(intent.sender) !== intent.sender || address(intent.to) !== intent.to
    || intent.expected_runtime_hash !== keccak256(canonicalFundRuntime('TREXImplementationAuthority'))) return fail('RECOVERY_INTENT_INVALID')
  let decoded
  try { decoded = abi.decodeFunctionData('addAndUseTREXVersion', intent.data) } catch { return fail('RECOVERY_INTENT_INVALID') }
  const released = [...decoded[0]].map(Number), dependencies = [...decoded[1]].map(address)
  if (JSON.stringify(released) !== JSON.stringify(version) || dependencies.length !== implementations.length
    || abi.encodeFunctionData('addAndUseTREXVersion', [version, dependencies]).toLowerCase() !== intent.data) return fail('RECOVERY_INTENT_INVALID')
  const checks = [{ address: intent.to, data: abi.encodeFunctionData('getCurrentVersion', []).toLowerCase(), result: abi.encodeFunctionResult('getCurrentVersion', [version]).toLowerCase() },
    ...getters.map((method, i) => ({ address: intent.to, data: abi.encodeFunctionData(method, []).toLowerCase(), result: abi.encodeFunctionResult(method, [dependencies[i]]).toLowerCase() }))]
  if (fundSetupHash(checks) !== fundSetupHash(intent.checks)) return fail('RECOVERY_INTENT_INVALID')
  return { intent, dependencies }
}

/** Read-only, bounded recovery of the same saved bootstrap call. Never signs or sends. */
export async function checkFundSetupRecovery(value: FundSetupIntent, anchor: FundSetupRecoveryAnchor,
  options: FundSetupRecoveryOptions = {}): Promise<FundSetupRecoveryProof> {
  const { intent, dependencies } = checkedIntent(value), nonce = decimal(intent.nonce), lowerNumber = decimal(anchor.block_number)
  const lowerHash = hash(anchor.block_hash), clock = options.now ?? Date.now, started = clock()
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90_000)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  let calls = 0
  try {
    const fallback = options.rpc || options.primary && options.secondary ? undefined : createFundServerRpc(fetch, signal)
    const raw = [options.primary ?? options.rpc ?? fallback!, options.secondary ?? options.rpc ?? fallback!]
    const read: Rpc = async (url, method, params) => {
      const index = FUNDING_RPC_URLS.indexOf(url as typeof FUNDING_RPC_URLS[number])
      if (index < 0 || !['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode', 'eth_call', 'eth_getStorageAt'].includes(method)) return fail('RECOVERY_RPC_NOT_ALLOWED')
      if (signal.aborted || clock() - started >= 90_000) return fail('RECOVERY_DEADLINE_EXCEEDED')
      if (++calls > 128) return fail('RECOVERY_CALL_BUDGET_EXCEEDED')
      let stop: (() => void) | undefined
      try {
        return await Promise.race([raw[index](url, method, params), new Promise<never>((_, reject) => {
          stop = () => reject(new FundSetupRecoveryChainError('RECOVERY_DEADLINE_EXCEEDED'))
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted) stop()
        })])
      } catch (error) {
        if (error instanceof FundSetupRecoveryChainError) throw error
        throw new FundSetupRecoveryChainError('RECOVERY_OBSERVATION_UNAVAILABLE')
      } finally { if (stop) signal.removeEventListener('abort', stop) }
    }
    const pair = <T>(task: (url: string, index: number) => Promise<T>) => Promise.all(FUNDING_RPC_URLS.map(task))
    const heads = await pair(async url => {
      if (quantity(await read(url, 'eth_chainId', [])) !== 80002n) return fail('RECOVERY_WRONG_CHAIN')
      return header(await read(url, 'eth_getBlockByNumber', ['finalized', false]))
    })
    const commonNumber = heads[0].number < heads[1].number ? heads[0].number : heads[1].number
    const common = same(await pair(async url => header(await read(url, 'eth_getBlockByNumber', [hex(commonNumber), false]), commonNumber)))
    const nonces = await pair(async url => ({ latest: quantity(await read(url, 'eth_getTransactionCount', [intent.sender, 'latest'])),
      pending: quantity(await read(url, 'eth_getTransactionCount', [intent.sender, 'pending'])) }))
    const agreed = same(nonces)
    const providers = FUNDING_RPC_URLS.map((url, index) => ({ url, finalized_block_number: heads[index].number.toString(),
      finalized_block_hash: heads[index].hash, latest_nonce: nonces[index].latest.toString(), pending_nonce: nonces[index].pending.toString() }))
    let finalizedNonce: FundSetupRecoveryProof['finalized_nonce'] = null
    const proof = (status: FundSetupRecoveryProof['status'], reason_code: string | null,
      extra: Partial<FundSetupRecoveryProof> = {}): FundSetupRecoveryProof => {
      if (signal.aborted || clock() - started >= 90_000) return fail('RECOVERY_DEADLINE_EXCEEDED')
      return { version: 1, chain_id: 80002, checked_at: new Date(clock()).toISOString(), status, reason_code,
        sender: intent.sender, nonce: intent.nonce, intent_hash: fundSetupHash(intent),
        anchor: { block_number: lowerNumber.toString(), block_hash: lowerHash }, providers,
        finalized_nonce: finalizedNonce, transaction_hash: null, retry_checks: null, winner: null, ...extra }
    }
    const nonceAt = async (at: bigint) => same(await pair(async url => quantity(await read(url, 'eth_getTransactionCount', [intent.sender, hex(at)]))))
    const checkHeaders = async (points: { number: bigint; hash: string }[]) => {
      for (const point of points) {
        const now = same(await pair(async url => header(await read(url, 'eth_getBlockByNumber', [hex(point.number), false]), point.number)))
        if (now.hash !== point.hash) return fail('RECOVERY_CANONICAL_BLOCK_CHANGED')
      }
    }
    if (agreed.latest < nonce || agreed.pending < agreed.latest) return proof('WAITING', 'RECOVERY_NONCE_STATE_UNAVAILABLE')
    if (agreed.latest === nonce) {
      if (agreed.pending !== nonce) return proof('WAITING', 'RECOVERY_NONCE_PENDING')
      const stateStarted = clock()
      const call = async (url: string, method: string, args: unknown[], at: string) => {
        const result = await read(url, 'eth_call', [{ to: intent.to, data: abi.encodeFunctionData(method, args) }, at])
        if (typeof result !== 'string') return fail('RECOVERY_CONTRACT_READ_INVALID')
        try { return abi.decodeFunctionResult(method, result) } catch { return fail('RECOVERY_CONTRACT_READ_INVALID') }
      }
      const states = await pair(async url => {
        const atStates = []
        for (const at of [hex(commonNumber), 'latest']) {
          const runtime = await read(url, 'eth_getCode', [intent.to, at])
          if (typeof runtime !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(runtime) || keccak256(runtime) !== intent.expected_runtime_hash) return fail('RECOVERY_RUNTIME_CHANGED')
          const owner = address((await call(url, 'owner', [], at))[0])
          const before = [...(await call(url, 'getCurrentVersion', [], at))[0]].map(Number)
          const installed = [...(await call(url, 'getContracts', [version], at))[0]].map(String).map(item => item.toLowerCase())
          if (owner !== intent.sender || JSON.stringify(before) === JSON.stringify(version) || installed.some(item => item !== ZERO)) return fail('RECOVERY_CONTRACT_STATE_CHANGED')
          atStates.push({ owner, before })
        }
        if (fundSetupHash(atStates[0]) !== fundSetupHash(atStates[1])) return fail('RECOVERY_CONTRACT_STATE_CHANGED')
        if ((await call(url, 'isReferenceContract', [], 'latest'))[0] !== true) return fail('RECOVERY_CONTRACT_STATE_CHANGED')
        for (let index = 0; index < dependencies.length; index++) {
          const runtime = await read(url, 'eth_getCode', [dependencies[index], 'latest'])
          if (typeof runtime !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(runtime)
            || keccak256(runtime) !== keccak256(canonicalFundRuntime(implementations[index]))) return fail('RECOVERY_DEPENDENCY_CHANGED')
        }
        if (await read(url, 'eth_call', [{ from: intent.sender, to: intent.to, value: '0x0', data: intent.data }, 'latest']) !== '0x') return fail('RECOVERY_SIMULATION_INVALID')
        return atStates[0]
      })
      const state = same(states)
      await checkHeaders([common])
      const current = same(await pair(async url => ({ latest: quantity(await read(url, 'eth_getTransactionCount', [intent.sender, 'latest'])),
        pending: quantity(await read(url, 'eth_getTransactionCount', [intent.sender, 'pending'])) })))
      const finalNonce = await nonceAt(commonNumber)
      finalizedNonce = { block_number: commonNumber.toString(), block_hash: common.hash, nonce: finalNonce.toString() }
      if (current.latest !== nonce || current.pending !== nonce || finalNonce !== nonce) return proof('WAITING', 'RECOVERY_NONCE_CHANGED')
      if (clock() - stateStarted > 30_000) return fail('RECOVERY_PREFLIGHT_STALE')
      return proof('RETRY_AVAILABLE', null, { anchor: { block_number: commonNumber.toString(), block_hash: common.hash },
        retry_checks: { runtime_hash: intent.expected_runtime_hash, owner: state.owner, before_version: state.before.join('.'), simulation_succeeded: true } })
    }
    if (lowerNumber >= commonNumber || commonNumber - lowerNumber > 262_144n) return proof('WAITING', 'RECOVERY_SEARCH_BOUND_EXCEEDED')
    const lower = same(await pair(async url => header(await read(url, 'eth_getBlockByNumber', [hex(lowerNumber), false]), lowerNumber)))
    if (lower.hash !== lowerHash) return proof('WAITING', 'RECOVERY_ANCHOR_CHANGED')
    const startNonce = await nonceAt(lowerNumber), finalNonce = await nonceAt(commonNumber)
    finalizedNonce = { block_number: commonNumber.toString(), block_hash: common.hash, nonce: finalNonce.toString() }
    if (startNonce > nonce) return proof('WAITING', 'RECOVERY_ANCHOR_NOT_BRACKETED')
    if (finalNonce <= nonce) return proof('WAITING', 'RECOVERY_NONCE_NOT_FINAL')
    let low = lowerNumber, high = commonNumber, rounds = 0
    while (high - low > 1n) {
      if (++rounds > 20) return proof('WAITING', 'RECOVERY_SEARCH_BOUND_EXCEEDED')
      const middle = (low + high) / 2n
      if (await nonceAt(middle) > nonce) high = middle; else low = middle
    }
    if (await nonceAt(high - 1n) > nonce || await nonceAt(high) <= nonce) return proof('WAITING', 'RECOVERY_BOUNDARY_CHANGED')
    const blocks = await pair(async url => {
      const full = row(await read(url, 'eth_getBlockByNumber', [hex(high), true])), block = header(full, high)
      if (!Array.isArray(full.transactions) || full.transactions.length > 8192) return fail('RECOVERY_FULL_BLOCK_UNAVAILABLE')
      const transactions = full.transactions.map((value, index) => {
        const tx = row(value), transactionHash = hash(tx.hash), chainId = quantity(tx.chainId)
        if (chainId > BigInt(Number.MAX_SAFE_INTEGER) || quantity(tx.blockNumber) !== high || hash(tx.blockHash) !== block.hash
          || quantity(tx.transactionIndex) !== BigInt(index) || typeof tx.input !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.input)
          || tx.input.length > 262146) return fail('RECOVERY_FULL_BLOCK_UNAVAILABLE')
        return { block_number: high.toString(), block_hash: block.hash, transaction_hash: transactionHash,
          from: address(tx.from), to: tx.to === null ? null : address(tx.to), value: quantity(tx.value).toString(),
          data: tx.input.toLowerCase(), nonce: quantity(tx.nonce).toString(), chain_id: Number(chainId) }
      })
      if (new Set(transactions.map(tx => tx.transaction_hash)).size !== transactions.length) return fail('RECOVERY_FULL_BLOCK_UNAVAILABLE')
      return { block, transactions }
    })
    const found = same(blocks), matches = found.transactions.filter(tx => tx.from === intent.sender && tx.nonce === intent.nonce)
    await checkHeaders([lower, common, found.block, { number: high - 1n, hash: same(await pair(async url => header(await read(url, 'eth_getBlockByNumber', [hex(high - 1n), false]), high - 1n))).hash }])
    if (matches.length === 0) return proof('HOLD', 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION')
    if (matches.length !== 1) return proof('WAITING', 'RECOVERY_FULL_BLOCK_UNAVAILABLE')
    const winner = matches[0]
    if (winner.chain_id !== 80002 || winner.to !== intent.to || winner.value !== '0' || winner.data !== intent.data) {
      return proof('HOLD', 'SETUP_RETRY_NONCE_WINNER_MISMATCH', { transaction_hash: winner.transaction_hash, winner })
    }
    const observed = await observeSetupStep(intent, winner.transaction_hash, { rpc: read, intent_hash: fundSetupHash(intent) })
    if (!['FINAL', 'FAILED'].includes(observed.status) || observed.block_number !== winner.block_number || observed.block_hash !== winner.block_hash) return proof('WAITING', 'RECOVERY_WINNER_NOT_FINAL')
    await checkHeaders([lower, common, found.block])
    return proof('WINNER', observed.status === 'FAILED' ? 'RECOVERY_WINNER_REVERTED' : null, { transaction_hash: winner.transaction_hash, winner })
  } finally { clearTimeout(timer); controller.abort() }
}
