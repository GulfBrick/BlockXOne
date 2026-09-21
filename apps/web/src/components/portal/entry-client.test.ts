import { describe, expect, it } from 'vitest'
import { reconcileEntryMarker } from './entry-client'
import { entryActorId, entryApplicationId } from '@/lib/portal/entry-test-fixtures'
const key = '44444444-4444-4444-8444-444444444444'
const marker = { key, command: 'submit_application' as const, hash: 'a'.repeat(64) }
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const storageKey = `bx1-entry:TESTNET:${entryActorId}:pending-request`
describe('entry reload and unknown-result reconciliation', () => {
  it('clears a committed original request on reload only from its exact server receipt', () => {
    const saved = storage(); saved.setItem(storageKey, JSON.stringify(marker))
    expect(reconcileEntryMarker(saved, entryActorId, 'TESTNET', [{ key, command: 'submit_application', application_id: entryApplicationId }])).toBeNull()
    expect(saved.getItem(storageKey)).toBeNull()
  })
  it('does not discard an unresolved original key for a similar application or different command', () => {
    const saved = storage(); saved.setItem(storageKey, JSON.stringify(marker))
    expect(reconcileEntryMarker(saved, entryActorId, 'TESTNET', [{ key, command: 'start_application', application_id: entryApplicationId }])).toEqual(marker)
    expect(reconcileEntryMarker(saved, entryActorId, 'TESTNET', [])).toEqual(marker)
    expect(saved.getItem(storageKey)).not.toBeNull()
  })
  it('keeps receipt reconciliation isolated by actor and environment', () => {
    const saved = storage(); saved.setItem(storageKey, JSON.stringify(marker))
    const receipts = [{ key, command: 'submit_application' as const, application_id: entryApplicationId }]
    reconcileEntryMarker(saved, entryActorId, 'MAINNET', receipts)
    reconcileEntryMarker(saved, entryApplicationId, 'TESTNET', receipts)
    expect(saved.getItem(storageKey)).not.toBeNull()
  })
  it('fails closed on corrupted markers instead of manufacturing a replacement request', () => {
    const saved = storage(); saved.setItem(storageKey, '{broken')
    expect(() => reconcileEntryMarker(saved, entryActorId, 'TESTNET', [])).toThrow()
    expect(saved.getItem(storageKey)).toBe('{broken')
  })
})
