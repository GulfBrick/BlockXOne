'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  GovernedOperationReview,
  type ChainOperationDecision,
} from '@/components/chain-operation-review'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  blockXOneApi,
  type ChainOperationApprovalQueueItem,
  type ChainOperationRecord,
  type WhitelistQueueItem,
} from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context-v2'
import { isActionableWhitelistStatus } from '@/lib/token-operations'

type ChainContext = {
  chainId: number | null
  runtimeScope: string
}

type SubmittedEvidence = {
  status: 'EXECUTING' | 'CONFIRMED'
  reference: string | null
  evidenceClass: string
  identityVerified: boolean
  chainMutation: boolean
  admissionStatus: string | null
  requestId: string
  chain: ChainContext | null
}

function runtimeScopeLabel(value: string | undefined) {
  if (value === 'TESTNET') return 'Public testnet'
  if (value === 'LOCAL_PILOT') return 'Private validation network'
  if (value === 'LEGACY_PILOT') return 'Legacy record'
  if (!value || value === 'UNAVAILABLE') return 'Unavailable'
  return value.replaceAll('_', ' ').toLowerCase()
}

const governedIdentityOperationKinds = new Set([
  'DEPLOY_INVESTOR_IDENTITY',
  'ADD_MANAGED_IDENTITY_CLAIM',
  'REGISTER_INVESTOR_IDENTITY',
])

