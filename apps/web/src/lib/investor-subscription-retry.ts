import { parseExactDecimal } from './exact-decimal'

export type InvestorSubscriptionRetryIntent = {
  version: 1
  userId: string
  offeringId: string
  units: string
  amount: string
  idempotencyKey: string
  subscriptionId?: string
}

export type InvestorSubscriptionRetryStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const STORAGE_PREFIX = 'blockxone:investor-subscription-retry:v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.\d+)?$/

function retryStorageKey(userId: string, offeringId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(offeringId)}`
}

function isRetryIntent(value: unknown): value is InvestorSubscriptionRetryIntent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<InvestorSubscriptionRetryIntent>
  return (
    candidate.version === 1 &&
    typeof candidate.userId === 'string' &&
    UUID_PATTERN.test(candidate.userId) &&
    typeof candidate.offeringId === 'string' &&
    UUID_PATTERN.test(candidate.offeringId) &&
    typeof candidate.units === 'string' &&
    DECIMAL_PATTERN.test(candidate.units) &&
    typeof candidate.amount === 'string' &&
    DECIMAL_PATTERN.test(candidate.amount) &&
    typeof candidate.idempotencyKey === 'string' &&
    candidate.idempotencyKey.length > 0 &&
    candidate.idempotencyKey.length <= 200 &&
    (candidate.subscriptionId === undefined ||
      (typeof candidate.subscriptionId === 'string' && UUID_PATTERN.test(candidate.subscriptionId)))
  )
}

function exactRetryIntentMatch(
  left: InvestorSubscriptionRetryIntent,
  right: InvestorSubscriptionRetryIntent
): boolean {
  return (
    left.version === right.version &&
    left.userId === right.userId &&
    left.offeringId === right.offeringId &&
    left.units === right.units &&
    left.amount === right.amount &&
    left.idempotencyKey === right.idempotencyKey &&
    left.subscriptionId === right.subscriptionId
  )
}

export function createInvestorSubscriptionRetryIntent(input: {
  userId: string
  offeringId: string
  units: string
  amount: string
  idempotencyKey: string
}): InvestorSubscriptionRetryIntent {
  const intent: InvestorSubscriptionRetryIntent = { version: 1, ...input }
  if (!isRetryIntent(intent)) throw new Error('Invalid investor subscription retry intent.')
  return intent
}

export function loadInvestorSubscriptionRetryIntent(
  storage: InvestorSubscriptionRetryStorage,
  userId: string,
  offeringId: string
): InvestorSubscriptionRetryIntent | null {
  try {
    const raw = storage.getItem(retryStorageKey(userId, offeringId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRetryIntent(parsed)) return null
    if (parsed.userId !== userId || parsed.offeringId !== offeringId) return null
    return parsed
  } catch {
    return null
  }
}

export function persistInvestorSubscriptionRetryIntent(
  storage: InvestorSubscriptionRetryStorage,
  intent: InvestorSubscriptionRetryIntent
): void {
  if (!isRetryIntent(intent)) throw new Error('Invalid investor subscription retry intent.')
  storage.setItem(retryStorageKey(intent.userId, intent.offeringId), JSON.stringify(intent))
}

export function investorSubscriptionIntentMatches(
  intent: InvestorSubscriptionRetryIntent,
  input: { userId: string; offeringId: string; units: string; amount: string }
): boolean {
  const intentUnits = parseExactDecimal(intent.units)?.canonical
  const inputUnits = parseExactDecimal(input.units)?.canonical
  const intentAmount = parseExactDecimal(intent.amount)?.canonical
  const inputAmount = parseExactDecimal(input.amount)?.canonical
  return (
    intent.userId === input.userId &&
    intent.offeringId === input.offeringId &&
    intentUnits !== undefined &&
    intentUnits === inputUnits &&
    intentAmount !== undefined &&
    intentAmount === inputAmount
  )
}

export function withAuthoritativeSubscriptionId(
  intent: InvestorSubscriptionRetryIntent,
  subscriptionId: string
): InvestorSubscriptionRetryIntent {
  const completed = { ...intent, subscriptionId }
  if (!isRetryIntent(completed)) throw new Error('Invalid authoritative subscription ID.')
  return completed
}

export function clearExactInvestorSubscriptionRetryIntent(
  storage: InvestorSubscriptionRetryStorage,
  expected: InvestorSubscriptionRetryIntent
): boolean {
  const current = loadInvestorSubscriptionRetryIntent(
    storage,
    expected.userId,
    expected.offeringId
  )
  if (!current || !exactRetryIntentMatch(current, expected)) return false
  try {
    storage.removeItem(retryStorageKey(expected.userId, expected.offeringId))
    return true
  } catch {
    return false
  }
}
