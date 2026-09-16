'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, CircleDashed, TriangleAlert } from 'lucide-react'

import { type ChainOperationRecord } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export type ChainOperationDecision = {
  decision: 'APPROVED' | 'REJECTED'
  approver_role: string
  expected_payload_hash: string
  expected_policy_hash: string
  reason: string
  expires_at: string | null
}

type GovernedOperationReviewProps = {
  operation: ChainOperationRecord
  currentUserId?: string
  approverRoles?: string[]
  decisionRecorded?: boolean
  actionable?: boolean
  onDecide?: (decision: ChainOperationDecision) => Promise<void>
}

type Detail = [label: string, value: unknown]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shown(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  if (value === 'TESTNET') return 'Public testnet'
  if (value === 'LOCAL_PILOT') return 'Private validation network'
  if (value === 'TEST_PROVIDER') return 'Stripe test mode'
  if (value === 'SYNTHETIC_TEST') return 'Recorded test evidence'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function payloadDetails(payload: ChainOperationRecord['payload']): Detail[] {
  if (!isObject(payload)) return []

  const candidates: Array<[string, string]> = [
    ['subscription_id', 'Subscription'],
    ['control_id', 'Subscription control'],
    ['offering_id', 'Offering'],
    ['instrument_id', 'Instrument'],
    ['instrument_terms_id', 'Instrument terms'],
    ['instrument_terms_version', 'Terms version'],
    ['instrument_terms_sha256', 'Terms SHA-256'],
    ['asset_class', 'Asset class'],
    ['runtime_scope', 'Network'],
    ['investor_user_id', 'Investor'],
    ['wallet_id', 'Wallet ID'],
    ['wallet_address', 'Wallet address'],
    ['token_contract', 'Token contract'],
    ['requested_asset_base_units', 'Requested asset base units'],
    ['allocation_reservation_id', 'Allocation reservation'],
    ['funding_journal_entry_id', 'Funding journal entry'],
    ['provider_event_id', 'Provider event'],
    ['test_provider_reconciliation_evidence_id', 'Payment reconciliation evidence'],
    ['reconciliation_run_id', 'Reconciliation run'],
    ['reconciliation_sha256', 'Reconciliation SHA-256'],
    ['consideration_source', 'Payment evidence'],
    ['cash_real', 'Real funds accepted?'],
    ['cash_settled', 'Funds settled?'],
    ['subscription_state', 'Subscription state'],
    ['token_release_id', 'Issuance authorization'],
    ['network_manifest_sha256', 'Network manifest SHA-256'],
    ['launch_id', 'Launch ID'],
    ['testnet_parameter_sha256', 'Testnet parameters SHA-256'],
    ['token_standard', 'Token standard'],
    ['token_interface_version', 'Token interface'],
    ['token_name', 'Token name'],
    ['token_symbol', 'Token symbol'],
    ['token_decimals', 'Token decimals'],
    ['identity_registry', 'Identity registry'],
    ['compliance_template', 'Compliance template'],
    ['initial_supply', 'Initial supply'],
    ['network_manifest_id', 'Payload network manifest'],
    ['deployment_manifest_id', 'Payload deployment manifest'],
  ]

  return candidates.flatMap(([key, label]) =>
    Object.prototype.hasOwnProperty.call(payload, key)
      ? [[label, payload[key]] as Detail]
      : []
  )
}

function transactionDetails(payload: ChainOperationRecord['payload']): Detail[] {
  if (!isObject(payload) || !isObject(payload.transaction)) return []
  const transaction = payload.transaction
  const candidates: Array<[string, string]> = [
    ['chain_id', 'Transaction chain'],
    ['to', 'Transaction target'],
    ['value', 'Native value'],
    ['transaction_type', 'Transaction type'],
    ['gas_limit', 'Gas limit'],
    ['gas_price', 'Gas price'],
    ['max_fee_per_gas', 'Maximum fee per gas'],
    ['max_priority_fee_per_gas', 'Maximum priority fee per gas'],
    ['calldata', 'Canonical calldata'],
  ]
  return candidates.flatMap(([key, label]) =>
    Object.prototype.hasOwnProperty.call(transaction, key)
      ? [[label, transaction[key]] as Detail]
      : []
  )
}

function Details({ values }: { values: Detail[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {values.map(([label, value]) => (
        <div key={label} className={label === 'Canonical calldata' ? 'sm:col-span-2' : ''}>
          <dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">
            {label}
          </dt>
          <dd className="mt-1 break-all font-mono text-xs">{shown(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function GovernedOperationReview({
  operation,
  currentUserId,
  approverRoles = [],
  decisionRecorded = false,
  actionable = false,
  onDecide,
}: GovernedOperationReviewProps) {
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [approverRole, setApproverRole] = useState(approverRoles[0] ?? '')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  useEffect(() => {
    if (!approverRoles.includes(approverRole)) {
      setApproverRole(approverRoles[0] ?? '')
    }
  }, [approverRole, approverRoles])

  const intent = useMemo(() => payloadDetails(operation.payload), [operation.payload])
  const transaction = useMemo(
    () => transactionDetails(operation.payload),
    [operation.payload]
  )
  const isRequester = Boolean(
    currentUserId && currentUserId === operation.requested_by_user_id
  )
  const canDecide = Boolean(
    onDecide &&
      actionable &&
      operation.state === 'APPROVAL_PENDING' &&
      !decisionRecorded &&
      !isRequester &&
      approverRoles.length > 0
  )

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canDecide || submitting || !confirmed || !approverRole) return
    if (decision === 'REJECTED' && !reason.trim()) {
      setDecisionError('A rejection reason is required.')
      return
    }

    let expiry: string | null = null
    if (decision === 'APPROVED' && expiresAt) {
      const parsed = new Date(expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        setDecisionError('Approval expiry is not a valid date and time.')
        return
      }
      expiry = parsed.toISOString()
    }

    setSubmitting(true)
    setDecisionError('')
    try {
      await onDecide?.({
        decision,
        approver_role: approverRole,
        expected_payload_hash: operation.payload_hash,
        expected_policy_hash: operation.approval_policy_hash,
        reason: reason.trim(),
        expires_at: decision === 'APPROVED' ? expiry : null,
      })
      setConfirmed(false)
    } catch (caught) {
      setDecisionError(
        caught instanceof Error ? caught.message : 'The checker decision could not be recorded.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="bxo-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold">Immutable operation intent</h3>
          <p className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">
            {operation.id}
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
          operation.state === 'FINAL'
            ? 'border-bxo-success/30 bg-bxo-success/10 text-bxo-success-light'
            : operation.terminal_reason_code
              ? 'border-bxo-danger-border bg-bxo-danger-soft text-bxo-danger-light'
              : 'border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light'
        }`}>
          {operation.state === 'FINAL' ? (
            <BadgeCheck className="h-4 w-4" />
          ) : operation.terminal_reason_code ? (
            <TriangleAlert className="h-4 w-4" />
          ) : (
            <CircleDashed className="h-4 w-4" />
          )}
          {operation.state}
        </span>
      </div>

      <div className="mt-6 space-y-6">
        <Details values={[
          ['Operation kind', operation.operation_kind],
          ['Risk tier', operation.risk_tier],
          ['Chain', operation.chain_id],
          ['Contract', operation.contract_address],
          ['Function selector', operation.selector],
          ['Offering', operation.offering_id],
          ['Tenant organization', operation.tenant_org_id],
          ['Legal-entity organization', operation.legal_entity_org_id],
          ['Requester user', operation.requested_by_user_id],
          ['Requester subject', operation.requested_by_subject],
          ['Case reference', operation.case_reference],
          ['Network manifest', operation.network_manifest_id],
          ['Deployment manifest', operation.deployment_manifest_id],
          ['Payload SHA-256', operation.payload_hash],
          ['Approval policy', operation.approval_policy_id],
          ['Policy SHA-256', operation.approval_policy_hash],
          ['Approvals', `${operation.valid_approvals}/${operation.required_approvals}`],
          ['Idempotency scope', operation.idempotency_scope],
          ['Idempotency key', operation.idempotency_key],
          ['Created', operation.created_at],
          ['Version', operation.version],
        ]} />

        {intent.length > 0 ? (
          <div>
            <h4 className="mb-4 text-sm font-semibold text-bxo-text-secondary">
              Bound business and asset intent
            </h4>
            <Details values={intent} />
          </div>
        ) : null}

        {transaction.length > 0 ? (
          <div>
            <h4 className="mb-4 text-sm font-semibold text-bxo-text-secondary">
              Bound transaction and fee caps
            </h4>
            <Details values={transaction} />
          </div>
        ) : null}

        <div>
          <h4 className="text-sm font-semibold text-bxo-text-secondary">
            Full canonical payload
          </h4>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-bxo-border-default bg-bxo-bg-primary p-4 font-mono text-xs leading-5">
            {JSON.stringify(operation.payload, null, 2)}
          </pre>
        </div>

        <div>
          <h4 className="mb-4 text-sm font-semibold text-bxo-text-secondary">
            Execution and durable proof
          </h4>
          <Details values={[
            ['Signer', operation.signer_address],
            ['Nonce', operation.nonce],
            ['Transaction hash', operation.transaction_hash],
            ['Receipt status', operation.receipt_status],
            ['Confirmations', operation.confirmations],
            ['Finality target', operation.finality_target],
            ['Finalized at', operation.finalized_at],
            ['Terminal code', operation.terminal_reason_code],
            ['Terminal detail', operation.terminal_reason_detail],
            ['Receipt ID', operation.proof?.receipt?.id],
            ['Receipt block', operation.proof?.receipt?.block_number],
            ['Receipt block hash', operation.proof?.receipt?.block_hash],
            ['Receipt canonical state', operation.proof?.receipt?.canonical_state],
            ['Receipt evidence SHA-256', operation.proof?.receipt?.evidence_sha256],
            ['Finality status', operation.proof?.finality?.status],
            ['Observed head', operation.proof?.finality?.observed_head_number],
            ['Safe head', operation.proof?.finality?.safe_head_number],
            ['Finalized head', operation.proof?.finality?.finalized_head_number],
            ['Provider quorum', operation.proof?.finality?.provider_quorum_count],
            ['Provider evidence', operation.proof?.finality?.provider_evidence_hash],
            ['Indexed event', operation.proof?.indexed_event?.name],
            ['Indexed event payload', operation.proof?.indexed_event?.payload],
            ['Controlled position', operation.proof?.projection?.controlled_position_id],
            ['Legal-register entry', operation.proof?.projection?.legal_register_entry_id],
            ['Legal-register SHA-256', operation.proof?.projection?.legal_register_entry_hash],
          ]} />
        </div>
      </div>

      {isRequester && operation.state === 'APPROVAL_PENDING' ? (
        <div className="mt-6 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm text-bxo-warning-light">
          Because you requested this operation, a different authorised approver must review it.
        </div>
      ) : null}

      {decisionRecorded && operation.state === 'APPROVAL_PENDING' ? (
        <div className="mt-6 rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4 text-sm text-bxo-text-secondary">
          Your immutable decision is already recorded. The operation is waiting for any remaining policy-required checker approvals.
        </div>
      ) : null}

      {canDecide ? (
        <form className="mt-6 space-y-4 rounded-xl border border-bxo-border-default p-4" onSubmit={submitDecision}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-bxo-text-secondary">
              Policy-authorized role
              <select
                className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3"
                value={approverRole}
                onChange={(event) => setApproverRole(event.target.value)}
              >
                {approverRoles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-bxo-text-secondary">
              Decision
              <select
                className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3"
                value={decision}
                onChange={(event) => {
                  const next = event.target.value as 'APPROVED' | 'REJECTED'
                  setDecision(next)
                  if (next === 'REJECTED') setExpiresAt('')
                  setConfirmed(false)
                }}
              >
                <option value="APPROVED">Approve</option>
                <option value="REJECTED">Reject</option>
              </select>
            </label>
          </div>

          <label className="block text-sm text-bxo-text-secondary">
            {decision === 'REJECTED' ? 'Rejection reason (required)' : 'Approval rationale (optional)'}
            <textarea
              className="mt-2 min-h-24 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-2"
              value={reason}
              required={decision === 'REJECTED'}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>

          {decision === 'APPROVED' ? (
            <label className="block text-sm text-bxo-text-secondary">
              Approval expiry (optional)
              <input
                type="datetime-local"
                className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
          ) : null}

          <label className="flex items-start gap-3 text-sm leading-6 text-bxo-text-secondary">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed the full canonical payload, requester, case, selector, manifests, transaction target, fee caps, and displayed hashes. I confirm this decision applies to this exact immutable operation.
            </span>
          </label>

          {decisionError ? (
            <p role="alert" className="text-sm text-bxo-danger-light">{decisionError}</p>
          ) : null}

          <Button
            type="submit"
            variant={decision === 'REJECTED' ? 'destructive' : 'default'}
            disabled={
              submitting ||
              !confirmed ||
              !approverRole ||
              (decision === 'REJECTED' && !reason.trim())
            }
          >
            {submitting
              ? 'Recording immutable decision…'
              : decision === 'REJECTED'
                ? 'Reject exact operation'
                : 'Approve exact operation'}
          </Button>
        </form>
      ) : null}
    </Card>
  )
}
