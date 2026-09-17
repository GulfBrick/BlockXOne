// API client used by the Next.js app.
// Protected browser calls authenticate exclusively with the verified JWT session.
import { isLegacyClientAuthDisabled, resolveAuthMode } from './auth-mode'

import type {
  ControlledSubscription,
  ControlledIssuanceResponse,
  ControlledPositionsResponse,
  CreatedControlledSubscription,
  CreateInstrumentRequest,
  FinancialProfileRecord,
  InstrumentRecord,
  InvestorCatalogListItem,
  InvestorCatalogOfferingDetail,
  InvestorCatalogReadiness,
  OfferingReadiness,
  PilotConsiderationSource,
  ReconciliationRecord,
  SyntheticFundingRecord,
  SyntheticStatementRecord,
  TestCheckoutSession,
  TypedOffering,
} from './pilot-finance'
import {
  normalizeInvestorCatalogList,
  normalizeInvestorCatalogOfferingDetail,
  normalizeInvestorCatalogReadiness,
} from './pilot-finance'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export const SESSION_KEY = 'bx_auth_v2';

export class ApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly details?: unknown

  constructor(
    message: string,
    options: { code?: string; status?: number; details?: unknown } = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = options.code ?? 'API_ERROR'
    this.status = options.status
    this.details = options.details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export type MintQueueItem = {
  id: string;
  offering_id: string;
  runtime_scope: 'LOCAL_PILOT' | 'TESTNET';
  chain_id: number;
  user_id: string;
  investor_email: string;
  asset_name: string;
  units: string;
  amount: string;
  currency: string;
  status: 'PAID' | 'MINTED';
  wallet_id: string;
  wallet_address: string;
  wallet_status: string;
  whitelist_status: string;
  mint_chain_operation_id: string;
  created_at: string;
  updated_at: string;
};

export type WhitelistQueueItem = {
  id: string;
  offering_id: string;
  wallet_id: string;
  status: 'REQUESTED' | 'EXECUTING' | 'CONFIRMED' | 'FAILED';
  address: string;
  runtime_scope: string;
  chain_id: number;
};

export type WhitelistExecutionResponse = {
  id: string
  status: 'EXECUTING' | 'CONFIRMED'
  reference?: string
  evidence_class: string
  identity_verified: boolean
  chain_mutation: boolean
  admission_id?: string
  admission_status?: string
  progress?: Record<string, unknown> | unknown[] | string | number | boolean | null
}

export type SubscriptionApprovalQueueItem = {
  id: string;
  offering_id: string;
  user_id: string;
  investor_email: string;
  asset_name: string;
  units: string;
  amount: string;
  currency: string;
  status: 'REQUESTED';
  created_at: string;
};

export type WalletChallengeRequest = {
  address: string;
  chainId: number;
  domain: string;
};

export type WalletChallengeResponse = {
  challenge_id: string;
  message: string;
  expires_at: string;
};

export type WalletConnectRequest = {
  challengeId: string;
  address: string;
  chainId: number;
  message: string;
  signature: string;
};

export type WalletConnectResponse = {
  id?: string;
  status?: string;
};

export type WalletApprovalQueueItem = {
  id: string;
  user_id: string;
  investor_email: string;
  address: string;
  chain_id: number;
  status: 'PENDING';
  kyc_status: string;
  created_at: string;
};

export type SettlementQueueItem = {
  id: string;
  offering_id: string;
  user_id: string;
  investor_email: string;
  asset_name: string;
  units: string;
  amount: string;
  currency: string;
  status: string;
  payment_instruction_id: string;
  method: string;
  bank_ref: string;
  due_at: string | null;
  runtime_scope: string;
  consideration_source: string;
  created_at: string;
};

export type TokenDeploymentQueueItem = {
  id: string
  name: string
  asset_class: string
  runtime_scope: 'LOCAL_PILOT' | 'TESTNET'
  chain_id: number
  token_decimals: number
  terms_sha256: string
  terms_status: string
  token_contract: string
  identity_registry: string
  compliance_contract: string
  deployment_idempotency_key?: string
  deployment_chain_operation_id?: string
  deployment_operation_state?: string
  created_at: string
}

export type ChainOperationProof = {
  available: boolean
  receipt?: {
    id: string
    block_number: number | null
    block_hash: string
    payload_hash: string
    canonical_state: string
    evidence_sha256: string
  }
  finality?: {
    checkpoint_id: string
    status: string
    observed_head_number: number | null
    observed_head_hash: string
    safe_head_number: number | null
    safe_head_hash: string
    finalized_head_number: number | null
    finalized_head_hash: string
    provider_quorum_count: number
    provider_evidence_hash: string
  }
  indexed_event?: {
    id: string
    log_index: number | null
    name: string
    payload: Record<string, unknown> | unknown[] | null
    payload_hash: string
  }
  projection?: {
    controlled_position_id: string
    legal_register_entry_id: string
    legal_register_entry_hash: string
  }
}

export type ChainOperationRecord = {
  id: string
  network_manifest_id: string
  deployment_manifest_id: string
  tenant_org_id: string
  legal_entity_org_id: string
  offering_id: string
  chain_id: number
  network_tier: string
  operation_kind: string
  risk_tier: string
  state: string
  contract_address: string
  selector: string
  payload: Record<string, unknown> | unknown[]
  payload_hash: string
  idempotency_scope: string
  idempotency_key: string
  requested_by_user_id: string
  requested_by_subject: string
  case_reference: string
  approval_policy_id: string
  approval_policy_hash: string
  valid_approvals: number
  required_approvals: number
  has_rejection: boolean
  signer_address: string
  nonce: number | null
  transaction_hash: string
  receipt_status: string
  confirmations: number
  finality_target: number
  terminal_reason_code: string
  terminal_reason_detail: string
  version: number
  created_at: string
  updated_at: string
  finalized_at: string | null
  proof?: ChainOperationProof
}

export type ChainOperationApprovalQueueItem = {
  id: string
  offering_id: string
  operation_kind: string
  state: string
  requested_by_user_id: string
  requested_by_subject: string
  case_reference: string
  approver_roles: string[]
  policy_status: string
  decision_recorded: boolean
  actionable: boolean
  created_at: string
  updated_at: string
  finalized_at: string | null
}

export type ChainOperationCreated = Pick<
  ChainOperationRecord,
  | 'id'
  | 'offering_id'
  | 'chain_id'
  | 'network_tier'
  | 'operation_kind'
  | 'state'
  | 'contract_address'
  | 'payload_hash'
  | 'approval_policy_id'
  | 'approval_policy_hash'
  | 'required_approvals'
> & {
  subscription_id?: string
  network_manifest_id: string
  deployment_manifest_id: string
  idempotent_replay: boolean
}

export type KycCase = {
  id: string;
  user_id: string;
  type: 'KYC' | 'KYB';
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submitted_at: string | null;
  created_at: string;
};

export type KycCurrentCaseResponse = {
  case: KycCase | null;
};

export type OperatorActionItem = {
  key: string;
  label: string;
  description: string;
  count: number;
  href: string;
  owner: string;
  priority: 'high' | 'normal';
};

export type OperatorActivityItem = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_email: string;
  created_at: string;
};

