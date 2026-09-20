/** Browser-only, read-only preparation. Signing and dispatch remain explicit UI actions. */
export type AmoyWalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export type AmoyTransactionInput = { from: string; data: string; value: string; to?: string }
export type PreparedAmoyTransaction = {
  transaction: AmoyTransactionInput & { chainId: string; gas: string; nonce: string; maxFeePerGas: string; maxPriorityFeePerGas: string }
  nonce: string
  summary: { estimatedGas: string; gasLimit: string; priorityFeeGwei: string; maxFeePerGasGwei: string; maximumCostPol: string; balancePol: string }
}

const AMOY_CHAIN_ID = 80002n
const MIN_PRIORITY_FEE = 30_000_000_000n
const MAX_QUANTITY = (1n << 256n) - 1n
const ADDRESS = /^0x[0-9a-f]{40}$/i
const RPC_TIMEOUT_MS = 12_000

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error(`Invalid ${label} returned by the wallet. Nothing was sent.`)
  const parsed = BigInt(value)
  if (parsed > MAX_QUANTITY) throw new Error(`Invalid ${label} returned by the wallet. Nothing was sent.`)
  return parsed
}

const hex = (value: bigint) => `0x${value.toString(16)}`
const max = (left: bigint, right: bigint) => left > right ? left : right

