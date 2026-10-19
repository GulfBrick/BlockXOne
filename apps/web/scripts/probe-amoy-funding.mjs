/** Cloud-only, read-only provider availability evidence. Never settlement evidence. */
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This acceptance probe is restricted to GitHub-hosted execution.')
const urls = ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com']
const deadline = AbortSignal.timeout(25000)
let id = 0
class ProbeError extends Error {
  constructor(url, method, code, status) { super(code); this.url = url; this.method = method; this.code = code; this.status = status }
}
async function rpc(url, method, params) {
  const requestId = ++id
  try {
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: deadline })
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new ProbeError(url, method, 'HTTP_RESPONSE_UNAVAILABLE', response.status)
  const reader = response.body?.getReader()
  if (!reader) throw new ProbeError(url, method, 'EMPTY_BODY')
  const chunks = []; let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 1048576) { await reader.cancel(); throw new ProbeError(url, method, 'BODY_TOO_LARGE') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let result
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new ProbeError(url, method, 'INVALID_JSON') }
  if (!result || result.jsonrpc !== '2.0' || result.id !== requestId || result.error || !Object.hasOwn(result, 'result')) throw new ProbeError(url, method, 'RPC_RESULT_UNAVAILABLE')
  return result.result
  } catch (error) { throw error instanceof ProbeError ? error : new ProbeError(url, method, deadline.aborted ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE') }
}
function block(value, url) {
  if (!value || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value.number) || !/^0x[0-9a-f]{64}$/i.test(value.hash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value.timestamp)) throw new ProbeError(url, 'eth_getBlockByNumber', 'FINALIZED_BLOCK_UNAVAILABLE')
  return { number: BigInt(value.number), hash: value.hash.toLowerCase(), timestamp: BigInt(value.timestamp).toString() }
}
try {
  const providers = await Promise.all(urls.map(async url => {
    const [chain, finalized] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
    if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 80002n) throw new ProbeError(url, 'eth_chainId', 'WRONG_CHAIN')
    const final = block(finalized, url)
    const canonical = block(await rpc(url, 'eth_getBlockByNumber', [`0x${final.number.toString(16)}`, false]), url)
    if (canonical.number !== final.number || canonical.hash !== final.hash || canonical.timestamp !== final.timestamp) throw new ProbeError(url, 'eth_getBlockByNumber', 'FINALIZED_CANONICAL_MISMATCH')
    return { url, final }
  }))
  const common = providers.reduce((n, p) => p.final.number < n ? p.final.number : n, providers[0].final.number)
  const matched = await Promise.all(providers.map(async p => block(await rpc(p.url, 'eth_getBlockByNumber', [`0x${common.toString(16)}`, false]), p.url)))
  if (matched.some(b => b.number !== common || b.hash !== matched[0].hash || b.timestamp !== matched[0].timestamp)) throw new ProbeError(undefined, 'eth_getBlockByNumber', 'PROVIDER_DISAGREEMENT')
  console.log(JSON.stringify({ status: 'RPC_FINALITY_AVAILABILITY_VERIFIED', chain_id: 80002, observed_at: new Date().toISOString(), common_block_number: common.toString(), common_block_hash: matched[0].hash,
    providers: providers.map(p => ({ url: p.url, finalized_block_number: p.final.number.toString(), finalized_block_hash: p.final.hash })), scope: 'Read-only RPC/finality availability only; no token, route, payment or settlement has been verified.' }))
} catch (error) {
  console.error(JSON.stringify({ status: 'RPC_FINALITY_AVAILABILITY_UNAVAILABLE', provider: error instanceof ProbeError && urls.includes(error.url) ? error.url : undefined,
    method: error instanceof ProbeError ? error.method : undefined, error_code: error instanceof ProbeError ? error.code : 'PROBE_UNAVAILABLE', http_status: error instanceof ProbeError ? error.status : undefined,
    scope: 'Probe did not pass. No settlement readiness can be inferred.' }))
  process.exitCode = 1
}
