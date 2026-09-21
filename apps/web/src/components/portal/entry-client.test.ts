import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRefreshEntryApplication, readEntryApplicationStatus, reconcileEntryMarker } from './entry-client'
import { entryActorId, entryApplication, entryApplicationId, entryFixture } from '@/lib/portal/entry-test-fixtures'
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

describe('safe read-only application status refresh', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('cannot refresh editable states and makes no request that could replace unsaved values', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    for (const status of ['DRAFT', 'CHANGES_REQUIRED'] as const) {
      const application = entryApplication({ status })
      expect(canRefreshEntryApplication(application)).toBe(false)
      await expect(readEntryApplicationStatus(entryActorId, application)).rejects.toThrow('Finish your edits')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('loads the exact saved application and current decision without writing or deleting command markers', async () => {
    const application = entryApplication({ status: 'SUBMITTED', revision: 2 })
    const updated = { ...application, status: 'CHANGES_REQUIRED' as const, revision: 3, review_notes: 'Clarify the representative evidence.' }
    const snapshot = entryFixture([updated])
    const fetch = vi.fn().mockResolvedValue(Response.json({ snapshot })); vi.stubGlobal('fetch', fetch)
    const result = await readEntryApplicationStatus(entryActorId, application)
    expect(result.applications[0]).toEqual(updated)
    expect(canRefreshEntryApplication(result.applications[0])).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/portal/entry', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': entryActorId } }))
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('method', 'POST')
  })
  it('rejects another actor, another application and an older revision', async () => {
    const application = entryApplication({ status: 'SUBMITTED', revision: 2 })
    const snapshots = [
      { ...entryFixture([application]), actor: { id: entryApplicationId, email: 'other@example.invalid' } },
      entryFixture([{ ...application, user_id: entryApplicationId }]),
      entryFixture([{ ...application, id: '66666666-6666-4666-8666-666666666666' }]),
      entryFixture([{ ...application, revision: 1 }]),
    ]
    for (const snapshot of snapshots) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ snapshot })))
      await expect(readEntryApplicationStatus(entryActorId, application)).rejects.toThrow('could not be verified')
    }
  })
  it('does not present failed or non-JSON reads as a successful refresh', async () => {
    const application = entryApplication({ status: 'SUBMITTED' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Verified sign-in required.' }, { status: 401 })))
    await expect(readEntryApplicationStatus(entryActorId, application)).rejects.toThrow('Verified sign-in required.')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })))
    await expect(readEntryApplicationStatus(entryActorId, application)).rejects.toThrow('Status could not be verified')
  })
})
