'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, RefreshCw, Rocket, ShieldCheck } from 'lucide-react'

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
  type TokenDeploymentQueueItem,
} from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context-v2'
import { isManagedTestnetRuntime } from '@/lib/runtime-scope'
import { localDeploymentIdempotencyKey } from '@/lib/token-operations'

const governedDeploymentKind = 'DEPLOY_BXO_TESTNET_TOKEN_FROM_TEMPLATE'

type DeploymentEvidence = {
  tokenContract: string
  identityRegistry: string
  compliance: string
  transactionHash: string
}

function symbolFor(item: TokenDeploymentQueueItem) {
  const prefix =
    item.asset_class === 'PRIVATE_DEBT_NOTE'
      ? 'BXOD'
      : item.asset_class === 'FUND_INTEREST'
        ? 'BXOF'
        : 'BXOR'
  return `${prefix}${item.id.replaceAll('-', '').slice(0, 6).toUpperCase()}`
}

function pretty(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback
}

export default function LocalTokenDeploymentPage() {
  const { user, loading: authLoading } = useAuth()
  const managedTestnet = isManagedTestnetRuntime()
  const canDeploy = managedTestnet && user?.permissions?.['tokenops:deploy_bxo_testnet_token'] === true
  const [items, setItems] = useState<TokenDeploymentQueueItem[]>([])
  const [approvalItems, setApprovalItems] = useState<ChainOperationApprovalQueueItem[]>([])
  const [evidence, setEvidence] = useState<Record<string, DeploymentEvidence>>({})
  const [operations, setOperations] = useState<Record<string, ChainOperationRecord>>({})
  const [loading, setLoading] = useState(true)
  const [deploymentQueueLoaded, setDeploymentQueueLoaded] = useState(false)
  const [approvalQueueLoaded, setApprovalQueueLoaded] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [messageFinal, setMessageFinal] = useState(false)

  const load = useCallback(async () => {
    if (!user) {
      setItems([])
      setApprovalItems([])
      setOperations({})
      setDeploymentQueueLoaded(false)
      setApprovalQueueLoaded(false)
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    setItems([])
    setApprovalItems([])
    setOperations({})
    setDeploymentQueueLoaded(false)
    setApprovalQueueLoaded(false)
    const failures: string[] = []

    try {
      const [deploymentResult, approvalResult] = await Promise.allSettled([
        canDeploy
          ? blockXOneApi.token.deploymentQueue(user.token)
          : Promise.resolve([] as TokenDeploymentQueueItem[]),
        managedTestnet
          ? blockXOneApi.chainOperation.approvalQueue(user.token)
          : Promise.resolve([] as ChainOperationApprovalQueueItem[]),
      ])

      const deploymentQueue = deploymentResult.status === 'fulfilled'
        ? deploymentResult.value
        : []
      setDeploymentQueueLoaded(deploymentResult.status === 'fulfilled')
      if (deploymentResult.status === 'rejected') {
        failures.push(errorMessage(deploymentResult.reason, 'Unable to load deployment work.'))
      }

      const checkerQueue = approvalResult.status === 'fulfilled'
        ? approvalResult.value.filter(
            (item) => item.operation_kind === governedDeploymentKind
          )
        : []
      setApprovalQueueLoaded(approvalResult.status === 'fulfilled')
      if (approvalResult.status === 'rejected') {
        failures.push(errorMessage(approvalResult.reason, 'Unable to load checker work.'))
      }

      const scoped = deploymentQueue.filter((item) =>
        managedTestnet
          ? item.runtime_scope === 'TESTNET'
          : item.runtime_scope === 'LOCAL_PILOT'
      )
      setItems(scoped)
      setApprovalItems(checkerQueue)

      if (managedTestnet) {
        const operationIDs = Array.from(new Set([
          ...scoped.flatMap((item) =>
            item.deployment_chain_operation_id
              ? [item.deployment_chain_operation_id]
              : []
          ),
          ...checkerQueue.map((item) => item.id),
        ]))
        const operationResults = await Promise.allSettled(
          operationIDs.map((operationID) =>
            blockXOneApi.chainOperation.get(user.token, operationID)
          )
        )
        const nextOperations: Record<string, ChainOperationRecord> = {}
        operationResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            nextOperations[result.value.id] = result.value
          } else {
            failures.push(
              `Operation ${operationIDs[index]}: ${errorMessage(result.reason, 'status unavailable')}`
            )
          }
        })
        setOperations(nextOperations)
      } else {
        setOperations({})
      }

      if (failures.length > 0) setError(failures.join(' '))
    } catch (caught) {
      setItems([])
      setApprovalItems([])
      setOperations({})
      setDeploymentQueueLoaded(false)
      setApprovalQueueLoaded(false)
      setError(errorMessage(caught, 'Unable to load the deployment workspace.'))
    } finally {
      setLoading(false)
    }
  }, [canDeploy, managedTestnet, user])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  async function deploy(item: TokenDeploymentQueueItem) {
    if (!user || !canDeploy || workingId || item.token_contract) return
    setWorkingId(item.id)
    setError('')
    setMessage('')
    setMessageFinal(false)
    try {
      if (managedTestnet) {
        if (!item.deployment_idempotency_key) {
          throw new Error('The governed deployment idempotency binding is missing.')
        }
        const created = await blockXOneApi.chainOperation.requestDeployment(
          user.token,
          item.id,
          {
            chain_id: item.chain_id,
            case_reference: `BXO-TESTNET-DEPLOY-${item.id}`,
            gas_limit: '12000000',
            max_fee_per_gas: '120000000000',
            max_priority_fee_per_gas: '80000000000',
          },
          item.deployment_idempotency_key
        )
        const operation = await blockXOneApi.chainOperation.get(user.token, created.id)
        setOperations((current) => ({ ...current, [operation.id]: operation }))
        const complete = operation.state === 'FINAL' && operation.proof?.available === true
        setMessageFinal(complete)
        if (complete) {
          setMessage(`${item.name} has a FINAL public testnet deployment operation with authoritative proof.`)
        } else if (operation.state === 'APPROVAL_PENDING') {
          setMessage(`${created.idempotent_replay ? 'Existing' : 'New'} deployment operation for ${item.name} is awaiting an independent checker decision on its immutable intent.`)
        } else {
          setMessage(`Deployment operation for ${item.name} was ${created.idempotent_replay ? 'recovered' : 'created'} in ${operation.state}. No new checker action is claimed unless the authoritative state is APPROVAL_PENDING.`)
        }
        await load()
        return
      }

      const result = await blockXOneApi.offering.deployLocalERC3643(
        user.token,
        item.id,
        {
          symbol: symbolFor(item),
          decimals: item.token_decimals,
          idempotency_key: localDeploymentIdempotencyKey(item.id),
        }
      )
      setEvidence((current) => ({
        ...current,
        [item.id]: {
          tokenContract: result.token_contract,
          identityRegistry: result.identity_registry,
          compliance: result.compliance,
          transactionHash: result.tx_hash,
        },
      }))
      setMessage(
        `${item.name} now has a zero-supply local ERC-3643 contract. The offering can be published only after its independent financial-profile approval is ACTIVE.`
      )
      setMessageFinal(true)
      await load()
    } catch (caught) {
      setError(errorMessage(caught, 'Token deployment request failed.'))
    } finally {
      setWorkingId('')
    }
  }

  async function decideOperation(
    operation: ChainOperationRecord,
    decision: ChainOperationDecision
  ) {
    if (!user || !managedTestnet) throw new Error('A verified session in the admitted testnet environment is required.')
    setError('')
    setMessage('')
    setMessageFinal(false)
    await blockXOneApi.chainOperation.decide(user.token, operation.id, decision)
    const refreshed = await blockXOneApi.chainOperation.get(user.token, operation.id)
    setOperations((current) => ({ ...current, [refreshed.id]: refreshed }))
    setMessageFinal(refreshed.state === 'FINAL' && refreshed.proof?.available === true)
    setMessage(
      `${decision.decision === 'APPROVED' ? 'Approval' : 'Rejection'} recorded against the exact payload and policy hashes. Operation state is ${refreshed.state}.`
    )
    await load()
  }

  const hasVisibleWork = items.length > 0 || approvalItems.length > 0
  const queueStateKnown =
    (!canDeploy || deploymentQueueLoaded) &&
    (!managedTestnet || approvalQueueLoaded)

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tokenisation-agent">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to token operations
          </Link>
        </Button>

        <header className="bxo-panel p-6 sm:p-8">
          <div className="bxo-kicker">
            {managedTestnet ? 'Public testnet' : 'Private validation network'}
          </div>
          <h1 className="mt-3 font-display text-4xl font-bold">
            {managedTestnet
              ? 'BXO identity-aware testnet token deployment'
              : 'ERC-3643 deployment workspace'}
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-bxo-text-secondary">
            {managedTestnet
              ? 'Makers create approval-gated deployment operations. Independently authorized checkers discover work from the bound approval policy and review the full immutable payload before approving or rejecting it.'
              : 'Deploy typed offerings with zero initial supply on the private validation chain. The backend binds each deployment to the bootstrap identity registry and compliance manifest.'}
          </p>
        </header>

        <Card className="border-bxo-warning-border bg-bxo-warning/10 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-warning" />
            <p className="text-sm leading-6 text-bxo-text-secondary">
              {managedTestnet
                ? 'A request or approval is not a deployment. This workspace preserves the operation state and the exact receipt and finality evidence returned by the control plane; absent child-event or bytecode proof is shown as not recorded.'
                : 'This private validation network uses synthetic evidence and carries no real value. It does not broadcast to a public testnet or mainnet. Initial supply is always zero; exact units are minted only after subscription reconciliation.'}
            </p>
          </div>
        </Card>

        {error ? (
          <Card role="alert" className="border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">
            {error}
          </Card>
        ) : null}
        {message ? (
          <Card role="status" className={messageFinal ? 'border-bxo-success/30 bg-bxo-success/10 p-4 text-sm text-bxo-success-light' : 'border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm text-bxo-warning-light'}>
            {message}
          </Card>
        ) : null}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void load()} disabled={loading || Boolean(workingId)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>

        {loading ? (
          <Card className="bxo-card p-8 text-bxo-text-secondary">Loading deployment work…</Card>
        ) : !queueStateKnown ? (
          <Card className="border-bxo-warning-border bg-bxo-warning/10 p-8 text-center">
            <ShieldCheck className="mx-auto h-9 w-9 text-bxo-warning" />
            <h2 className="mt-4 font-display text-2xl font-bold">Deployment queue status unavailable</h2>
            <p className="mt-2 text-sm text-bxo-text-secondary">
              Refresh the workspace before relying on maker or checker queue status.
            </p>
          </Card>
        ) : !hasVisibleWork ? (
          <Card className="bxo-card p-10 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-bxo-success" />
            <h2 className="mt-4 font-display text-2xl font-bold">No deployment work is visible</h2>
            <p className="mt-2 text-sm text-bxo-text-secondary">
              Maker drafts require a deployment permission; checker work appears only when your live organization membership matches a role in the operation policy.
            </p>
          </Card>
        ) : null}

        {!loading && items.length > 0 ? (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-bold">Maker deployment requests</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">
                These offerings are assigned to your tokenisation-agent organization.
              </p>
            </div>
            {items.map((item) => {
              const receipt = evidence[item.id]
              const operationID = item.deployment_chain_operation_id
              const operation = operationID ? operations[operationID] : undefined
              const deployed = Boolean(item.token_contract)
              return (
                <div key={item.id} className="space-y-4">
                  <Card className="bxo-card p-5">
                    <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-xl font-bold">{item.name}</h3>
                          <span className="rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-xs text-bxo-accent-primary">
                            {pretty(item.asset_class)}
                          </span>
                          <span className="rounded-full border border-bxo-border-default px-3 py-1 font-mono text-xs">
                            chain {item.chain_id}
                          </span>
                        </div>
                        <p className="break-all font-mono text-xs text-bxo-text-tertiary">
                          Terms {item.terms_status} · decimals {item.token_decimals} · SHA-256 {item.terms_sha256 || 'pending post-deployment'}
                        </p>
                        <dl className="grid gap-3 text-sm sm:grid-cols-2">
                          <div><dt className="text-bxo-text-tertiary">Offering</dt><dd className="mt-1 break-all font-mono">{item.id}</dd></div>
                          <div><dt className="text-bxo-text-tertiary">Token</dt><dd className="mt-1 break-all font-mono">{item.token_contract || 'Not deployed'}</dd></div>
                          <div><dt className="text-bxo-text-tertiary">Identity registry</dt><dd className="mt-1 break-all font-mono">{item.identity_registry || 'Awaiting deployment'}</dd></div>
                          <div><dt className="text-bxo-text-tertiary">Compliance</dt><dd className="mt-1 break-all font-mono">{item.compliance_contract || 'Awaiting deployment'}</dd></div>
                          {receipt ? <div className="sm:col-span-2"><dt className="text-bxo-text-tertiary">Deployment transaction</dt><dd className="mt-1 break-all font-mono">{receipt.transactionHash}</dd></div> : null}
                        </dl>
                      </div>
                      <Button
                        onClick={() => void deploy(item)}
                        disabled={
                          !canDeploy ||
                          deployed ||
                          Boolean(operationID) ||
                          (!managedTestnet && item.terms_status !== 'ACTIVE') ||
                          Boolean(workingId)
                        }
                      >
                        <Rocket className="mr-2 h-4 w-4" />
                        {workingId === item.id
                          ? 'Submitting…'
                          : deployed
                            ? 'Contract recorded'
                            : operationID
                              ? 'Operation created'
                              : managedTestnet
                                ? 'Request deployment approval'
                                : 'Deploy zero supply'}
                      </Button>
                    </div>
                  </Card>
                  {managedTestnet && operation ? (
                    <GovernedOperationReview
                      operation={operation}
                      currentUserId={user?.id}
                    />
                  ) : null}
                </div>
              )
            })}
          </section>
        ) : null}

        {!loading && managedTestnet && approvalItems.length > 0 ? (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-bold">Policy-role checker queue and history</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">
                Discovery comes from each immutable approval policy. It does not grant a deployment maker permission, and completed operations remain available as evidence history.
              </p>
            </div>
            {approvalItems.map((item) => {
              const operation = operations[item.id]
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
                  Operation {item.id} is policy-visible, but its immutable detail response is unavailable.
                </Card>
              )
            })}
          </section>
        ) : null}
      </div>
    </main>
  )
}
