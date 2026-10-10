import { describe, expect, it, vi } from 'vitest'
import { mayDiscardDeniedPortalRequest, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
const actor = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const organisationId = '33333333-3333-4333-8333-333333333333'
const command = { command: 'cancel_subscription' as const, key, payload: { subscription_id: key } }
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: vi.fn((key: string) => { values.delete(key) }) } }
const applicant = { operatingContext: { mode: 'APPLICANT' } as PortalOperatingContext, environment: 'TESTNET' as const }
const investor = { operatingContext: { mode: 'ROLE', organisationId, role: 'Investor' } as PortalOperatingContext, environment: 'TESTNET' as const }
describe('context-bound request recovery', () => {
  it('does not discard an uncertain prior attempt after a later permission or validation denial', () => {
    expect(mayDiscardDeniedPortalRequest(true, true)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(false, true)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(false, false)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(true, false)).toBe(true)
  })
  it('isolates saved keys by environment and selected role, without erasing another context', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [], applicant)
    await prepareDurablePortalCommand(saved, actor, { ...command, key: actor }, [], investor)
    await prepareDurablePortalCommand(saved, actor, command, [], { ...investor, environment: 'MAINNET' })
    expect(saved.values.size).toBe(3)
    expect(reconcilePortalMarker(saved, actor, [{ key, command: command.command }], investor)).not.toBeNull()
    expect(saved.values.size).toBe(3)
    expect(reconcilePortalMarker(saved, actor, [{ key, command: command.command }], applicant)).toBeNull()
    expect(saved.values.size).toBe(2)
  })
  it('binds identical payload digests to the original context', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [], applicant)
    await prepareDurablePortalCommand(saved, actor, command, [], investor)
    expect(new Set([...saved.values.values()].map(value => JSON.parse(value).payloadHash)).size).toBe(2)
  })
  it('retains a previous-version marker rather than silently issuing a replacement', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [])
    await expect(prepareDurablePortalCommand(saved, actor, command, [], applicant)).rejects.toThrow('previous platform version')
    expect(saved.values.size).toBe(1)
  })
})