export type OperatorOverview = {
  generated_at: string;
  data_classification: 'EMPTY' | 'OPERATIONAL' | 'SYNTHETIC' | 'MIXED';
  dataset_label: string;
  settlement_mode: 'SIMULATED' | 'LIVE';
  synthetic_records: number;
  capabilities: {
    view_offerings: boolean;
    manage_offerings: boolean;
    publish_offerings: boolean;
    review_compliance: boolean;
    approve_wallets: boolean;
    approve_subscriptions: boolean;
    notify_payments: boolean;
    execute_whitelist: boolean;
    execute_mint: boolean;
    view_holdings: boolean;
    view_audit: boolean;
  };
  queues: {
    offerings: { total: number; draft: number; live: number };
    kyc: { submitted: number };
    wallets: { pending: number };
    subscriptions: { requested: number; approved: number; paid: number; minted: number };
    whitelist: { actionable: number; confirmed: number };
    mint: { paid: number; ready: number; blocked: number };
    holdings: { positions: number };
  };
  action_items: OperatorActionItem[];
  recent_activity: OperatorActivityItem[];
};

type ApiCallOptions = {
  /** @deprecated Identity is taken from the bearer JWT; this value is ignored. */
  userId?: string;
  /** @deprecated Identity is taken from the bearer JWT; this value is ignored. */
  email?: string;
  /** @deprecated Permissions are taken from the bearer JWT; this value is ignored. */
  roles?: string[];
  method?: string;
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
};

