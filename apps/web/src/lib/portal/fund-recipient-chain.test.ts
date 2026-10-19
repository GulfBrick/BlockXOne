import { AbiCoder, Interface, Wallet, getBytes, getCreateAddress, keccak256 } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildFundAdmissionCandidate } from './fund-chain-admission'
import { buildFundRecipientClaimData, buildFundRecipientClaimSigningRequest, buildSignedRecipientSafeTransaction, fundRecipientExpectationSchema,
  observeFundRecipientOperation, prepareFundRecipientOperation, recipientSafeTypedData, verifyRecipientSafeSignature, type FundRecipientExpectation, type FundRecipientIntent } from './fund-recipient-chain'
import { canonicalFundRuntime, getCanonicalFundArtifact, getOfficialSafeArtifact } from './fund-setup-artifacts'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { canonicalAdmissionFixture, testAddress, testBlock, testHash, testId, type FundFixtureMutation } from './fund-chain-test-fixtures'

// Ephemeral synthetic signing keys only; this unit fixture is not a provider/EVM or hosted acceptance receipt.
const investor = Wallet.createRandom(), claimKey = Wallet.createRandom(), owners = [Wallet.createRandom(), Wallet.createRandom()]
const ZERO = testAddress(0), txHash = testHash(999), identityAbi = new Interface(getCanonicalFundArtifact('Identity').abi), proxyAbi = new Interface(getCanonicalFundArtifact('IdentityProxy').abi)
const registryAbi = new Interface(getCanonicalFundArtifact('IdentityRegistry').abi), claimAbi = new Interface(getCanonicalFundArtifact('ClaimIssuer').abi), safeAbi = new Interface(getOfficialSafeArtifact('Safe').abi)

