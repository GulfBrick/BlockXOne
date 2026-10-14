import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { fundApprovalRequestSchema, fundOperationSchema, fundPreparationRequestSchema, fundSafeSignatureRequestSchema, fundTransactionRequestSchema } from './fund-lifecycle-contracts'
import { prepareExecution, recordExecutionSignature } from './fund-lifecycle-execution'

const id = '00000000-0000-4000-8000-000000000001'
const address = '0x1111111111111111111111111111111111111111'
const context = { mode: 'ROLE' as const, organisationId: id, role: 'TokenisationAgent' as const }
const request = { operation_id: id, expected_revision: 1, operating_context: context }
function deniedClient() {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: '42501' } }) }))
  return { rpc }
}

describe('selected owner is a guarded selector, never authority', () => {
  it('preserves the existing unselected request while accepting a nonzero signing selector only at preparation', () => {
    expect(fundPreparationRequestSchema.parse(request)).toEqual(request)
    expect(fundPreparationRequestSchema.parse({ ...request, signing_address: address }).signing_address).toBe(address)
    expect(fundPreparationRequestSchema.safeParse({ ...request, signing_address: `0x${'0'.repeat(40)}` }).success).toBe(false)
    expect(fundTransactionRequestSchema.safeParse({ ...request, signing_address: address }).success).toBe(false)
  })
  it('does not accept client roles, receipt IDs or arbitrary business payload in approval/signing', () => {
    const approval = { ...request, command: 'approve_fund_deployment', request_key: id, signing_address: address }
    expect(fundApprovalRequestSchema.safeParse(approval).success).toBe(true)
    for (const extra of [{ role: 'SuperAdmin' }, { policy_id: id }, { payload: {} }, { can_execute: true }]) {
      expect(fundApprovalRequestSchema.safeParse({ ...approval, ...extra }).success).toBe(false)
    }
    expect(fundSafeSignatureRequestSchema.safeParse({ ...request, signing_address: address, signature: `0x${'a'.repeat(130)}` }).success).toBe(true)
    expect(fundOperationSchema.shape.signing_owner_addresses.safeParse([address, address.toUpperCase().replace('0X', '0x')]).success).toBe(false)
  })
  it('never sends signature bytes to the preparation RPC or bypasses a database denial', async () => {
    const db = deniedClient(), signature = `0x${'a'.repeat(130)}`
    await expect(recordExecutionSignature(db as unknown as Parameters<typeof recordExecutionSignature>[0], {
      ...request, signing_address: address, signature,
    })).rejects.toMatchObject({ status: 403 })
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_prepare_fund_transaction', { ...request, signing_address: address })
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(signature)
  })
  it('forwards no selector for the preserved legacy preparation', async () => {
    const db = deniedClient()
    await expect(prepareExecution(db as unknown as Parameters<typeof prepareExecution>[0], request)).rejects.toMatchObject({ status: 403 })
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_prepare_fund_transaction', request)
  })
})