type ApiPayloadObject = Record<string, unknown>;

function isPayloadObject(payload: unknown): payload is ApiPayloadObject {
  return typeof payload === 'object' && payload !== null;
}

function getPayloadString(payload: unknown, key: 'error' | 'message') {
  if (!isPayloadObject(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

export function getStoredToken(): string | null {
  if (isLegacyClientAuthDisabled()) return null;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.token.length > 0) return parsed.token;
    // legacy shape: { id, email, roles }
    if (parsed && typeof parsed === 'object' && 'token' in parsed === false) return null;
  } catch {
    /* ignore */
  }
  return null;
}

async function apiCall<T>(endpoint: string, opts: ApiCallOptions = {}): Promise<T> {
  if (isLegacyClientAuthDisabled() || (typeof window === 'undefined' && resolveAuthMode() !== 'legacy')) {
    throw new ApiError('This operation is not enabled.', { code: 'operation_unavailable', status: 503 })
  }
  const url = `${API_BASE}${endpoint}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  const bearer = opts.token || getStoredToken()
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`
  }

  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey
  }

  const method = (opts.method || 'GET').toUpperCase();
  const hasBody = opts.body !== undefined && method !== 'GET';
  if (hasBody) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });

  const contentType = resp.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await resp.json().catch(() => null) : await resp.text().catch(() => '');

  if (!resp.ok) {
    const message =
      getPayloadString(payload, 'error') ??
      getPayloadString(payload, 'message') ??
      `HTTP ${resp.status}`;

    throw new ApiError(message, {
      status: resp.status,
      details: payload,
    })
  }

  return payload as T;
}

export const authApi = {
  me: (_userId?: string, _email?: string, _roles?: string[]) => {
    void _userId
    void _email
    void _roles
    return apiCall('/v1/me')
  },
  meWithToken: (token: string) => apiCall('/v1/me', { token }),
};