async function recipientFixture(phase: FundRecipientExpectation['phase'], mutate?: FundFixtureMutation, expiredClaim = false) {
  const source = canonicalAdmissionFixture({ owners: owners.map(item => item.address.toLowerCase()), claimKey: claimKey.address })
  const candidate = await buildFundAdmissionCandidate(source.input, { rpc: source.rpc })
  const identity = getCreateAddress({ from: investor.address, nonce: 50 }).toLowerCase()
  const expectation: FundRecipientExpectation = {
    operation_id: testId(700), revision: 1, phase, product_id: source.input.setup.product_id, offering_revision_id: source.input.setup.offering_revision_id!,
    investment_account_id: testId(701), wallet_proof_id: testId(702), eligibility_case_id: testId(703), eligibility_revision: 1,
    product_binding_hash: source.input.product_binding_hash, account_binding_hash: 'ed'.repeat(32), eligibility_binding_hash: 'ef'.repeat(32),
    valid_until: expiredClaim ? '2020-01-01T00:00:00Z' : '2100-01-01T00:00:00Z', action_valid_until: '2100-01-01T00:00:00Z',
    recipient_address: investor.address.toLowerCase(), identity_address: phase === 'CREATE_IDENTITY' ? null : identity,
    claim_topic: '1', claim_signer_address: claimKey.address.toLowerCase(), claim_signature: null, country_code: 710,
    sender_address: phase === 'REGISTER_IDENTITY' ? source.input.signer_address : phase === 'REVOKE_CLAIM' ? claimKey.address.toLowerCase() : investor.address.toLowerCase(),
    sender_nonce: '50', safe_nonce: phase === 'REGISTER_IDENTITY' ? '1' : null,
    // Promotion is explicit synthetic input for this adapter test, not actual admission.
    manifest: { ...candidate.manifest, status: 'ADMITTED', safe: { ...candidate.manifest.safe, nonce: '1' } },
  }
  const data = buildFundRecipientClaimData(expectation), claimHash = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes'], [identity, '1', data]))
  if (phase !== 'CREATE_IDENTITY') expectation.claim_signature = (await claimKey.signMessage(getBytes(claimHash))).toLowerCase()
  const claimId = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [candidate.manifest.token_details.claim_issuers[0].address, '1']))
  let completed = false, receipt: Record<string, unknown> | null = null, transaction: Record<string, unknown> | null = null
  const counters = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_getCode' && params[0] === identity) value = phase === 'CREATE_IDENTITY' && !completed ? '0x' : canonicalFundRuntime('IdentityProxy')
    else if (method === 'eth_getCode') {
      const found = Object.entries(candidate.manifest.suite).find(([, item]) => item.address === params[0])
      const names = { token: 'TokenProxy', identity_registry: 'IdentityRegistryProxy', identity_storage: 'IdentityRegistryStorageProxy', trusted_issuers: 'TrustedIssuersRegistryProxy', claim_topics: 'ClaimTopicsRegistryProxy', compliance: 'ModularComplianceProxy' } as const
      value = found ? canonicalFundRuntime(names[found[0] as keyof typeof names]) : await source.rpc(url, method, params)
    } else if (method === 'eth_getTransactionReceipt') value = receipt
    else if (method === 'eth_getTransactionByHash') value = transaction
    else if (method === 'eth_getBlockByNumber' && params[0] !== 'finalized') value = { ...testBlock(BigInt(String(params[0]))), transactions: receipt ? [txHash] : [] }
    else if (method === 'eth_getBlockByNumber') value = { ...testBlock(url === FUNDING_RPC_URLS[0] ? 120n : 123n), transactions: receipt ? [txHash] : [] }
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: string }, at = call.to.toLowerCase()
      const tirAbi = new Interface(getCanonicalFundArtifact('TrustedIssuersRegistry').abi), ctrAbi = new Interface(getCanonicalFundArtifact('ClaimTopicsRegistry').abi)
      const abi = at === identity ? identityAbi : at === candidate.manifest.suite.identity_registry.address ? registryAbi
        : at === candidate.manifest.token_details.claim_issuers[0].address ? claimAbi : at === candidate.manifest.safe.address ? safeAbi
          : at === candidate.manifest.suite.trusted_issuers.address ? tirAbi : at === candidate.manifest.suite.claim_topics.address ? ctrAbi : null
      let parsed = abi?.parseTransaction({ data: call.data }), active = abi
      if (!parsed && at === identity) { active = proxyAbi; parsed = proxyAbi.parseTransaction({ data: call.data }) }
      if (!parsed && [candidate.manifest.suite.identity_registry.address, candidate.manifest.suite.trusted_issuers.address, candidate.manifest.suite.claim_topics.address].includes(at)) {
        active = new Interface(getCanonicalFundArtifact(at === candidate.manifest.suite.identity_registry.address ? 'IdentityRegistryProxy'
          : at === candidate.manifest.suite.trusted_issuers.address ? 'TrustedIssuersRegistryProxy' : 'ClaimTopicsRegistryProxy').abi)
        parsed = active.parseTransaction({ data: call.data })
      }
      const name = parsed?.name
      if (name === 'implementationAuthority') value = proxyAbi.encodeFunctionResult(name, [source.dependencies.oid_authority])
      else if (name === 'version') value = identityAbi.encodeFunctionResult(name, ['2.2.1'])
      else if (name === 'keyHasPurpose') value = active!.encodeFunctionResult(name, [true])
      else if (name === 'isClaimRevoked') value = claimAbi.encodeFunctionResult(name, [phase === 'REVOKE_CLAIM' && completed])
      else if (name === 'isClaimValid') value = claimAbi.encodeFunctionResult(name, [!(phase === 'REVOKE_CLAIM' && completed)])
      else if (name === 'getClaim') value = identityAbi.encodeFunctionResult(name, ['1', 1, candidate.manifest.token_details.claim_issuers[0].address, expectation.claim_signature, data, ''])
      else if (name === 'addClaim') value = identityAbi.encodeFunctionResult(name, [claimId])
      else if (name === 'registerIdentity' || name === 'revokeClaimBySignature') value = '0x'
      else if (name === 'getImplementationAuthority' && [candidate.manifest.suite.identity_registry.address, candidate.manifest.suite.trusted_issuers.address, candidate.manifest.suite.claim_topics.address].includes(at)) value = active!.encodeFunctionResult(name, [source.dependencies.trex_authority])
      else if (name === 'owner' && at === candidate.manifest.suite.identity_registry.address) value = registryAbi.encodeFunctionResult(name, [candidate.manifest.safe.address])
      else if (name === 'identityStorage') value = registryAbi.encodeFunctionResult(name, [candidate.manifest.suite.identity_storage.address])
      else if (name === 'issuersRegistry') value = registryAbi.encodeFunctionResult(name, [candidate.manifest.suite.trusted_issuers.address])
      else if (name === 'topicsRegistry') value = registryAbi.encodeFunctionResult(name, [candidate.manifest.suite.claim_topics.address])
      else if (name === 'isAgent') value = registryAbi.encodeFunctionResult(name, [true])
      else if (name === 'identity') value = registryAbi.encodeFunctionResult(name, [phase === 'REGISTER_IDENTITY' && !completed ? ZERO : identity])
      else if (name === 'investorCountry') value = registryAbi.encodeFunctionResult(name, [710])
      else if (name === 'isVerified') value = registryAbi.encodeFunctionResult(name, [phase === 'REGISTER_IDENTITY' ? completed : !completed])
      else if (name === 'nonce') value = safeAbi.encodeFunctionResult(name, [completed ? 2 : 1])
      else if (name === 'getTrustedIssuerClaimTopics') value = tirAbi.encodeFunctionResult(name, [['1']])
      else if (name === 'getClaimTopics') value = ctrAbi.encodeFunctionResult(name, [['1']])
      else value = await source.rpc(url, method, params)
    } else value = await source.rpc(url, method, params)
    const key = `${url}:${method}:${JSON.stringify(params)}`, count = (counters.get(key) ?? 0) + 1; counters.set(key, count)
    return mutate ? mutate(url, method, params, structuredClone(value), count) : structuredClone(value)
  })
  function log(abi: Interface, name: string, at: string, values: unknown[], index: number) {
    const encoded = abi.encodeEventLog(abi.getEvent(name)!, values)
    return { address: at, topics: encoded.topics, data: encoded.data, removed: false, transactionHash: txHash, blockNumber: '0x64', blockHash: testHash(100), transactionIndex: '0x0', logIndex: `0x${index.toString(16)}` }
  }
  async function executeFixture(intent: FundRecipientIntent, safeFailed = false) {
    completed = true
    let input = intent.transaction_data
    if (phase === 'REGISTER_IDENTITY') {
      const typed = recipientSafeTypedData(intent), signatures = await Promise.all(owners.map(async owner => ({ signer_address: owner.address.toLowerCase(), signature: (await owner.signTypedData(typed.domain, typed.types, typed.message)).toLowerCase() })))
      input = buildSignedRecipientSafeTransaction(intent, signatures).data
    }
    transaction = { hash: txHash, from: expectation.sender_address, to: intent.to, nonce: '0x32', value: '0x0', chainId: '0x13882', input,
      blockNumber: '0x64', blockHash: testHash(100), transactionIndex: '0x0' }
    const logs = phase === 'ADD_CLAIM' ? [log(identityAbi, 'ClaimAdded', identity, [claimId, 1, 1, candidate.manifest.token_details.claim_issuers[0].address, expectation.claim_signature, data, ''], 0)]
      : phase === 'REGISTER_IDENTITY' ? [log(safeAbi, safeFailed ? 'ExecutionFailure' : 'ExecutionSuccess', candidate.manifest.safe.address, [intent.safe_transaction_hash, 0], 0),
        ...(safeFailed ? [] : [log(registryAbi, 'IdentityRegistered', candidate.manifest.suite.identity_registry.address, [expectation.recipient_address, identity], 1)])]
        : phase === 'REVOKE_CLAIM' ? [log(claimAbi, 'ClaimRevoked', candidate.manifest.token_details.claim_issuers[0].address, [expectation.claim_signature], 0)] : []
    receipt = { transactionHash: txHash, from: expectation.sender_address, to: intent.to, contractAddress: phase === 'CREATE_IDENTITY' ? identity : null,
      blockNumber: '0x64', blockHash: testHash(100), transactionIndex: '0x0', status: '0x1', logs }
    return { transaction, receipt }
  }
  return { expectation, rpc, identity, candidate, data, claimHash, executeFixture }
}

