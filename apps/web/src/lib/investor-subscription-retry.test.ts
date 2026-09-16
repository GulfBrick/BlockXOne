import { describe, expect, it } from 'vitest'

import {
  clearExactInvestorSubscriptionRetryIntent,
  createInvestorSubscriptionRetryIntent,
  investorSubscriptionIntentMatches,
  loadInvestorSubscriptionRetryIntent,
  persistInvestorSubscriptionRetryIntent,
  withAuthoritativeSubscriptionId,
  type InvestorSubscriptionRetryStorage,
} from './investor-subscription-retry'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const offeringId = '33333333-3333-4333-8333-333333333333'
const otherOfferingId = '44444444-4444-4444-8444-444444444444'
const subscriptionId = '55555555-5555-4555-8555-555555555555'

function memoryStorage(): InvestorSubscriptionRetryStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function retryIntent() {
  return createInvestorSubscriptionRetryIntent({
    userId,
    offeringId,
    units: '1.25',
    amount: '31.25',
    idempotencyKey: `subscription:${offeringId}:retry-key`,
  })
}

describe('investor subscription retry intent', () => {
  it('persists and restores only the exact user and offering scope', () => {
    const storage = memoryStorage()
    const intent = retryIntent()
    persistInvestorSubscriptionRetryIntent(storage, intent)

    expect(loadInvestorSubscriptionRetryIntent(storage, userId, offeringId)).toEqual(intent)
    expect(loadInvestorSubscriptionRetryIntent(storage, otherUserId, offeringId)).toBeNull()
    expect(loadInvestorSubscriptionRetryIntent(storage, userId, otherOfferingId)).toBeNull()
  })

  it('reuses a key only for the exact units and computed amount', () => {
    const intent = retryIntent()
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId,
        offeringId,
        units: '1.25',
        amount: '31.25',
      })
    ).toBe(true)
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId,
        offeringId,
        units: '1.250',
        amount: '31.250000000000000000',
      })
    ).toBe(true)
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId,
        offeringId,
        units: '1.251',
        amount: '31.25',
      })
    ).toBe(false)
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId,
        offeringId,
        units: '1.25',
        amount: '31.26',
      })
    ).toBe(false)
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId: otherUserId,
        offeringId,
        units: '1.25',
        amount: '31.25',
      })
    ).toBe(false)
    expect(
      investorSubscriptionIntentMatches(intent, {
        userId,
        offeringId: otherOfferingId,
        units: '1.25',
        amount: '31.25',
      })
    ).toBe(false)
  })

  it('preserves the authoritative subscription ID before exact cleanup', () => {
    const storage = memoryStorage()
    const pending = retryIntent()
    const completed = withAuthoritativeSubscriptionId(pending, subscriptionId)
    persistInvestorSubscriptionRetryIntent(storage, completed)

    expect(clearExactInvestorSubscriptionRetryIntent(storage, pending)).toBe(false)
    expect(loadInvestorSubscriptionRetryIntent(storage, userId, offeringId)).toEqual(completed)
    expect(clearExactInvestorSubscriptionRetryIntent(storage, completed)).toBe(true)
    expect(loadInvestorSubscriptionRetryIntent(storage, userId, offeringId)).toBeNull()
  })

  it('rejects malformed retry records rather than treating them as truth', () => {
    expect(() =>
      createInvestorSubscriptionRetryIntent({
        userId: 'not-a-user-id',
        offeringId,
        units: '1',
        amount: '25.00',
        idempotencyKey: 'retry-key',
      })
    ).toThrow('Invalid investor subscription retry intent.')
  })
})
