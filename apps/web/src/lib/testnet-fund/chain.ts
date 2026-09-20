import 'server-only'
import { Contract, ContractFactory, Interface, JsonRpcProvider, FetchRequest, getAddress, getCreateAddress, keccak256, toUtf8Bytes } from 'ethers'
import { demoFundArtifact } from './artifact.generated'
import { DemoError, requireDemoEnvironment } from './server'
import type { DemoFund, DemoOperation, DemoTransaction } from './contracts'

const CONFIRMATIONS = 12
const ZERO = '0x0000000000000000000000000000000000000000'
export function operationKey(fundId: string, operationId: string) { return keccak256(toUtf8Bytes(`bx1-demo:${fundId}:${operationId}`)) }
function artifact() {
  if (!demoFundArtifact || !/^0x[0-9a-f]+$/i.test(demoFundArtifact.bytecode) || demoFundArtifact.bytecode.length < 10) throw new DemoError('The cloud-compiled demo token is not available yet.', 503)
  return demoFundArtifact
}
async function provider() {
  requireDemoEnvironment()
  const raw = process.env.BLOCKXONE_DEMO_AMOY_RPC_URL
  let url: URL
  try { url = new URL(raw ?? ''); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() } catch { throw new DemoError('Amoy verification is not configured.', 503) }
  const request = new FetchRequest(url.toString()); request.timeout = 10000
  const rpc = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 })
  try { if (await rpc.send('eth_chainId', []) !== '0x13882') throw new Error() } catch { rpc.destroy(); throw new DemoError('RPC did not verify Polygon Amoy chain 80002.', 503) }
  return rpc
}
export async function deploymentTransaction(wallet: string): Promise<DemoTransaction> {
  const compiled = artifact()
  const tx = await new ContractFactory(compiled.abi, compiled.bytecode).getDeployTransaction()
  return { from: getAddress(wallet), data: String(tx.data), value: '0x0' }
}
export function operationTransaction(fund: DemoFund, operation: DemoOperation): DemoTransaction {
  if (!fund.contract_address || !fund.contract_owner || operation.status !== 'PREPARED') throw new DemoError('This operation is not ready to sign.')
  const method = operation.kind === 'MINT' ? 'mintWithOperation' : 'burnWithOperation'
  return { from: getAddress(fund.contract_owner), to: getAddress(fund.contract_address), value: '0x0', data: new Interface(artifact().abi).encodeFunctionData(method, [operationKey(fund.id, operation.id), operation.wallet, BigInt(operation.units)]) }
}
async function confirmedReceipt(rpc: JsonRpcProvider, hash: string) {
  const receipt = await rpc.getTransactionReceipt(hash)
  if (!receipt) throw new DemoError('Transaction is pending or not found. Verify again; do not resend.', 202)
  if (receipt.status !== 1) throw new DemoError('The transaction reverted. No holding change was applied.')
  const latest = await rpc.getBlockNumber()
  if (latest - receipt.blockNumber + 1 < CONFIRMATIONS) throw new DemoError(`Waiting for ${CONFIRMATIONS} Amoy confirmations. Verify again; do not resend.`, 202)
  const block = await rpc.getBlock(receipt.blockNumber)
  if (!block || block.hash !== receipt.blockHash) throw new DemoError('Receipt is not on the current canonical chain. No register update.')
  const tx = await rpc.getTransaction(hash)
  if (!tx || tx.chainId !== 80002n || tx.value !== 0n) throw new DemoError('Unexpected transaction chain or native value.')
  return { receipt, tx }
}
export async function verifyDeployment(hash: string, expectedWallet: string) {
  const rpc = await provider()
  try {
    const { receipt, tx } = await confirmedReceipt(rpc, hash)
    const expected = await deploymentTransaction(expectedWallet)
    if (tx.to !== null || !receipt.contractAddress || tx.from.toLowerCase() !== expected.from.toLowerCase() || tx.data.toLowerCase() !== expected.data.toLowerCase()
      || getCreateAddress({ from: tx.from, nonce: tx.nonce }).toLowerCase() !== receipt.contractAddress.toLowerCase()) throw new DemoError('Deployment does not match the reviewed testnet token and selected wallet.')
    const token = new Contract(receipt.contractAddress, artifact().abi, rpc)
    if ((await rpc.getCode(receipt.contractAddress)) === '0x' || String(await token.owner()).toLowerCase() !== tx.from.toLowerCase() || BigInt(await token.decimals()) !== 0n) throw new DemoError('Deployed token verification failed.')
    return { contractAddress: receipt.contractAddress.toLowerCase(), owner: tx.from.toLowerCase(), blockNumber: receipt.blockNumber }
  } finally { rpc.destroy() }
}
export async function verifyOperation(fund: DemoFund, operation: DemoOperation, hash: string) {
  const rpc = await provider()
  try {
    const expected = operationTransaction(fund, { ...operation, status: 'PREPARED' })
    const { receipt, tx } = await confirmedReceipt(rpc, hash)
    if (tx.to?.toLowerCase() !== expected.to?.toLowerCase() || tx.from.toLowerCase() !== expected.from.toLowerCase() || tx.data.toLowerCase() !== expected.data.toLowerCase()) throw new DemoError('Transaction does not match this operation, signer, fund, recipient and amount.')
    const abi = new Interface(artifact().abi)
    const events = receipt.logs.filter(log => log.address.toLowerCase() === expected.to!.toLowerCase()).flatMap(log => { try { const event = abi.parseLog(log); return event ? [event] : [] } catch { return [] } })
    const operations = events.filter(event => event.name === 'OperationExecuted')
    const transfers = events.filter(event => event.name === 'Transfer')
    if (operations.length !== 1 || transfers.length !== 1) throw new DemoError('Expected operation and unit-transfer evidence is missing.')
    const op = operations[0].args, transfer = transfers[0].args
    const from = operation.kind === 'MINT' ? ZERO : operation.wallet
    const to = operation.kind === 'MINT' ? operation.wallet : ZERO
    if (String(op[0]).toLowerCase() !== operationKey(fund.id, operation.id) || BigInt(op[1]) !== (operation.kind === 'MINT' ? 1n : 2n)
      || String(op[2]).toLowerCase() !== operation.wallet.toLowerCase() || BigInt(op[3]) !== BigInt(operation.units)
      || String(transfer[0]).toLowerCase() !== from.toLowerCase() || String(transfer[1]).toLowerCase() !== to.toLowerCase() || BigInt(transfer[2]) !== BigInt(operation.units)) throw new DemoError('Receipt amounts or identities do not match the reserved operation.')
    return { blockNumber: receipt.blockNumber, contractAddress: fund.contract_address! }
  } finally { rpc.destroy() }
}
export async function reconcileFund(fund: DemoFund) {
  if (!fund.contract_address) throw new DemoError('Deploy and verify this fund token first.')
  const rpc = await provider()
  try {
    const token = new Contract(fund.contract_address, artifact().abi, rpc)
    const block = await rpc.getBlockNumber()
    const supply = BigInt(await token.totalSupply({ blockTag: block }))
    const balances = await Promise.all(fund.holdings.map(async holding => ({ wallet: holding.investor_wallet, registered: holding.units, onChain: String(await token.balanceOf(holding.investor_wallet, { blockTag: block })) })))
    const journalBalanced = fund.journal.every(entry => entry.lines.reduce((sum, line) => sum + (line.direction === 'DEBIT' ? BigInt(line.amount) : -BigInt(line.amount)), 0n) === 0n)
    const unitLedgerSupply = fund.journal.filter(entry => entry.unit === 'FUND_UNIT').flatMap(entry => entry.lines).filter(line => line.account === 'UNITS_ISSUED').reduce((sum, line) => sum + (line.direction === 'DEBIT' ? BigInt(line.amount) : -BigInt(line.amount)), 0n)
    const cashLedgerMinor = fund.journal.filter(entry => entry.unit === 'ZAR_TEST').flatMap(entry => entry.lines).filter(line => line.account === 'SYNTHETIC_CASH').reduce((sum, line) => sum + (line.direction === 'DEBIT' ? BigInt(line.amount) : -BigInt(line.amount)), 0n)
    const registerTotal = fund.holdings.reduce((sum, holding) => sum + BigInt(holding.units), 0n)
    return { blockNumber: block, supply: String(supply), registeredSupply: fund.issued_units, unitLedgerSupply: String(unitLedgerSupply), syntheticCashLedgerMinor: String(cashLedgerMinor), journalBalanced, balances, matches: journalBalanced && supply === BigInt(fund.issued_units) && registerTotal === supply && unitLedgerSupply === supply && cashLedgerMinor === BigInt(fund.synthetic_cash_minor) && balances.every(row => row.registered === row.onChain) }
  } finally { rpc.destroy() }
}