describe('canonical recipient identity/claim/registry adapter', () => {
  it('domain-binds the real personal_sign message to chain, product, account, eligibility and expiry', async () => {
    const f = await recipientFixture('ADD_CLAIM')
    const request = buildFundRecipientClaimSigningRequest({ ...f.expectation, claim_signature: null })
    expect(request.message).toBe(f.claimHash); expect(request.expiry_enforced_on_chain).toBe(false)
    const values = AbiCoder.defaultAbiCoder().decode(['bytes32', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'address', 'uint256'], request.claim_data)
    expect(values[1]).toBe(80002n); expect(String(values[5]).toLowerCase()).toBe(investor.address.toLowerCase())
    expect(buildFundRecipientClaimData({ ...f.expectation, account_binding_hash: 'aa'.repeat(32) })).not.toBe(request.claim_data)
    expect(fundRecipientExpectationSchema.safeParse({ ...f.expectation, arbitrary_calldata: '0x6000' }).success).toBe(false)
  })
  it.each(['CREATE_IDENTITY', 'ADD_CLAIM', 'REGISTER_IDENTITY', 'REVOKE_CLAIM'] as const)('prepares and observes exact %s without transmitting', async phase => {
    const f = await recipientFixture(phase), intent = await prepareFundRecipientOperation(f.expectation, { rpc: f.rpc })
    expect(intent.expected_identity_address).toBe(f.identity)
    await f.executeFixture(intent)
    const result = await observeFundRecipientOperation(f.expectation, intent, txHash, { rpc: f.rpc })
    expect(result).toMatchObject({ status: 'FINAL', phase, identity_address: f.identity, expiry_enforced_on_chain: false })
    expect(f.rpc.mock.calls.some(call => /send|sign|write/i.test(call[1]))).toBe(false)
  })
  it('rejects wrong claim signer, topic, identity and modified data', async () => {
    const f = await recipientFixture('ADD_CLAIM')
    for (const change of [{ claim_signer_address: testAddress(88) }, { claim_topic: '2' }, { identity_address: testAddress(89) }, { eligibility_binding_hash: 'aa'.repeat(32) }]) {
      await expect(prepareFundRecipientOperation({ ...f.expectation, ...change }, { rpc: f.rpc })).rejects.toThrow()
    }
  })
  it('does not interpret an expiry field as automatic on-chain revocation, but permits a current repair', async () => {
    const f = await recipientFixture('REVOKE_CLAIM', undefined, true)
    const intent = await prepareFundRecipientOperation(f.expectation, { rpc: f.rpc })
    expect(intent.claim_valid_until).toBe('2020-01-01T00:00:00Z'); expect(intent.valid_until).toBe('2100-01-01T00:00:00Z')
    await f.executeFixture(intent)
    await expect(observeFundRecipientOperation(f.expectation, intent, txHash, { rpc: f.rpc })).resolves.toMatchObject({ status: 'FINAL', registry_verified: false })
  })
  it('requires two distinct actual Safe owner signatures and treats successful outer/failed inner execution as failed', async () => {
    const f = await recipientFixture('REGISTER_IDENTITY'), intent = await prepareFundRecipientOperation(f.expectation, { rpc: f.rpc }), typed = recipientSafeTypedData(intent)
    const owner = owners[0], signed = { signer_address: owner.address.toLowerCase(), signature: (await owner.signTypedData(typed.domain, typed.types, typed.message)).toLowerCase() }
    expect(() => buildSignedRecipientSafeTransaction(intent, [signed])).toThrow()
    expect(() => buildSignedRecipientSafeTransaction(intent, [signed, signed])).toThrow()
    expect(() => verifyRecipientSafeSignature(intent, investor.address.toLowerCase(), signed.signature)).toThrow()
    await f.executeFixture(intent, true)
    await expect(observeFundRecipientOperation(f.expectation, intent, txHash, { rpc: f.rpc })).resolves.toMatchObject({ status: 'FAILED', inner_execution_success: false })
  })
  it('retains unknown transactions and refuses a substituted target/calldata', async () => {
    const f = await recipientFixture('CREATE_IDENTITY'), intent = await prepareFundRecipientOperation(f.expectation, { rpc: f.rpc })
    await expect(observeFundRecipientOperation(f.expectation, intent, txHash, { rpc: f.rpc })).resolves.toMatchObject({ status: 'UNKNOWN' })
    await expect(observeFundRecipientOperation(f.expectation, { ...intent, transaction_data: '0x6000' }, txHash, { rpc: f.rpc })).rejects.toThrow()
  })
  it('rejects revoked claims and provider code disagreement before asking a wallet', async () => {
    const f = await recipientFixture('ADD_CLAIM', (url, method, _params, value) => method === 'eth_getCode' && url === FUNDING_RPC_URLS[1] ? '0x6000' : value)
    await expect(prepareFundRecipientOperation(f.expectation, { rpc: f.rpc })).rejects.toThrow()
  })
})