export const offeringApi = {
  list: (token: string) =>
    apiCall<TypedOffering[]>('/v1/offerings', { token }),
  get: (token: string, offeringId: string) =>
    apiCall<TypedOffering>(`/v1/offerings/${offeringId}`, { token }),
  listAll: (token: string) => apiCall<TypedOffering[]>('/v1/offerings/all', { token }),
  createTyped: (
    token: string,
    data: {
      instrument_id: string
      instrument_terms_id: string
      runtime_scope: 'LOCAL_PILOT' | 'TESTNET'
      chain_id: number
      price: string
      currency: string
      tenant_org_id: string
      legal_entity_org_id: string
      transfer_agent_org_id?: string
      tokenisation_agent_org_id?: string
    },
    idempotencyKey: string
  ) =>
    apiCall<TypedOffering>('/v1/offerings', {
      token,
      method: 'POST',
      body: data,
      idempotencyKey,
    }),
  publish: (token: string, offeringId: string) =>
    apiCall<{ id: string; status: string }>(`/v1/offerings/${offeringId}/publish`, {
      token,
      method: 'POST',
      body: {},
    }),
  deployLocalERC3643: (
    token: string,
    offeringId: string,
    data: {
      symbol: string
      decimals: number
      idempotency_key: string
    }
  ) =>
    apiCall<{
      id: string
      token_contract: string
      identity_registry: string
      compliance: string
      tx_hash: string
    }>(`/v1/offerings/${offeringId}/deploy-erc3643`, {
      token,
      method: 'POST',
      body: {
        ...data,
        initial_supply: '0',
      },
    }),
  readiness: (token: string, offeringId: string) =>
    apiCall<OfferingReadiness>(`/v1/offerings/${offeringId}/readiness`, { token }),
  prepareFinancialProfile: (
    token: string,
    offeringId: string,
    data: {
      currency_scale: number
      price_per_whole_unit_base_units: string
      minimum_subscription_base_units: string
      maximum_subscription_base_units: string
      allocation_capacity_base_units: string
      payment_due_seconds: number
      consideration_source: PilotConsiderationSource
    }
  ) =>
    apiCall<FinancialProfileRecord>(`/v1/offerings/${offeringId}/financial-profiles`, {
      token,
      method: 'POST',
      body: data,
    }),
  activateFinancialProfile: (
    token: string,
    offeringId: string,
    profileId: string
  ) =>
    apiCall<FinancialProfileRecord>(
      `/v1/offerings/${offeringId}/financial-profiles/${profileId}/activate`,
      { token, method: 'POST', body: {} }
    ),
};

function invalidInvestorCatalogResponse(): never {
  throw new ApiError('The investor catalog response is invalid.', {
    code: 'INVALID_INVESTOR_CATALOG_RESPONSE',
  })
}

export const investorCatalogApi = {
  list: async (token: string): Promise<InvestorCatalogListItem[]> => {
    const payload = await apiCall<unknown>('/v1/offerings', { token })
    return normalizeInvestorCatalogList(payload) ?? invalidInvestorCatalogResponse()
  },
  get: async (
    token: string,
    offeringId: string
  ): Promise<InvestorCatalogOfferingDetail> => {
    const payload = await apiCall<unknown>(`/v1/offerings/${offeringId}`, { token })
    return (
      normalizeInvestorCatalogOfferingDetail(payload) ??
      invalidInvestorCatalogResponse()
    )
  },
  readiness: async (
    token: string,
    offeringId: string
  ): Promise<InvestorCatalogReadiness> => {
    const payload = await apiCall<unknown>(
      `/v1/offerings/${offeringId}/readiness`,
      { token }
    )
    return normalizeInvestorCatalogReadiness(payload) ?? invalidInvestorCatalogResponse()
  },
};

export const instrumentApi = {
  list: (token: string) => apiCall<InstrumentRecord[]>('/v1/instruments', { token }),
  get: (token: string, instrumentId: string) =>
    apiCall<InstrumentRecord>(`/v1/instruments/${instrumentId}`, { token }),
  create: (token: string, data: CreateInstrumentRequest) =>
    apiCall<InstrumentRecord>('/v1/instruments', {
      token,
      method: 'POST',
      body: data,
    }),
  prepareTerms: (
    token: string,
    instrumentId: string,
    data: Omit<
      CreateInstrumentRequest,
      | 'asset_class'
      | 'runtime_scope'
      | 'name'
      | 'description'
      | 'tenant_org_id'
      | 'legal_entity_org_id'
    >
  ) =>
    apiCall<InstrumentRecord>(`/v1/instruments/${instrumentId}/terms`, {
      token,
      method: 'POST',
      body: data,
    }),
  approveTerms: (
    token: string,
    instrumentId: string,
    termsId: string
  ) =>
    apiCall<InstrumentRecord>(
      `/v1/instruments/${instrumentId}/terms/${termsId}/approve`,
      { token, method: 'POST', body: {} }
    ),
};

