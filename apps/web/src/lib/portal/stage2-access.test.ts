import { describe, expect, it } from 'vitest'
import { hasStage2CommandAccess, isTestPasswordAdmission, stage2AccessSchema, validatedStage2Access } from './stage2-access'
const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const context = { mode: 'APPLICANT' as const }
const access = { version: 1 as const, environment: 'TESTNET' as const, actor_id: actor, operating_context: context, session_mode: 'TEST_PASSWORD' as const, allowed_commands: ['create_entity_investment_account' as const] }
const snapshot = () => ({ actor: { id: actor }, operating_context: context, stage2_access: access })
describe('normal admission projection', () => {
  it('allows an existing exact-context entity command, not finance or another actor', () => {
    expect(isTestPasswordAdmission(snapshot())).toBe(true)
    expect(hasStage2CommandAccess(snapshot(), 'create_entity_investment_account', context)).toBe(true)
    expect(hasStage2CommandAccess(snapshot(), 'reconcile_funding', context)).toBe(false)
    expect(validatedStage2Access({ ...snapshot(), actor: { id: other } })).toBeNull()
  })
  it('rejects MAIN password, duplicates, unknown fields and out-of-context commands', () => {
    for (const delta of [{ environment: 'MAINNET' }, { allowed_commands: ['create_entity_investment_account', 'create_entity_investment_account'] }, { allowed_commands: ['review_application'] }, { financial_authority: true }]) {
      expect(stage2AccessSchema.safeParse({ ...access, ...delta }).success).toBe(false)
    }
  })
  it('does not reinterpret legacy rehearsal or absent projections as normal authority', () => {
    expect(validatedStage2Access({ ...snapshot(), rehearsal: undefined })).toBeNull()
    expect(validatedStage2Access({ actor: { id: actor } })).toBeNull()
    expect(validatedStage2Access(snapshot(), context, 'MAINNET')).toBeNull()
    expect(validatedStage2Access(snapshot(), { mode: 'ROLE', organisationId: other, role: 'ComplianceOfficer' })).toBeNull()
  })
  it('separates scoped review from scoped apply and applicant requests', () => {
    for (const [role, command] of [['ComplianceOfficer', 'review_application'], ['SuperAdmin', 'apply_representative_mandate']] as const) {
      const operating_context = { mode: 'ROLE' as const, organisationId: other, role }
      const value = { ...access, operating_context, allowed_commands: [command] }
      expect(stage2AccessSchema.safeParse(value).success).toBe(true)
      expect(stage2AccessSchema.safeParse({ ...value, allowed_commands: ['submit_application'] }).success).toBe(false)
    }
  })
})
