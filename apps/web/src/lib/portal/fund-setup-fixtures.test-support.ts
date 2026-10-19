import { fundSetupStepKeys, type FundSetupSnapshot } from './fund-setup-contracts'

// Deliberately synthetic source-test records. Never imported by a runtime page.
export const setupFixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const setupFixtureAddress = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
export const setupFixtureActor = setupFixtureId(1), setupFixtureProduct = setupFixtureId(2), setupFixtureSetup = setupFixtureId(3)
export const setupFixtureContext = { mode: 'ROLE' as const, organisationId: setupFixtureId(4), role: 'OfferingManager' as const }
export function setupFixture(): FundSetupSnapshot {
  return { schema_version: 1, actor_id: setupFixtureActor, environment: 'TESTNET', operating_context: setupFixtureContext,
    observed_at: '2026-10-14T10:00:00Z', product_id: setupFixtureProduct, product_revision: 1,
    offering_revision_id: setupFixtureId(5), terms_hash: 'a'.repeat(64), configuration_hash: 'b'.repeat(64),
    source_pin: 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4', roleplay_policy: null, availability: 'AVAILABLE', reason_code: null,
    setup: { id: setupFixtureSetup, revision: 1, actor_id: setupFixtureActor, operating_context: setupFixtureContext,
      state: 'READY', recovery_hold: false, recovery_reason: null, recovery_observation_id: null,
      expires_at: '2099-01-01T00:00:00Z', safe_address: setupFixtureAddress(2), safe_state: 'VERIFIED',
      safe_owners: [setupFixtureAddress(3), setupFixtureAddress(4)], safe_threshold: 2,
      configuration: { safe_address: setupFixtureAddress(2), identity_management_key: setupFixtureAddress(3), claim_management_key: setupFixtureAddress(4),
        token_management_key: setupFixtureAddress(5), maximum_holding_base_units: '100000', tst_initial_holder: setupFixtureAddress(6), tst_initial_supply_base_units: '3000000000' },
      setup_configuration_hash: 'c'.repeat(64), safe_configuration: null, safe_creation: null, dependencies: {},
      steps: fundSetupStepKeys.map((step_key, index) => ({ id: setupFixtureId(10 + index), step_key, ordinal: index + 1,
        kind: ['trex_version', 'trex_factory_binding', 'ia_factory_binding', 'oid_factory_binding', 'factory_handoff', 'trex_authority_handoff', 'oid_authority_handoff', 'oid_factory_handoff'].includes(step_key) ? 'CALL' : 'CREATE',
        revision: 1, state: 'NOT_STARTED', actor_id: null, sender: null, nonce: null, intent_hash: null, intent: null,
        expires_at: null, claimed_at: null, transaction_hash: null, deployed_address: null, observation_id: null, reason_code: null })),
      next_step: 'token_implementation', saved_intent: null, admission_reason: 'RELEASE_CONFORMANCE_AND_GOVERNANCE_RECEIPTS_REQUIRED' },
  }
}