export const subscriptionApi = {
  create: (
    userId: string,
    email: string,
    offeringId: string,
    data: { units: string | number; amount: string | number }
  ) =>
    apiCall(`/v1/offerings/${offeringId}/subscribe`, {
      method: 'POST',
      body: { units: String(data.units), amount: String(data.amount) },
    }),
  get: (_userId: string, _email: string, subscriptionId: string) =>
    apiCall(`/v1/subscriptions/${subscriptionId}`),
  approvalQueue: (token: string) =>
    apiCall<SubscriptionApprovalQueueItem[]>(
      '/v1/subscription-operations/approval-queue?status=CREATED',
      { token }
    ),
  approve: (token: string, subscriptionId: string) =>
    apiCall(`/v1/subscriptions/${subscriptionId}/approve`, {
      token,
      method: 'POST',
      body: {},
    }),
  createControlled: (
    token: string,
    offeringId: string,
    data: { units: string; amount: string },
    idempotencyKey: string
  ) =>
    apiCall<CreatedControlledSubscription>(`/v1/offerings/${offeringId}/subscribe`, {
      token,
      method: 'POST',
      body: data,
      idempotencyKey,
    }),
  getControlled: (token: string, subscriptionId: string) =>
    apiCall<ControlledSubscription>(`/v1/subscriptions/${subscriptionId}`, { token }),
  createTestCheckout: (token: string, subscriptionId: string) =>
    apiCall<TestCheckoutSession>(`/v1/subscriptions/${subscriptionId}/checkout-session`, {
      token,
      method: 'POST',
      body: {},
    }),
  startReconciliation: (
    token: string,
    subscriptionId: string,
    idempotencyKey: string
  ) =>
    apiCall<ReconciliationRecord>(
      `/v1/subscriptions/${subscriptionId}/reconciliations`,
      { token, method: 'POST', body: {}, idempotencyKey }
    ),
  approveReconciliation: (
    token: string,
    subscriptionId: string,
    runId: string
  ) =>
    apiCall<ReconciliationRecord>(
      `/v1/subscriptions/${subscriptionId}/reconciliations/${runId}/approve`,
      { token, method: 'POST', body: {} }
    ),
  latestReconciliation: (token: string, subscriptionId: string) =>
    apiCall<ReconciliationRecord>(
      `/v1/subscriptions/${subscriptionId}/reconciliation`,
      { token }
    ),
};

export const portfolioApi = {
  get: (_userId: string, _email: string) => {
    void _userId
    void _email
    return apiCall('/v1/portfolio')
  },
  controlledPositions: (token: string) =>
    apiCall<ControlledPositionsResponse>('/v1/controlled-positions', { token }),
};

