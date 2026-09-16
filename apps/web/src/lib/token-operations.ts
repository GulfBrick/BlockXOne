import type { MintQueueItem } from './api-client'
import { managedTestnet } from './managed-testnets'

const ACTIONABLE_WHITELIST_STATUSES = new Set(['REQUESTED', 'FAILED'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function localDeploymentIdempotencyKey(offeringId: string): string {
  const normalized = offeringId.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error('Local deployment requires an exact offering UUID.')
  }
  return `local-token-deploy:${normalized}`
}

export function mintIdempotencyKey(
  subscriptionId: string,
  managedTestnet: boolean
): string {
  const normalized = subscriptionId.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error('Mint recovery requires an exact subscription UUID.')
  }
  return `${managedTestnet ? 'managed-testnet-mint' : 'controlled-local-mint'}:${normalized}`
}

export function isActionableWhitelistStatus(status: string): boolean {
  return ACTIONABLE_WHITELIST_STATUSES.has(status.toUpperCase())
}

export function isMintQueueItemReady(item: MintQueueItem): boolean {
  return item.status === 'PAID'
    && item.wallet_status === 'APPROVED'
    && item.whitelist_status === 'CONFIRMED'
}

export function isMintQueueItemForRuntime(
  item: MintQueueItem,
  managedTestnetRuntime: boolean
): boolean {
  if (managedTestnetRuntime) {
    return item.runtime_scope === 'TESTNET' && managedTestnet(item.chain_id) !== undefined
  }
  return item.runtime_scope === 'LOCAL_PILOT'
    && (item.chain_id === 1337 || item.chain_id === 31337)
}

export function mintOperationIDForSubscription(
  items: MintQueueItem[],
  subscriptionId: string
): string | null {
  const normalizedSubscriptionID = subscriptionId.trim()
  const operationID = items.find(
    (item) => item.id === normalizedSubscriptionID
  )?.mint_chain_operation_id?.trim()
  return operationID || null
}
