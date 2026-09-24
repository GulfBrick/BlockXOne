import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only',()=>({}))
const mocks = vi.hoisted(()=>({ load:vi.fn(), check:vi.fn(), user:vi.fn(), mfa:vi.fn(), hasTotp:vi.fn(), recent:vi.fn(), current:vi.fn() }))
vi.mock('./context',()=>({ loadAdministrationContext:mocks.load, checkAdministrationContext:mocks.check }))
vi.mock('@/lib/supabase/server',()=>({ readVerifiedUser:mocks.user }))
vi.mock('@/lib/supabase/mfa',()=>({ readMfaContext:mocks.mfa, hasCurrentTotp:mocks.hasTotp,
  requireRecentTotp:mocks.recent, isMfaContextCurrent:mocks.current }))
import { staffInvitationAction } from './staff-invitations'

const org = '10000000-0000-4000-8000-000000000001'
const invite = '30000000-0000-4000-8000-000000000001'
const key = '90000000-0000-4000-8000-000000000001'
let rpc: ReturnType<typeof vi.fn>
let invoke: ReturnType<typeof vi.fn>
let client: SupabaseClient
beforeEach(()=>{
  mocks.load.mockResolvedValue({context:{},projection:{}})
  mocks.check.mockResolvedValue({allowed:true})
  mocks.user.mockResolvedValue({id:'20000000-0000-4000-8000-000000000001',email:'staff@example.invalid',email_confirmed_at:'2026-09-24T00:00:00Z',is_anonymous:false})
  mocks.mfa.mockResolvedValue({})
  mocks.hasTotp.mockReturnValue(true)
  mocks.recent.mockReturnValue({allowed:true})
  mocks.current.mockResolvedValue(true)
  rpc = vi.fn().mockReturnValue({abortSignal:vi.fn().mockResolvedValue({data:{ok:true,state:'ACCEPTED'},error:null})})
  invoke = vi.fn().mockResolvedValue({data:{ok:true,state:'INVITED'},error:null})
  client = {rpc,functions:{invoke}} as unknown as SupabaseClient
})

describe('first-time staff invitation web boundary',()=>{
  it('rejects AAL1 acceptance before any role-grant RPC',async()=>{
    mocks.hasTotp.mockReturnValue(false)
    const result = await staffInvitationAction(client,new URLSearchParams({intent:'accept',invitationId:invite}))
    expect(result).toEqual({ok:false,error:'mfa_required'})
    expect(rpc).not.toHaveBeenCalled()
  })
  it('passes only exact reviewed proposal fields to the guarded command',async()=>{
    const result = await staffInvitationAction(client,new URLSearchParams({intent:'propose',organisationId:org,
      requestKey:key,email:'  STAFF@example.invalid ',role:'ComplianceOfficer',expectedScopeRevision:'1'}))
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('bx1_staff_invitation_command',{target_organisation:org,request_key:key,
      command:{intent:'propose',email:'staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'}})
    expect(mocks.check).toHaveBeenCalledWith(client,{},'administration.propose',org)
  })
  it('does not invoke provider send after an independent guard denial',async()=>{
    mocks.check.mockResolvedValue({allowed:false,reason:'forbidden'})
    expect(await staffInvitationAction(client,new URLSearchParams({intent:'dispatch',organisationId:org,invitationId:invite})))
      .toEqual({ok:false,error:'forbidden'})
    expect(invoke).not.toHaveBeenCalled()
  })
  it('routes unknown dispatch outcome to reconciliation, never a retry',async()=>{
    invoke.mockResolvedValue({data:null,error:{message:'opaque provider failure'}})
    expect(await staffInvitationAction(client,new URLSearchParams({intent:'dispatch',organisationId:org,invitationId:invite})))
      .toEqual({ok:false,error:'outcome_unknown'})
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('uses a separate evidence-only reconciliation RPC',async()=>{
    rpc.mockReturnValue({abortSignal:vi.fn().mockResolvedValue({data:{ok:true,state:'INVITED'},error:null})})
    expect(await staffInvitationAction(client,new URLSearchParams({intent:'reconcile',organisationId:org,invitationId:invite})))
      .toEqual({ok:true,state:'INVITED'})
    expect(rpc).toHaveBeenCalledWith('bx1_staff_invitation_reconcile',{target_organisation:org,invitation_id:invite})
    expect(invoke).not.toHaveBeenCalled()
  })
})