export const kycApi = {
  workflow: () => apiCall('/v1/kyc/workflows/basic-v3', { method: 'GET' }),
  currentCase: (token: string) =>
    apiCall<KycCurrentCaseResponse>('/v1/kyc/cases/current', { token }),
  createCase: (token: string, caseType: 'KYC' | 'AML' | 'FATCA') => {
    // Backend supports KYC|KYB. Map other demo options to KYC.
    const type = caseType === 'KYC' ? 'KYC' : 'KYC';
    return apiCall('/v1/kyc/cases', { token, method: 'POST', body: { type } });
  },
  submitCase: (token: string, caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}/submit`, { token, method: 'POST', body: {} }),
  getCase: (token: string, caseId: string) =>
    apiCall<KycCase>(`/v1/kyc/cases/${caseId}`, { token }),
};

export const walletApi = {
  challenge: (token: string, data: WalletChallengeRequest) =>
    apiCall<WalletChallengeResponse>('/v1/wallets/challenge', {
      token,
      method: 'POST',
      body: {
        address: data.address,
        chain_id: data.chainId,
        domain: data.domain,
      },
    }),
  connect: (
    token: string,
    data: WalletConnectRequest
  ) =>
    apiCall<WalletConnectResponse>('/v1/wallets/connect', {
      token,
      method: 'POST',
      body: {
        challenge_id: data.challengeId,
        address: data.address,
        chain_id: data.chainId,
        message: data.message,
        signature: data.signature,
      },
    }),
  list: () => apiCall('/v1/wallets'),
  approvalQueue: (token: string) =>
    apiCall<WalletApprovalQueueItem[]>('/v1/compliance/wallet-queue', { token }),
  approve: (token: string, walletId: string) =>
    apiCall(`/v1/wallets/${walletId}/approve`, {
      token,
      method: 'POST',
      body: {},
    }),
  reject: (token: string, walletId: string) =>
    apiCall(`/v1/wallets/${walletId}/reject`, {
      token,
      method: 'POST',
      body: {},
    }),
};

export const marketplaceApi = {
  listListings: (userId: string, email: string) => apiCall('/v1/marketplace/listings', { userId, email }),
  createListing: (
    userId: string,
    email: string,
    roles: string[],
    data: { offeringId: string; walletId: string; units: string | number; pricePerUnit: string | number }
  ) =>
    apiCall('/v1/marketplace/listings', {
      userId,
      email,
      roles,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        wallet_id: data.walletId,
        units: String(data.units),
        price: String(data.pricePerUnit),
        currency: 'USD',
      },
    }),
  listRfq: (userId: string, email: string) => apiCall('/v1/marketplace/rfq', { userId, email }),
  createRfq: (userId: string, email: string, data: { offeringId: string; units: string | number; maxPrice: string | number }) =>
    apiCall('/v1/marketplace/rfq', {
      userId,
      email,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        wallet_id: '',
        units: String(data.units),
        max_price: String(data.maxPrice),
        currency: 'USD',
      },
    }),
};

export const tokenApi = {
  mint: (userId: string, email: string, roles: string[], subscriptionId: string, token?: string) =>
    apiCall('/v1/token-batches/mint', {
      userId,
      email,
      roles,
      token,
      method: 'POST',
      body: { subscription_id: subscriptionId },
    }),
  mintQueue: (token: string, status: 'PAID' | 'MINTED' = 'PAID') =>
    apiCall<MintQueueItem[]>(`/v1/token-operations/mint-queue?status=${status}`, { token }),
  whitelistQueue: (token: string) =>
    apiCall<WhitelistQueueItem[]>('/v1/token-operations/whitelist-queue', { token }),
  deploymentQueue: (token: string) =>
    apiCall<TokenDeploymentQueueItem[]>('/v1/token-operations/deployment-queue', {
      token,
    }),
  executeWhitelist: (token: string, requestId: string) =>
    apiCall<WhitelistExecutionResponse>(`/v1/whitelist-requests/${requestId}/execute`, {
      token,
      method: 'POST',
      body: {},
    }),
  getNAV: (userId: string, email: string, offeringId: string) => apiCall(`/v1/offerings/${offeringId}/nav`, { userId, email }),
  controlledMint: (
    token: string,
    subscriptionId: string,
    idempotencyKey: string
  ) =>
    apiCall<ControlledIssuanceResponse>(
      `/v1/local-pilot/subscriptions/${subscriptionId}/mint`,
      { token, method: 'POST', body: {}, idempotencyKey }
    ),
  controlledIssuance: (token: string, subscriptionId: string) =>
    apiCall<ControlledIssuanceResponse>(
      `/v1/local-pilot/subscriptions/${subscriptionId}/issuance`,
      { token }
    ),
};

export const redemptionApi = {
  request: (
    userId: string,
    email: string,
    data: { offeringId: string; amountTokens: string | number; amountCash: string | number }
  ) =>
    apiCall('/v1/redemptions/request', {
      userId,
      email,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        amount_tokens: String(data.amountTokens),
        amount_cash: String(data.amountCash),
      },
    }),
  get: (userId: string, email: string, redemptionId: string) => apiCall(`/v1/redemptions/${redemptionId}`, { userId, email }),
};

export const paymentApi = {
  settlementQueue: (token: string) =>
    apiCall<SettlementQueueItem[]>('/v1/payment-operations/queue', { token }),
  notify: (
    userId: string,
    email: string,
    roles: string[],
    data: { subscriptionId: string; method: string; amount: number; reference: string; timestamp?: string }
  ) =>
    apiCall('/v1/payments/notify', {
      userId,
      email,
      roles,
      method: 'POST',
      body: {
        subscription_id: data.subscriptionId,
        method: data.method,
        amount: String(data.amount),
        reference: data.reference,
      },
    }),
  applySyntheticFunding: (
    token: string,
    subscriptionId: string,
    data: {
      provider_event_id: string
      provider_object_id: string
      amount_base_units: string
      currency: string
      occurred_at: string
    },
    idempotencyKey: string
  ) =>
    apiCall<SyntheticFundingRecord>(
      `/v1/local-pilot/subscriptions/${subscriptionId}/synthetic-funding`,
      { token, method: 'POST', body: data, idempotencyKey }
    ),
  recordSyntheticStatement: (
    token: string,
    subscriptionId: string,
    data: {
      statement_entry_id: string
      amount_base_units: string
      currency: string
      value_at: string
    },
    idempotencyKey: string
  ) =>
    apiCall<SyntheticStatementRecord>(
      `/v1/local-pilot/subscriptions/${subscriptionId}/synthetic-statements`,
      { token, method: 'POST', body: data, idempotencyKey }
    ),
};

export const chainOperationApi = {
  approvalQueue: (token: string) =>
    apiCall<ChainOperationApprovalQueueItem[]>(
      '/v1/chain-operations/approval-queue',
      { token }
    ),
  get: (token: string, operationId: string) =>
    apiCall<ChainOperationRecord>(`/v1/chain-operations/${operationId}`, { token }),
  requestDeployment: (
    token: string,
    offeringId: string,
    data: {
      chain_id: number
      case_reference: string
      gas_limit: string
      max_fee_per_gas: string
      max_priority_fee_per_gas: string
    },
    idempotencyKey: string
  ) =>
    apiCall<ChainOperationCreated>(
      `/v1/offerings/${offeringId}/chain-operations/deploy`,
      { token, method: 'POST', body: data, idempotencyKey }
    ),
  requestMint: (
    token: string,
    subscriptionId: string,
    data: {
      case_reference: string
      gas_limit: string
      max_fee_per_gas: string
      max_priority_fee_per_gas: string
    },
    idempotencyKey: string
  ) =>
    apiCall<ChainOperationCreated>(
      `/v1/subscriptions/${subscriptionId}/chain-operations/mint`,
      { token, method: 'POST', body: data, idempotencyKey }
    ),
  decide: (
    token: string,
    operationId: string,
    data: {
      decision: 'APPROVED' | 'REJECTED'
      approver_role: string
      expected_payload_hash: string
      expected_policy_hash: string
      reason: string
      expires_at: string | null
    }
  ) =>
    apiCall(`/v1/chain-operations/${operationId}/approvals`, {
      token,
      method: 'POST',
      body: data,
    }),
};

export const transactionApi = {
  list: (userId: string, email: string, roles?: string[]) => apiCall('/v1/transactions', { userId, email, roles }),
  listSubscriptions: (userId: string, email: string, roles: string[]) =>
    apiCall('/v1/debug/subscriptions', { userId, email, roles }),
};

export const operatorApi = {
  overview: (token: string) =>
    apiCall<OperatorOverview>('/v1/operator/overview', { token }),
};

export const healthApi = {
  check: () => apiCall('/healthz'),
};

export const blockXOneApi = {
  auth: authApi,
  offering: offeringApi,
  investorCatalog: investorCatalogApi,
  instrument: instrumentApi,
  subscription: subscriptionApi,
  portfolio: portfolioApi,
  kyc: kycApi,
  wallet: walletApi,
  marketplace: marketplaceApi,
  token: tokenApi,
  redemption: redemptionApi,
  payment: paymentApi,
  transaction: transactionApi,
  operator: operatorApi,
  chainOperation: chainOperationApi,
  health: healthApi,
};
