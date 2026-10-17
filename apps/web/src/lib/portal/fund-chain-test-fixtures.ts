/** RPC-shape unit fixtures only. These are NOT EVM execution, native receipts or hosted admission. */
import { AbiCoder, Interface, getCreateAddress, keccak256, toUtf8Bytes } from 'ethers'
import { vi } from 'vitest'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { buildSetupIntent, FUND_SETUP_STEPS, FUND_SETUP_SAFE_L2, FUND_SETUP_SAFE_PROXY_RUNTIME, type FundSetupAddresses, type FundSetupConfiguration } from './fund-setup-chain'
import { canonicalFundRuntime, getCanonicalFundArtifact, getOfficialSafeArtifact, type FundSetupArtifactName } from './fund-setup-artifacts'
import type { FundAdmissionInput } from './fund-chain-admission'

export const testAddress = (number: number) => `0x${number.toString(16).padStart(40, '0')}`
export const testId = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`
export const testHash = (number: number) => `0x${number.toString(16).padStart(64, '0')}`
export const testBlock = (number: bigint) => ({ number: `0x${number.toString(16)}`, hash: testHash(Number(number)), timestamp: '0x6aa3d180', transactions: [] as string[] })
export type FundFixtureMutation = (url: string, method: string, params: unknown[], value: unknown, count: number) => unknown
export function canonicalAdmissionFixture(options: { owners?: string[]; claimKey?: string; mutate?: FundFixtureMutation } = {}) {
  const owners = (options.owners ?? [testAddress(1), testAddress(9)]).map(value => value.toLowerCase()).sort(), sender = owners[0]
  const config: FundSetupConfiguration = { safe_address: testAddress(2), identity_management_key: testAddress(3), claim_management_key: options.claimKey?.toLowerCase() ?? testAddress(4),
    token_management_key: testAddress(5), maximum_holding_base_units: '100000000', tst_initial_holder: testAddress(6), tst_initial_supply_base_units: '3000000000' }
  const dependencies: FundSetupAddresses = {}, steps = FUND_SETUP_STEPS.map((step, index) => {
    const intent = buildSetupIntent(step.key, config, dependencies, sender, String(index + 1), 'ce'.repeat(32))
    if (step.kind === 'CREATE') dependencies[step.key as keyof FundSetupAddresses] = getCreateAddress({ from: sender, nonce: index + 1 }).toLowerCase()
    return { id: testId(index + 100), step_key: step.key as NonNullable<FundAdmissionInput['setup']['setup']>['steps'][number]['step_key'], ordinal: index + 1,
      kind: step.kind, revision: 4, state: 'FINAL' as const, actor_id: testId(1), sender, nonce: String(index + 1), intent_hash: 'aa'.repeat(32), intent,
      expires_at: '2100-01-01T00:00:00Z', claimed_at: '2026-10-14T00:00:00Z', transaction_hash: testHash(index + 100),
      deployed_address: step.kind === 'CREATE' ? intent.expected_address : null, observation_id: testId(index + 200), reason_code: null }
  })
  const input: FundAdmissionInput = { manifest_id: testId(30), product_binding_hash: 'ab'.repeat(32), class_id: testId(31), class_name: 'Ordinary fund units',
    security_unit_decimals: 6, token_name: 'Sandbox Fund', token_symbol: 'BXF', cap_units: '100', maximum_operation_units: '100000000',
    claim_topics: ['1'], deployment_salt: 'test-fund-offering-1', signer_address: sender, authority_epoch: 1, required_confirmations: 2,
    proof_refs: { conformance_receipt_id: testId(32), governance_receipt_id: testId(33), observation_policy_receipt_id: testId(34), role_state_receipt_id: testId(35) },
    setup: { schema_version: 1, actor_id: testId(1), environment: 'TESTNET', operating_context: { mode: 'ROLE', organisationId: testId(2), role: 'TokenisationAgent' },
      observed_at: '2026-10-14T00:00:00Z', product_id: testId(3), product_revision: 7, offering_revision_id: testId(4), terms_hash: 'bc'.repeat(32), configuration_hash: 'cd'.repeat(32),
      source_pin: 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4', roleplay_policy: null, availability: 'AVAILABLE', reason_code: null,
      setup: { id: testId(5), revision: 100, actor_id: testId(1), operating_context: { mode: 'ROLE', organisationId: testId(2), role: 'TokenisationAgent' },
        state: 'COMPLETE_NOT_ADMITTED', recovery_hold: false, recovery_reason: null, recovery_observation_id: null, expires_at: '2100-01-01T00:00:00Z',
        safe_address: config.safe_address, safe_state: 'VERIFIED', safe_owners: owners, safe_threshold: 2, configuration: config, setup_configuration_hash: 'ce'.repeat(32),
        dependencies, safe_configuration: null, safe_creation: null, steps, next_step: null, saved_intent: null, admission_reason: 'RELEASE_CONFORMANCE_AND_GOVERNANCE_RECEIPTS_REQUIRED' } },
  }
  const byAddress = new Map<string, { artifact: FundSetupArtifactName; runtime: string }>()
  for (const step of FUND_SETUP_STEPS.filter(item => item.kind === 'CREATE')) {
    const bindings: Record<string, string> = step.artifact === 'IdFactory' ? { _implementationAuthority: dependencies.oid_authority! }
      : step.artifact === 'Bx1FundController' ? { institutionalAuthority: config.safe_address, factory: dependencies.trex_factory! }
        : step.artifact === 'Bx1MaximumHoldingModule' ? { maximumHolding: config.maximum_holding_base_units } : {}
    byAddress.set(dependencies[step.key as keyof FundSetupAddresses]!, { artifact: step.artifact, runtime: canonicalFundRuntime(step.artifact, bindings) })
  }
  const safe = new Interface(getOfficialSafeArtifact('Safe').abi), counters = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_chainId') value = '0x13882'
    else if (method === 'eth_getBlockByNumber') value = testBlock(params[0] === 'finalized' ? url === FUNDING_RPC_URLS[0] ? 120n : 123n : BigInt(String(params[0])))
    else if (method === 'eth_getCode') value = params[0] === config.safe_address ? FUND_SETUP_SAFE_PROXY_RUNTIME : params[0] === FUND_SETUP_SAFE_L2 ? getOfficialSafeArtifact('SafeL2').deployedBytecode : byAddress.get(String(params[0]))?.runtime ?? '0x'
    else if (method === 'eth_getStorageAt') value = AbiCoder.defaultAbiCoder().encode(['address'], [dependencies.ia_factory])
    else if (method === 'eth_getTransactionCount') value = '0x1a'
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: string }, piece = byAddress.get(call.to)
      const abi = call.to === config.safe_address ? safe : new Interface(getCanonicalFundArtifact(piece?.artifact === 'IdentityProxy' ? 'Identity' : piece?.artifact ?? 'Token').abi)
      let decoded = abi.parseTransaction({ data: call.data }), active = abi
      if (!decoded && piece?.artifact === 'IdentityProxy') { active = new Interface(getCanonicalFundArtifact('IdentityProxy').abi); decoded = active.parseTransaction({ data: call.data }) }
      if (!decoded) throw new Error('Fixture has no expected ABI selector')
      const name = decoded.name, args = decoded.args
      let result: unknown[]
      if (name === 'getOwners') result = [owners]
      else if (name === 'getThreshold') result = [2]
      else if (name === 'nonce') result = [0]
      else if (name === 'getModulesPaginated') result = [[], testAddress(1)]
      else if (name === 'getStorageAt') result = [AbiCoder.defaultAbiCoder().encode(['address'], [String(args[0]) === '0' ? FUND_SETUP_SAFE_L2 : ZERO])]
      else if (name === 'VERSION') result = ['1.4.1']
      else if (name === 'version') result = ['2.2.1']
      else if (name === 'owner') result = [piece?.artifact === 'TREXFactory' ? dependencies.controller : config.safe_address]
      else if (name === 'getImplementationAuthority') result = [dependencies.trex_authority]
      else if (name === 'getIdFactory') result = [dependencies.oid_factory]
      else if (name === 'getCurrentVersion') result = [[4, 1, 3]]
      else if (name === 'getImplementation') result = [dependencies.oid_implementation]
      else if (name === 'getTREXFactory' || name === 'factory') result = [dependencies.trex_factory]
      else if (name === 'institutionalAuthority') result = [config.safe_address]
      else if (name === 'authorityEpoch') result = [1]
      else if (name === 'paused') result = [false]
      else if (name === 'getKeysByPurpose') result = [String(args[0]) === '1' ? [keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [piece?.artifact === 'ClaimIssuer' ? config.claim_management_key : config.token_management_key]))] : []]
      else if (name === 'isTokenFactory' || name === 'keyHasPurpose') result = [true]
      else if (name === 'implementationAuthority') result = [dependencies.oid_authority]
      else if (name === 'maximumHolding') result = [config.maximum_holding_base_units]
      else {
        const getters: Record<string, keyof FundSetupAddresses> = { getTokenImplementation: 'token_implementation', getCTRImplementation: 'ctr_implementation', getIRSImplementation: 'irs_implementation', getIRImplementation: 'ir_implementation', getTIRImplementation: 'tir_implementation', getMCImplementation: 'mc_implementation' }
        if (!getters[name]) throw new Error(`Fixture unexpected method ${name}`)
        result = [dependencies[getters[name]]]
      }
      value = active.encodeFunctionResult(decoded.fragment, result).toLowerCase()
    } else throw new Error(`Fixture unexpected RPC ${method}`)
    const key = `${url}:${method}:${JSON.stringify(params)}`, count = (counters.get(key) ?? 0) + 1; counters.set(key, count)
    const copied = structuredClone(value)
    return options.mutate ? options.mutate(url, method, params, copied, count) : copied
  })
  return { input, rpc, config, dependencies, byAddress }
}
const ZERO = '0x0000000000000000000000000000000000000000'
export const testManagementKeyHash = (value: string) => keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [value]))
export const testGuardSlot = keccak256(toUtf8Bytes('guard_manager.guard.address'))