export default function WhitelistManagementPage() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<WhitelistQueueItem[]>([])
  const [makerQueueLoaded, setMakerQueueLoaded] = useState(false)
  const [approvalQueueLoaded, setApprovalQueueLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [chainContexts, setChainContexts] = useState<Record<string, ChainContext>>({})
  const [submittedEvidence, setSubmittedEvidence] = useState<SubmittedEvidence | null>(null)
  const [approvalItems, setApprovalItems] = useState<ChainOperationApprovalQueueItem[]>([])
  const [approvalOperations, setApprovalOperations] = useState<Record<string, ChainOperationRecord>>({})
  const canExecuteWhitelist = user?.permissions?.['tokenops:whitelist'] === true

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    setRequests([])
    setApprovalItems([])
    setApprovalOperations({})
    setMakerQueueLoaded(false)
    setApprovalQueueLoaded(false)
    setError(null)
    try {
      if (!user) {
        throw new Error('Not authenticated')
      }

      const [makerQueueResult, approvalQueueResult] = await Promise.allSettled([
        canExecuteWhitelist
          ? blockXOneApi.token.whitelistQueue(user.token)
          : Promise.resolve([] as WhitelistQueueItem[]),
        blockXOneApi.chainOperation.approvalQueue(user.token),
      ])
      const failures: string[] = []
      const queue = makerQueueResult.status === 'fulfilled' && Array.isArray(makerQueueResult.value)
        ? makerQueueResult.value
        : []
      setMakerQueueLoaded(
        canExecuteWhitelist &&
          makerQueueResult.status === 'fulfilled' &&
          Array.isArray(makerQueueResult.value)
      )
      if (makerQueueResult.status === 'rejected') {
        failures.push(
          makerQueueResult.reason instanceof Error
            ? makerQueueResult.reason.message
            : 'Failed to load whitelist execution work.'
        )
      }
      setRequests(queue)
      const approvalQueue = approvalQueueResult.status === 'fulfilled'
        ? approvalQueueResult.value
        : []
      setApprovalQueueLoaded(
        approvalQueueResult.status === 'fulfilled' && Array.isArray(approvalQueueResult.value)
      )
      if (approvalQueueResult.status === 'rejected') {
        failures.push(
          approvalQueueResult.reason instanceof Error
            ? approvalQueueResult.reason.message
            : 'Failed to load managed identity checker work.'
        )
      }
      const identityApprovals = approvalQueue.filter((item) =>
        governedIdentityOperationKinds.has(item.operation_kind)
      )
      setApprovalItems(identityApprovals)
      const operationResults = await Promise.allSettled(
        identityApprovals.map((item) =>
          blockXOneApi.chainOperation.get(user.token, item.id)
        )
      )
      const operations: Record<string, ChainOperationRecord> = {}
      operationResults.forEach((result) => {
        if (result.status === 'fulfilled') operations[result.value.id] = result.value
      })
      setApprovalOperations(operations)
      const contexts = queue.map((item) => [item.offering_id, {
        chainId: item.chain_id,
        runtimeScope: item.runtime_scope || 'LEGACY_PILOT',
      }] as const)
      setChainContexts(Object.fromEntries(contexts))
      if (failures.length > 0) setError(failures.join(' '))
    } catch (err) {
      setApprovalItems([])
      setApprovalOperations({})
      setMakerQueueLoaded(false)
      setApprovalQueueLoaded(false)
      setError(err instanceof Error ? err.message : 'Failed to load whitelist requests')
    } finally {
      setLoading(false)
    }
  }, [canExecuteWhitelist, user])

  useEffect(() => {
    void fetchRequests()
  }, [fetchRequests])

  const handleExecute = async (request: WhitelistQueueItem) => {
    if (processing || !canExecuteWhitelist) return

    setProcessing(request.id)
    setError(null)
    setMessage(null)

    try {
      if (!user) {
        throw new Error('Not authenticated')
      }

      const data = await blockXOneApi.token.executeWhitelist(
        user.token,
        request.id
      )
      const confirmed = data.status === 'CONFIRMED' && data.identity_verified === true
      setMessage(
        confirmed && data.evidence_class === 'LOCAL_EVM_IDENTITY_VERIFIED_READ'
          ? 'The wallet already has a verified KYC/AML identity on the local EVM. This was a read-only eligibility check, not a transaction.'
          : confirmed
            ? 'Identity eligibility is CONFIRMED from the recorded evidence. Any chain mutation remains subject to its separate receipt and finality proof.'
            : `Identity admission is still ${data.admission_status || data.status}. Eligibility is not confirmed yet.`
      )
      setSubmittedEvidence({
        status: data.status,
        reference: data.reference || null,
        evidenceClass: data.evidence_class,
        identityVerified: data.identity_verified === true,
        chainMutation: data.chain_mutation === true,
        admissionStatus: data.admission_status || null,
        requestId: request.id,
        chain: chainContexts[request.offering_id] || null,
      })
      await fetchRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute whitelist')
    } finally {
      setProcessing(null)
    }
  }

  const decideOperation = async (
    operation: ChainOperationRecord,
    decision: ChainOperationDecision
  ) => {
    if (!user) throw new Error('Not authenticated')
    await blockXOneApi.chainOperation.decide(user.token, operation.id, decision)
    await fetchRequests()
  }

  const pendingRequests = requests.filter(r => isActionableWhitelistStatus(r.status))
  const executingRequests = requests.filter(r => r.status === 'EXECUTING')
  const confirmedRequests = requests.filter(r => r.status === 'CONFIRMED')

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="max-w-7xl mx-auto px-4 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
              <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
              Whitelist Queue
            </div>
            <h1 className="font-display text-4xl font-bold">Whitelist Management</h1>
            <p className="text-bxo-text-secondary">
              Verify wallet eligibility through the configured identity controls and keep chain-finality claims separate.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/tokenisation-agent">Back to Operations</Link>
          </Button>
        </div>

        {message && (
          <Card className={submittedEvidence?.status === 'CONFIRMED' ? 'border-bxo-success/30 bg-bxo-success/10 p-4' : 'border-bxo-warning-border bg-bxo-warning/10 p-4'}>
            <p className={submittedEvidence?.status === 'CONFIRMED' ? 'text-sm text-bxo-success-light' : 'text-sm text-bxo-warning-light'}>{message}</p>
          </Card>
        )}

        <Card className="border-bxo-accent-border bg-bxo-accent-soft p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">Chain environment</div>
          <p className="mt-2 text-sm text-bxo-text-secondary">
            Private validation network checks can return verified read evidence without a transaction. Public testnet mutation claims require a matching receipt and finality evidence.
          </p>
          {submittedEvidence ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-4 text-sm">
              <div><dt className="text-bxo-text-tertiary">Request</dt><dd className="mt-1 break-all font-mono text-xs">{submittedEvidence.requestId}</dd></div>
              <div><dt className="text-bxo-text-tertiary">Target</dt><dd className="mt-1 font-mono text-xs">{runtimeScopeLabel(submittedEvidence.chain?.runtimeScope)} · chain {submittedEvidence.chain?.chainId ?? 'unknown'}</dd></div>
              <div><dt className="text-bxo-text-tertiary">Evidence class</dt><dd className="mt-1 break-all font-mono text-xs">{submittedEvidence.evidenceClass}</dd><p className="mt-1 text-xs text-bxo-text-tertiary">{submittedEvidence.identityVerified ? 'Identity verified' : `Admission ${submittedEvidence.admissionStatus || submittedEvidence.status}`} · {submittedEvidence.chainMutation ? 'governed identity admission' : 'read only'}</p></div>
              <div><dt className="text-bxo-text-tertiary">Returned reference</dt><dd className="mt-1 break-all font-mono text-xs">{submittedEvidence.reference || 'No aggregate evidence reference recorded'}</dd><p className="mt-1 text-xs text-bxo-warning-light">{submittedEvidence.chainMutation ? 'AGGREGATE IDENTITY EVIDENCE · NOT A TRANSACTION HASH' : 'NOT A TRANSACTION'}</p></div>
            </dl>
          ) : null}
        </Card>

        {error && (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-4">
            <p className="text-sm text-bxo-danger-light">{error}</p>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bxo-card p-5">
            <div className="text-sm text-bxo-text-tertiary">Awaiting Execution</div>
            <div className="mt-2 font-display text-3xl font-bold">{makerQueueLoaded ? pendingRequests.length : 'Unknown'}</div>
          </Card>
          <Card className="bxo-card p-5">
            <div className="text-sm text-bxo-text-tertiary">Confirmed Identity Operations</div>
            <div className="mt-2 font-display text-3xl font-bold">{makerQueueLoaded ? confirmedRequests.length : 'Unknown'}</div>
          </Card>
          <Card className="bxo-card p-5">
            <div className="text-sm text-bxo-text-tertiary">Total Requests</div>
            <div className="mt-2 font-display text-3xl font-bold">{makerQueueLoaded ? requests.length : 'Unknown'}</div>
          </Card>
        </div>

        {approvalQueueLoaded && approvalItems.length > 0 ? (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-bold">Managed identity checker queue and history</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">
                Review the complete identity deployment, claim, or registry intent before recording an independent checker decision.
              </p>
            </div>
            {approvalItems.map((item) => {
              const operation = approvalOperations[item.id]
              return operation ? (
                <GovernedOperationReview
                  key={item.id}
                  operation={operation}
                  currentUserId={user?.id}
                  approverRoles={item.approver_roles}
                  decisionRecorded={item.decision_recorded}
                  actionable={item.actionable}
                  onDecide={(decision) => decideOperation(operation, decision)}
                />
              ) : (
                <Card key={item.id} className="border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">
                  Operation {item.id} is visible to your policy role, but its immutable detail is unavailable.
                </Card>
              )
            })}
          </section>
        ) : null}

        <Card className="bxo-card p-6">
          <h2 className="text-xl font-semibold mb-4">Actionable Whitelist Requests</h2>
          
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading requests...</div>
          ) : !makerQueueLoaded ? (
            <div className="text-center py-8 text-bxo-warning-light">
              The authoritative whitelist queue is unavailable. Refresh before treating identity work as clear.
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No requested or retryable whitelist operations.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bxo-border-default">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Wallet Address</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Offering ID</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((request) => (
                    <tr key={request.id} className="border-b border-bxo-border-subtle hover:bg-bxo-accent-soft">
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.address}</div>
                        <div className="text-xs text-muted-foreground">
                          Wallet ID: {request.wallet_id.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.offering_id.substring(0, 8)}...</div>
                        <div className="mt-1 text-xs text-bxo-text-tertiary">
                          {runtimeScopeLabel(chainContexts[request.offering_id]?.runtimeScope || 'Loading')} · chain {chainContexts[request.offering_id]?.chainId ?? 'Not available'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          request.status === 'FAILED'
                            ? 'bg-bxo-danger-soft text-bxo-danger-light'
                            : 'bg-bxo-warning/10 text-bxo-warning-light'
                        }`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          onClick={() => handleExecute(request)}
                          disabled={processing !== null || !canExecuteWhitelist}
                        >
                          {!canExecuteWhitelist
                            ? 'Checker view only'
                            : processing === request.id
                            ? 'Executing...'
                            : request.status === 'FAILED'
                              ? chainContexts[request.offering_id]?.runtimeScope === 'LOCAL_PILOT'
                                ? 'Recheck identity'
                                : 'Retry identity operation'
                              : 'Submit Eligibility'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {executingRequests.length > 0 && (
          <Card className="bxo-card p-6">
            <h2 className="text-xl font-semibold mb-4">Executing Identity Operation</h2>
            <div className="space-y-3">
              {executingRequests.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bxo-border-default p-4">
                  <div>
                    <div className="text-sm font-mono">{request.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Offering {request.offering_id.substring(0, 8)}...
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-bxo-info/10 px-2 py-1 text-xs font-medium text-bxo-info-light">
                      EXECUTING
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExecute(request)}
                      disabled={processing !== null || !canExecuteWhitelist}
                    >
                      {processing === request.id ? 'Refreshing...' : 'Resume and refresh'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {confirmedRequests.length > 0 && (
          <Card className="bxo-card p-6">
            <h2 className="text-xl font-semibold mb-4">Confirmed Whitelists</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bxo-border-default">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Wallet Address</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Offering ID</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedRequests.slice(0, 10).map((request) => (
                    <tr key={request.id} className="border-b border-bxo-border-subtle">
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.address}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.offering_id.substring(0, 8)}...</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center rounded-full bg-bxo-success/10 px-2 py-1 text-xs font-medium text-bxo-success-light">
                          {request.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="bxo-panel p-6">
          <h3 className="mb-3 font-display text-lg font-semibold">Whitelist process</h3>
          <ul className="list-inside list-disc space-y-2 text-sm text-bxo-text-secondary">
            <li>A whitelist request is created during independent subscription approval when an approved same-chain investor wallet exists</li>
            <li>The platform runs the configured identity control and records its evidence class and reference</li>
            <li>Private validation checks can confirm existing EVM identity through read evidence without a transaction</li>
            <li>Queue status CONFIRMED records identity eligibility, not block finality</li>
            <li>A transaction is complete only when durable evidence reaches FINAL with receipt and confirmations</li>
            <li>No mainnet operation is available from this controlled surface</li>
            <li>Every operation is written to the platform audit trail</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