function units(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${value / scale}${fraction ? `.${fraction}` : ''}`
}

async function read(provider: AmoyWalletProvider, method: string, params?: unknown[], timeout = RPC_TIMEOUT_MS): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      provider.request({ method, ...(params ? { params } : {}) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`The wallet timed out reading ${method}. Nothing was sent.`)), timeout) }),
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

async function assertAmoy(provider: AmoyWalletProvider): Promise<void> {
  if (quantity(await read(provider, 'eth_chainId'), 'chain ID') !== AMOY_CHAIN_ID) throw new Error('Select Polygon Amoy (80002) in MetaMask. Nothing was sent.')
}

async function noncePair(provider: AmoyWalletProvider, wallet: string): Promise<{ latest: bigint; pending: bigint }> {
  const [latest, pending] = await Promise.all([
    read(provider, 'eth_getTransactionCount', [wallet, 'latest']),
    read(provider, 'eth_getTransactionCount', [wallet, 'pending']),
  ])
  return { latest: quantity(latest, 'confirmed nonce'), pending: quantity(pending, 'pending nonce') }
}

/**
 * Equal counts do not prove that no node has seen an earlier submission. A retry
 * therefore uses the saved nonce, never the next nonce, even after this check.
 */
export async function validateRecoveryNonce(provider: AmoyWalletProvider, wallet: string, savedNonce?: string): Promise<string> {
  if (!ADDRESS.test(wallet)) throw new Error('The original wallet address is invalid. Recovery remains locked.')
  await assertAmoy(provider)
  const expected = savedNonce === undefined ? 0n : quantity(savedNonce, 'saved nonce')
  const { latest, pending } = await noncePair(provider, wallet)
  if (latest !== expected || pending !== expected) throw new Error('Wallet transaction history changed or a transaction is pending. Verify the original transaction; recovery remains locked.')
  return hex(expected)
}

export type LegacyDeploymentRecovery = {
  kind: string
  txHash?: string
  walletAddress: string
  currentWalletAddress: string
  latestNonce: string
  pendingNonce: string
}

/** Only the original no-hash, first-ever deployment can use the legacy nonce-0 path. */
export function canRecoverLegacyDeployment(input: LegacyDeploymentRecovery): boolean {
  try {
    return input.kind === 'deployment' && input.txHash === undefined && ADDRESS.test(input.walletAddress)
      && ADDRESS.test(input.currentWalletAddress) && input.walletAddress.toLowerCase() === input.currentWalletAddress.toLowerCase()
      && quantity(input.latestNonce, 'confirmed nonce') === 0n && quantity(input.pendingNonce, 'pending nonce') === 0n
  } catch { return false }
}

export async function prepareAmoyWalletTransaction(
  provider: AmoyWalletProvider,
  input: AmoyTransactionInput,
  options: { retryNonce?: string } = {},
): Promise<PreparedAmoyTransaction> {
  if (!ADDRESS.test(input.from) || (input.to !== undefined && !ADDRESS.test(input.to)) || !/^0x(?:[0-9a-f]{2})+$/i.test(input.data)) throw new Error('The prepared transaction is invalid. Nothing was sent.')
  if (quantity(input.value, 'transaction value') !== 0n) throw new Error('This demonstration only permits zero native value. Nothing was sent.')
  // Copy only the server-authoritative transaction fields; ignore caller-supplied fee/nonce overrides.
  const exact: AmoyTransactionInput = { from: input.from, data: input.data, value: '0x0', ...(input.to === undefined ? {} : { to: input.to }) }
  await assertAmoy(provider)
  const [block, suggestedTip, estimated, balanceValue, nonces] = await Promise.all([
    read(provider, 'eth_getBlockByNumber', ['latest', false]),
    read(provider, 'eth_maxPriorityFeePerGas', undefined, 4_000).then(value => quantity(value, 'priority fee')).catch(() => MIN_PRIORITY_FEE),
    read(provider, 'eth_estimateGas', [exact]),
    read(provider, 'eth_getBalance', [input.from, 'pending']),
    noncePair(provider, input.from),
  ])
  if (typeof block !== 'object' || block === null || !('baseFeePerGas' in block)) throw new Error('Amoy base fee is unavailable. Nothing was sent.')
  const baseFee = quantity(block.baseFeePerGas, 'base fee')
  const estimatedGas = quantity(estimated, 'gas estimate')
  if (estimatedGas === 0n) throw new Error('The wallet returned an empty gas estimate. Nothing was sent.')
  const balance = quantity(balanceValue, 'test POL balance')
  if (nonces.latest !== nonces.pending) throw new Error('This wallet has a pending transaction or nonce gap. Resolve it in MetaMask before submitting another transaction. Nothing was sent.')
  if (options.retryNonce !== undefined && nonces.latest !== quantity(options.retryNonce, 'saved nonce')) throw new Error('The saved transaction nonce has already changed. Verify the original transaction instead of sending a duplicate. Nothing was sent.')
  const nonce = options.retryNonce === undefined ? nonces.latest : quantity(options.retryNonce, 'saved nonce')
  const priorityFee = max(suggestedTip, MIN_PRIORITY_FEE)
  // 20% gas-limit margin rounded upwards; dynamic base-fee headroom, with a two-tip floor.
  const gasLimit = (estimatedGas * 120n + 99n) / 100n
  const maximumFee = max(baseFee * 2n + priorityFee, priorityFee * 2n)
  if (gasLimit > MAX_QUANTITY || maximumFee > MAX_QUANTITY) throw new Error('The wallet returned unsupported gas or fee values. Nothing was sent.')
  const maximumCost = gasLimit * maximumFee
  if (balance < maximumCost) throw new Error(`Insufficient Amoy test POL for the maximum fee: ${units(maximumCost, 18)} POL required; wallet has ${units(balance, 18)} POL. Nothing was sent.`)
  return {
    transaction: { ...exact, chainId: hex(AMOY_CHAIN_ID), gas: hex(gasLimit), nonce: hex(nonce), maxPriorityFeePerGas: hex(priorityFee), maxFeePerGas: hex(maximumFee) },
    nonce: hex(nonce),
    summary: { estimatedGas: estimatedGas.toString(), gasLimit: gasLimit.toString(), priorityFeeGwei: units(priorityFee, 9), maxFeePerGasGwei: units(maximumFee, 9), maximumCostPol: units(maximumCost, 18), balancePol: units(balance, 18) },
  }
}

type ProviderErrorPart = { code?: unknown; message?: unknown; transactionHash?: unknown; hash?: unknown }

function errorParts(error: unknown): ProviderErrorPart[] {
  const parts: ProviderErrorPart[] = []
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || parts.length >= 24 || typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    const part = value as Record<string, unknown>
    parts.push(part)
    for (const key of ['data', 'originalError', 'error', 'cause']) visit(part[key], depth + 1)
  }
  visit(error, 0)
  return parts
}

const minimumTipRejection = /^(?:eth_sendRawTransaction:\s*)?transaction gas price below minimum:\s*gas tip cap [0-9]+,\s*minimum needed [0-9]+\s*$/i
const insufficientFundsRejection = /^insufficient funds for gas \* price \+ value(?:\s*:\s*(?:balance|address|have|have balance)\b[^\r\n]*)?\s*$/i

/** Narrowly classify send-request denials; timeouts, reverts and unrecognized errors stay unknown. */
export function classifyWalletSubmissionError(error: unknown): 'rejected' | 'not_broadcast' | 'unknown' {
  const parts = errorParts(error)
  // Any returned hash requires verification, even if a wrapper also contains a rejection message.
  if (parts.some(part => [part.hash, part.transactionHash].some(value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)))) return 'unknown'
  if (parts.some(part => part.code === 4001)) return 'rejected'
  if (parts.some(part => typeof part.message === 'string' && (minimumTipRejection.test(part.message.trim()) || insufficientFundsRejection.test(part.message.trim())))) return 'not_broadcast'
  return 'unknown'
}

/** Display a bounded provider message without serializing transaction data or nested objects. */
export function walletErrorMessage(error: unknown): string {
  const messages = errorParts(error).map(part => part.message).filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
  const message = messages.at(-1)
  return message ? message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400) : 'The wallet did not confirm the submission outcome. Check MetaMask Activity and verify an existing transaction; do not send again.'
}
