import { Interface } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildFundAdmissionCandidate, fundAdmissionInputSchema, fundAdmissionRpc, readFundAdmissionSnapshot } from './fund-chain-admission'
import { fundChainExpectationSchema } from './fund-lifecycle-chain'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { FUND_SETUP_CATALOG_HASH, getCanonicalFundArtifact } from './fund-setup-artifacts'
import { canonicalAdmissionFixture, testAddress, testHash, testId } from './fund-chain-test-fixtures'

describe('canonical setup to truthful release candidate', () => {
  it('binds 25 saved final steps, exact runtimes/current governance and six CREATE2 proxies without admitting anything', async () => {
    const fixture = canonicalAdmissionFixture(), result = await buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })
    expect(result).toMatchObject({ status: 'NOT_ADMITTED', environment: 'TESTNET', chain_id: 80002, catalog_hash: FUND_SETUP_CATALOG_HASH,
      setup_id: fixture.input.setup.setup!.id, setup_revision: 100, independent_audit_proven: false, standard_claim_expiry_enforced: false })
    expect(result.manifest.status).toBe('NOT_ADMITTED')
    expect(result.proof_refs).toEqual(fixture.input.proof_refs)
    expect(result.manifest.safe.owners).toEqual(fixture.input.setup.setup!.safe_owners)
    expect(result.manifest.maximum_supply).toBe('100000000')
    expect(new Set(Object.values(result.manifest.suite).map(item => item.address)).size).toBe(6)
    expect(result.deployment_expectation.deployment.salt).toBe(fixture.input.deployment_salt)
    expect(result.issuance_expectation.issuance).toEqual({ chain_snapshot_block: '120', chain_snapshot_hash: testHash(120) })
    expect(result.observed.providers.map(item => item.url)).toEqual([...FUNDING_RPC_URLS])
    // Only the owner-admission validator may promote the exact template later.
    const admittedManifest = { ...result.manifest, status: 'ADMITTED' }
    expect(fundChainExpectationSchema.options[0].shape.manifest.safeParse(admittedManifest).success).toBe(true)
    expect(fixture.rpc.mock.calls.some(call => /send|sign|write/i.test(call[1]))).toBe(false)
  })
  it.each(['UNKNOWN', 'PENDING', 'REVERTED'] as const)('does not convert %s setup evidence into a release', async state => {
    const fixture = canonicalAdmissionFixture()
    fixture.input.setup.setup!.state = 'IN_PROGRESS'; fixture.input.setup.setup!.steps[0].state = state
    await expect(buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })).rejects.toThrow('does not support this release candidate')
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
  it('requires existing receipt references and rejects duplicate topics, false MAIN config and unbounded limits', () => {
    const input = canonicalAdmissionFixture().input
    expect(fundAdmissionInputSchema.safeParse({ ...input, proof_refs: {} }).success).toBe(false)
    expect(fundAdmissionInputSchema.safeParse({ ...input, claim_topics: ['1', '1'] }).success).toBe(false)
    expect(fundAdmissionInputSchema.safeParse({ ...input, maximum_operation_units: '100000001' }).success).toBe(false)
    expect(fundAdmissionInputSchema.safeParse({ ...input, setup: { ...input.setup, environment: 'MAINNET' } }).success).toBe(false)
  })
  it('rejects missing saved observation IDs, wrong saved runtime pins and expired setup', async () => {
    for (const mutation of ['observation', 'runtime', 'expiry']) {
      const fixture = canonicalAdmissionFixture()
      if (mutation === 'observation') fixture.input.setup.setup!.steps[0].observation_id = null
      if (mutation === 'runtime') fixture.input.setup.setup!.steps[0].intent!.expected_runtime_hash = testHash(999)
      if (mutation === 'expiry') fixture.input.setup.setup!.expires_at = '2020-01-01T00:00:00Z'
      await expect(buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })).rejects.toThrow()
    }
  })
  it('does not certify a changed management key or factory owner', async () => {
    const abi = new Interface(getCanonicalFundArtifact('TREXFactory').abi)
    const fixture = canonicalAdmissionFixture({ mutate: (_url, method, params, value) => method === 'eth_call'
      && (params[0] as { data: string }).data === abi.encodeFunctionData('owner') ? abi.encodeFunctionResult('owner', [testAddress(999)]) : value })
    await expect(buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })).rejects.toThrow()
  })
  it('rejects a provider code disagreement and any occupied predicted suite address', async () => {
    for (const variant of ['code', 'occupied']) {
      const fixture = canonicalAdmissionFixture({ mutate: (url, method, params, value) => {
        if (method !== 'eth_getCode') return value
        if (variant === 'occupied' && value === '0x') return '0x6000'
        if (variant === 'code' && url === FUNDING_RPC_URLS[1] && value !== '0x') return '0x6000'
        return value
      } })
      await expect(buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })).rejects.toThrow()
    }
  })
  it('detects a canonical block change after the observation wait', async () => {
    const fixture = canonicalAdmissionFixture({ mutate: (_url, method, params, value, count) => method === 'eth_getBlockByNumber'
      && params[0] === '0x78' && count > 4 ? { ...(value as object), hash: testHash(999) } : value })
    await expect(buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })).rejects.toThrow()
  })
  it('requires exact fixed observers and refuses a copied provider environment URL', async () => {
    const fixture = canonicalAdmissionFixture(), rpc = fundAdmissionRpc({ rpc: fixture.rpc })
    await expect(rpc('https://rpc.example.invalid/?api_key=secret', 'eth_chainId', [])).rejects.toThrow()
    expect(fixture.rpc).not.toHaveBeenCalled()
    const snapshot = await readFundAdmissionSnapshot(rpc)
    expect(snapshot.providers).toHaveLength(2)
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })
  it('retains the one-operator TEST assurance rather than inventing independent humans', async () => {
    const fixture = canonicalAdmissionFixture()
    fixture.input.setup.roleplay_policy = { policy_id: testId(900), epoch: 1, expires_at: '2100-01-01T00:00:00Z', label: 'TEST ROLE PLAY - one operator; not independent human approval' }
    const result = await buildFundAdmissionCandidate(fixture.input, { rpc: fixture.rpc })
    expect(result.roleplay_policy).toEqual(fixture.input.setup.roleplay_policy)
    expect(result.independent_audit_proven).toBe(false)
  })
})
