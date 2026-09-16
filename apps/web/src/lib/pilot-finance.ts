export const PILOT_ASSET_CLASSES = [
  'PRIVATE_DEBT_NOTE',
  'FUND_INTEREST',
  'REAL_ESTATE_SPV_INTEREST',
] as const

export type PilotAssetClass = (typeof PILOT_ASSET_CLASSES)[number]
export type PilotRuntimeScope = 'LOCAL_PILOT' | 'TESTNET'
export type PilotConsiderationSource = 'SYNTHETIC_TEST' | 'TEST_PROVIDER' | 'REAL_PROVIDER'

export type CommonInstrumentTerms = {
  currency: string
  token_decimals: number
  authorized_units_base_units: string
  issue_date: string
  governing_law: string
}

export type PrivateDebtTerms = {
  face_value_base_units: string
  annual_coupon_bps: number
  coupon_frequency_months: number
  day_count_convention: string
  maturity_date: string
  seniority: string
  secured: boolean
}

export type FundInterestTerms = {
  share_class: string
  nav_currency: string
  nav_frequency: string
  dealing_frequency: string
  distribution_policy: string
  redemption_notice_days: number
}

export type RealEstateSpvTerms = {
  spv_name: string
  property_identifier: string
  property_jurisdiction: string
  valuation_currency: string
  valuation_base_units: string
  valuation_as_of: string
  ownership_rights: string
  distribution_policy: string
}

export type InstrumentTerms = {
  id: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | string
  terms_sha256: string
  common_terms: CommonInstrumentTerms
  private_debt_terms?: PrivateDebtTerms | null
  fund_interest_terms?: FundInterestTerms | null
  real_estate_spv_terms?: RealEstateSpvTerms | null
  prepared_by_user_id: string
  approved_by_user_id: string | null
  approved_at: string | null
}

export type InstrumentRecord = {
  id: string
  tenant_org_id: string
  legal_entity_org_id: string
  asset_class: PilotAssetClass
  runtime_scope: PilotRuntimeScope
  name: string
  description: string
  terms?: InstrumentTerms | InstrumentTerms[]
  active_terms?: InstrumentTerms | null
  draft_terms?: InstrumentTerms | null
}

export type CreateInstrumentRequest = {
  asset_class: PilotAssetClass
  runtime_scope: PilotRuntimeScope
  chain_id: number
  name: string
  description: string
  tenant_org_id?: string
  legal_entity_org_id: string
  common_terms: CommonInstrumentTerms
  private_debt_terms?: PrivateDebtTerms
  fund_interest_terms?: FundInterestTerms
  real_estate_spv_terms?: RealEstateSpvTerms
}

export type OfferingReadiness = {
  offering_id: string
  offering_status: string
  runtime_scope: PilotRuntimeScope
  asset_class: PilotAssetClass
  terms_approved: boolean
  instrument_terms_id: string
  instrument_terms_version: number
  instrument_terms_sha256: string
  financial_profile: {
    id: string
    status: 'DRAFT' | 'ACTIVE'
    terms_version: number
    terms_sha256: string
    consideration_source: PilotConsiderationSource
    prepared_by_user_id: string
    approved_by_user_id: string | null
    approved_at: string | null
    activated_at: string | null
  } | null
  financial_profile_active: boolean
  token_deployed: boolean
  token_contract: string | null
  publish_ready: boolean
  subscription_enabled: boolean
  cash_real: false
  cash_settled: false
}

export type TypedOffering = {
  id: string
  status: string
  runtime_scope: PilotRuntimeScope
  tenant_org_id: string
  legal_entity_org_id: string
  transfer_agent_org_id?: string
  tokenisation_agent_org_id?: string
  offering_manager_user_id?: string
  instrument_id: string
  instrument_terms: InstrumentTerms
  chain_id: number | null
  price: string | null
  currency: string
  token_contract: string
  compliance_registry: string
  deployment_transaction_hash: string
  asset_type: PilotAssetClass
  name: string
  description: string
}

export type InvestorCatalogTerms = {
  version: number
  terms_sha256: string
  common_terms: CommonInstrumentTerms
  private_debt_terms?: PrivateDebtTerms
  fund_interest_terms?: FundInterestTerms
  real_estate_spv_terms?: RealEstateSpvTerms
}

export type InvestorCatalogFinancialProfile = {
  price_per_whole_unit_base_units: string
  minimum_subscription_asset_units: string
  maximum_subscription_asset_units: string
  allocation_capacity_asset_units: string
  currency_code: string
  currency_scale: number
  payment_method: 'SYNTHETIC_TEST' | 'STRIPE'
  provider_kind: 'PAYMENT'
  provider_name: 'blockxone-local-pilot' | 'stripe'
  provider_environment: 'TEST' | 'STAGING'
  consideration_source: 'SYNTHETIC_TEST' | 'TEST_PROVIDER'
  payment_due_seconds: number
}

export type InvestorCatalogReadiness = {
  offering_live: boolean
  terms_active: boolean
  financial_profile_active: boolean
  token_deployed: boolean
  subscription_ready: boolean
}

function catalogBaseUnits(value: string, allowZero = false): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const parsed = BigInt(value)
  return parsed > 0n || (allowZero && parsed === 0n) ? parsed : null
}

function catalogDecimalBaseUnits(value: string, scale: number): bigint | null {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18) return null
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match) return null
  const fraction = match[2] ?? ''
  if (fraction.length > scale) return null
  return BigInt(`${match[1]}${fraction.padEnd(scale, '0')}`)
}

function renderCatalogDecimal(value: bigint, scale: number): string {
  const digits = value.toString()
  if (scale === 0) return digits
  const padded = digits.padStart(scale + 1, '0')
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`
}

export function quoteInvestorCatalogSubscription(
  units: string,
  terms: InvestorCatalogTerms,
  profile: InvestorCatalogFinancialProfile
): string | null {
  const assetScale = terms.common_terms.token_decimals
  const currencyScale = profile.currency_scale
  const assetBaseUnits = catalogDecimalBaseUnits(units, assetScale)
  const priceBaseUnits = catalogBaseUnits(
    profile.price_per_whole_unit_base_units
  )
  const minimumBaseUnits = catalogBaseUnits(
    profile.minimum_subscription_asset_units
  )
  const maximumBaseUnits = catalogBaseUnits(
    profile.maximum_subscription_asset_units
  )
  if (
    assetBaseUnits === null ||
    assetBaseUnits <= 0n ||
    priceBaseUnits === null ||
    minimumBaseUnits === null ||
    maximumBaseUnits === null ||
    minimumBaseUnits > maximumBaseUnits ||
    assetBaseUnits < minimumBaseUnits ||
    assetBaseUnits > maximumBaseUnits ||
    !Number.isSafeInteger(currencyScale) ||
    currencyScale < 0 ||
    currencyScale > 18
  ) {
    return null
  }

  const denominator = 10n ** BigInt(assetScale)
  const numerator = assetBaseUnits * priceBaseUnits
  if (numerator % denominator !== 0n) return null
  const currencyBaseUnits = numerator / denominator
  if (currencyBaseUnits <= 0n) return null
  return renderCatalogDecimal(currencyBaseUnits, currencyScale)
}

export type InvestorCatalogListItem = {
  id: string
  status: 'LIVE'
  runtime_scope: PilotRuntimeScope
  asset_class: PilotAssetClass
  name: string
  description: string
  chain_id: number
  token_contract: string
  price: string
  currency: string
  terms: InvestorCatalogTerms
  financial_profile: InvestorCatalogFinancialProfile
  readiness: InvestorCatalogReadiness
}

export type InvestorCatalogOfferingDetail = {
  id: string
  status: 'LIVE'
  runtime_scope: PilotRuntimeScope
  asset_class: PilotAssetClass
  name: string
  description: string
  chain_id: number
  token_contract: string
  price: string
  currency: string
  terms: InvestorCatalogTerms
  financial_profile: InvestorCatalogFinancialProfile
  readiness: InvestorCatalogReadiness
}

export type FinancialProfileRecord = {
  id: string
  offering_id: string
  status: string
  terms_version: number
  runtime_scope?: PilotRuntimeScope
  consideration_source: PilotConsiderationSource
  cash_real: false
  cash_settled: false
  readiness?: Pick<
    OfferingReadiness,
    'terms_approved' | 'financial_profile_active' | 'subscription_enabled'
  >
}

export type SubscriptionEvidence = {
  provider_receipt_id: string | null
  provider_event_id: string | null
  funding_reservation_id: string | null
  funding_journal_entry_id: string | null
  statement_evidence_id: string | null
  test_provider_evidence_id: string | null
  reconciliation_run_id: string | null
  provider_snapshot_sha256: string | null
  statement_snapshot_sha256: string | null
  ledger_snapshot_sha256: string | null
  transaction_hash: string | null
  block_hash: string | null
  receipt_evidence_sha256: string | null
  confirmations: number
  cash_real: boolean
  cash_settled: boolean
}

export type ControlledSubscription = {
  id: string
  control_id: string
  offering_id: string
  user_id: string
  units: string
  amount: string
  currency: string
  currency_base_units: string
  asset_base_units: string
  status: 'SUBMITTED' | 'FUNDING_PENDING' | 'FUNDS_RECEIVED' | 'RECONCILED' | string
  runtime_scope: PilotRuntimeScope
  asset_class: PilotAssetClass
  consideration_source: PilotConsiderationSource
  cash_real: false
  cash_settled: false
  terms_version: number
  terms_sha256: string
  eligibility_decision?: string
  evidence: SubscriptionEvidence
  mint_chain_operation_id: string | null
  chain_finalized_at: string | null
  transaction_hash: string | null
  block_hash: string | null
  confirmations: number
  created_at?: string
  updated_at?: string
}

export type CreatedControlledSubscription = {
  id: string
  control_id: string
  status: string
  units: string
  amount: string
  currency: string
  eligibility_decision: string
  runtime_scope?: PilotRuntimeScope
  asset_class?: PilotAssetClass
  consideration_source?: PilotConsiderationSource
  cash_real?: false
  cash_settled?: false
  idempotent_replay: boolean
}

export type TestCheckoutSession = {
  checkout_session_id: string
  checkout_url: string
  expires_at: string
  replayed: boolean
  evidence_sha256: string
  cash_real: false
  cash_settled: false
}

export type SyntheticFundingRecord = {
  intake_id: string
  status: 'APPLIED'
  subscription_state: 'FUNDS_RECEIVED'
  consideration_source: PilotConsiderationSource
  cash_real: false
  cash_settled: false
  provider_receipt_id: string
  provider_event_id: string
  funding_reservation_id: string
  funding_journal_entry_id: string
  idempotent_replay: boolean
}

export type SyntheticStatementRecord = {
  statement_evidence_id: string
  status: 'RECORDED'
  cash_real: false
  cash_settled: false
  statement_sha256: string
  idempotent_replay: boolean
}

export type ReconciliationRecord = {
  id: string
  control_id: string
  subscription_id: string
  status: string
  subscription_state: string
  reconciliation_type?: string
  funding_evidence_id?: string
  statement_evidence_id?: string
  statement_snapshot_sha256?: string
  provider_snapshot_sha256: string
  ledger_snapshot_sha256: string
  cash_real: false
  cash_settled: false
  idempotent_replay: boolean
}

export type ControlledPosition = {
  id: string
  subscription_id: string
  control_id: string
  offering_id: string
  instrument_terms_id: string
  instrument_terms_sha256: string
  asset_class: PilotAssetClass
  instrument_name: string
  holder_user_id: string
  wallet_id: string
  wallet_address: string
  chain_id: number
  token_contract: string
  balance_base_units: string
  token_decimals: number
  transaction_hash: string
  block_number: string
  block_hash: string
  log_index: number
  receipt_evidence_sha256: string
  register_sequence: number
  register_entry_sha256: string
  status: string
  runtime_scope: PilotRuntimeScope
  consideration_source: PilotConsiderationSource
  mint_chain_operation_id: string | null
  chain_finalized_at: string
  confirmations: number
  chain_evidence_class: 'LOCAL_EVM_FINALIZED' | 'MANAGED_TESTNET_FINALIZED'
  testnet_broadcast: boolean
  created_at: string
}

export type LocalIssuanceRecord = {
  id: string
  subscription_id: string
  control_id: string
  offering_id: string
  instrument_terms_id: string
  asset_class: PilotAssetClass
  runtime_scope: 'LOCAL_PILOT'
  investor_user_id: string
  wallet_id: string
  wallet_address: string
  chain_id: number
  token_contract: string
  amount_base_units: string
  payload_hash: string
  idempotency_key: string
  state: 'PREPARED' | 'FINAL' | 'RECOVERY_REQUIRED' | string
  transaction_hash: string | null
  block_number: string | null
  block_hash: string | null
  transaction_index: number | null
  log_index: number | null
  receipt_evidence_sha256: string | null
  recovery_error_code: string | null
  recovery_error_detail: string | null
  prepared_at: string
  finalized_at: string | null
  recovery_required_at: string | null
  created: boolean
  position?: ControlledPosition
}

export type ControlledIssuanceResponse = {
  issuance: LocalIssuanceRecord
  consideration_source: PilotConsiderationSource
  cash_real: false
  cash_settled: false
  chain_evidence_class: string | null
  testnet_broadcast: false
}

export type ControlledPositionsResponse = {
  positions: ControlledPosition[]
  consideration_sources: PilotConsiderationSource[]
  cash_real: false
  cash_settled: false
  testnet_broadcast: boolean
}

export function isPilotAssetClass(value: string): value is PilotAssetClass {
  return PILOT_ASSET_CLASSES.some((assetClass) => assetClass === value)
}

type InvestorCatalogObject = Record<string, unknown>

function investorCatalogObject(value: unknown): InvestorCatalogObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as InvestorCatalogObject)
    : null
}

function investorCatalogString(
  value: InvestorCatalogObject,
  key: string
): string | null {
  return typeof value[key] === 'string' ? value[key] : null
}

function investorCatalogInteger(
  value: InvestorCatalogObject,
  key: string
): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isInteger(candidate)
    ? candidate
    : null
}

function normalizeInvestorCatalogCommonTerms(
  value: unknown
): CommonInstrumentTerms | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const currency = investorCatalogString(object, 'currency')
  const tokenDecimals = investorCatalogInteger(object, 'token_decimals')
  const authorizedUnits = investorCatalogString(
    object,
    'authorized_units_base_units'
  )
  const issueDate = investorCatalogString(object, 'issue_date')
  const governingLaw = investorCatalogString(object, 'governing_law')
  if (
    currency === null ||
    tokenDecimals === null ||
    authorizedUnits === null ||
    issueDate === null ||
    governingLaw === null
  ) {
    return null
  }
  return {
    currency,
    token_decimals: tokenDecimals,
    authorized_units_base_units: authorizedUnits,
    issue_date: issueDate,
    governing_law: governingLaw,
  }
}

function normalizeInvestorCatalogPrivateDebtTerms(
  value: unknown
): PrivateDebtTerms | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const faceValue = investorCatalogString(object, 'face_value_base_units')
  const annualCouponBPS = investorCatalogInteger(object, 'annual_coupon_bps')
  const couponFrequencyMonths = investorCatalogInteger(
    object,
    'coupon_frequency_months'
  )
  const dayCountConvention = investorCatalogString(
    object,
    'day_count_convention'
  )
  const maturityDate = investorCatalogString(object, 'maturity_date')
  const seniority = investorCatalogString(object, 'seniority')
  const secured = object.secured
  if (
    faceValue === null ||
    annualCouponBPS === null ||
    couponFrequencyMonths === null ||
    dayCountConvention === null ||
    maturityDate === null ||
    seniority === null ||
    typeof secured !== 'boolean'
  ) {
    return null
  }
  return {
    face_value_base_units: faceValue,
    annual_coupon_bps: annualCouponBPS,
    coupon_frequency_months: couponFrequencyMonths,
    day_count_convention: dayCountConvention,
    maturity_date: maturityDate,
    seniority,
    secured,
  }
}

function normalizeInvestorCatalogFundInterestTerms(
  value: unknown
): FundInterestTerms | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const shareClass = investorCatalogString(object, 'share_class')
  const navCurrency = investorCatalogString(object, 'nav_currency')
  const navFrequency = investorCatalogString(object, 'nav_frequency')
  const dealingFrequency = investorCatalogString(object, 'dealing_frequency')
  const distributionPolicy = investorCatalogString(object, 'distribution_policy')
  const redemptionNoticeDays = investorCatalogInteger(
    object,
    'redemption_notice_days'
  )
  if (
    shareClass === null ||
    navCurrency === null ||
    navFrequency === null ||
    dealingFrequency === null ||
    distributionPolicy === null ||
    redemptionNoticeDays === null
  ) {
    return null
  }
  return {
    share_class: shareClass,
    nav_currency: navCurrency,
    nav_frequency: navFrequency,
    dealing_frequency: dealingFrequency,
    distribution_policy: distributionPolicy,
    redemption_notice_days: redemptionNoticeDays,
  }
}

function normalizeInvestorCatalogRealEstateTerms(
  value: unknown
): RealEstateSpvTerms | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const spvName = investorCatalogString(object, 'spv_name')
  const propertyIdentifier = investorCatalogString(object, 'property_identifier')
  const propertyJurisdiction = investorCatalogString(
    object,
    'property_jurisdiction'
  )
  const valuationCurrency = investorCatalogString(object, 'valuation_currency')
  const valuationBaseUnits = investorCatalogString(
    object,
    'valuation_base_units'
  )
  const valuationAsOf = investorCatalogString(object, 'valuation_as_of')
  const ownershipRights = investorCatalogString(object, 'ownership_rights')
  const distributionPolicy = investorCatalogString(object, 'distribution_policy')
  if (
    spvName === null ||
    propertyIdentifier === null ||
    propertyJurisdiction === null ||
    valuationCurrency === null ||
    valuationBaseUnits === null ||
    valuationAsOf === null ||
    ownershipRights === null ||
    distributionPolicy === null
  ) {
    return null
  }
  return {
    spv_name: spvName,
    property_identifier: propertyIdentifier,
    property_jurisdiction: propertyJurisdiction,
    valuation_currency: valuationCurrency,
    valuation_base_units: valuationBaseUnits,
    valuation_as_of: valuationAsOf,
    ownership_rights: ownershipRights,
    distribution_policy: distributionPolicy,
  }
}

export function normalizeInvestorCatalogTerms(
  value: unknown
): InvestorCatalogTerms | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const version = investorCatalogInteger(object, 'version')
  const termsSHA256 = investorCatalogString(object, 'terms_sha256')
  const commonTerms = normalizeInvestorCatalogCommonTerms(object.common_terms)
  const privateDebtTerms =
    object.private_debt_terms === null || object.private_debt_terms === undefined
      ? undefined
      : normalizeInvestorCatalogPrivateDebtTerms(object.private_debt_terms)
  const fundInterestTerms =
    object.fund_interest_terms === null || object.fund_interest_terms === undefined
      ? undefined
      : normalizeInvestorCatalogFundInterestTerms(object.fund_interest_terms)
  const realEstateTerms =
    object.real_estate_spv_terms === null ||
    object.real_estate_spv_terms === undefined
      ? undefined
      : normalizeInvestorCatalogRealEstateTerms(object.real_estate_spv_terms)
  if (
    version === null ||
    termsSHA256 === null ||
    commonTerms === null ||
    privateDebtTerms === null ||
    fundInterestTerms === null ||
    realEstateTerms === null
  ) {
    return null
  }
  return {
    version,
    terms_sha256: termsSHA256,
    common_terms: commonTerms,
    ...(privateDebtTerms ? { private_debt_terms: privateDebtTerms } : {}),
    ...(fundInterestTerms ? { fund_interest_terms: fundInterestTerms } : {}),
    ...(realEstateTerms ? { real_estate_spv_terms: realEstateTerms } : {}),
  }
}

export function normalizeInvestorCatalogFinancialProfile(
  value: unknown
): InvestorCatalogFinancialProfile | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const price = investorCatalogString(
    object,
    'price_per_whole_unit_base_units'
  )
  const minimum = investorCatalogString(
    object,
    'minimum_subscription_asset_units'
  )
  const maximum = investorCatalogString(
    object,
    'maximum_subscription_asset_units'
  )
  const capacity = investorCatalogString(
    object,
    'allocation_capacity_asset_units'
  )
  const currencyCode = investorCatalogString(object, 'currency_code')
  const currencyScale = investorCatalogInteger(object, 'currency_scale')
  const paymentMethod = investorCatalogString(object, 'payment_method')
  const providerKind = investorCatalogString(object, 'provider_kind')
  const providerName = investorCatalogString(object, 'provider_name')
  const providerEnvironment = investorCatalogString(
    object,
    'provider_environment'
  )
  const considerationSource = investorCatalogString(
    object,
    'consideration_source'
  )
  const paymentDueSeconds = investorCatalogInteger(object, 'payment_due_seconds')
  if (
    price === null ||
    minimum === null ||
    maximum === null ||
    capacity === null ||
    currencyCode === null ||
    currencyScale === null ||
    (paymentMethod !== 'SYNTHETIC_TEST' && paymentMethod !== 'STRIPE') ||
    providerKind !== 'PAYMENT' ||
    (providerName !== 'blockxone-local-pilot' && providerName !== 'stripe') ||
    (providerEnvironment !== 'TEST' && providerEnvironment !== 'STAGING') ||
    (considerationSource !== 'SYNTHETIC_TEST' &&
      considerationSource !== 'TEST_PROVIDER') ||
    paymentDueSeconds === null
  ) {
    return null
  }
  return {
    price_per_whole_unit_base_units: price,
    minimum_subscription_asset_units: minimum,
    maximum_subscription_asset_units: maximum,
    allocation_capacity_asset_units: capacity,
    currency_code: currencyCode,
    currency_scale: currencyScale,
    payment_method: paymentMethod,
    provider_kind: providerKind,
    provider_name: providerName,
    provider_environment: providerEnvironment,
    consideration_source: considerationSource,
    payment_due_seconds: paymentDueSeconds,
  }
}

export function normalizeInvestorCatalogReadiness(
  value: unknown
): InvestorCatalogReadiness | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const offeringLive = object.offering_live
  const termsActive = object.terms_active
  const financialProfileActive = object.financial_profile_active
  const tokenDeployed = object.token_deployed
  const subscriptionReady = object.subscription_ready
  if (
    typeof offeringLive !== 'boolean' ||
    typeof termsActive !== 'boolean' ||
    typeof financialProfileActive !== 'boolean' ||
    typeof tokenDeployed !== 'boolean' ||
    typeof subscriptionReady !== 'boolean'
  ) {
    return null
  }
  return {
    offering_live: offeringLive,
    terms_active: termsActive,
    financial_profile_active: financialProfileActive,
    token_deployed: tokenDeployed,
    subscription_ready: subscriptionReady,
  }
}

function normalizeInvestorCatalogOffering(
  value: unknown
): InvestorCatalogOfferingDetail | null {
  const object = investorCatalogObject(value)
  if (!object) return null
  const id = investorCatalogString(object, 'id')
  const status = investorCatalogString(object, 'status')
  const runtimeScope = investorCatalogString(object, 'runtime_scope')
  const assetClass = investorCatalogString(object, 'asset_class')
  const name = investorCatalogString(object, 'name')
  const description = investorCatalogString(object, 'description')
  const chainID = investorCatalogInteger(object, 'chain_id')
  const tokenContract = investorCatalogString(object, 'token_contract')
  const price = investorCatalogString(object, 'price')
  const currency = investorCatalogString(object, 'currency')
  const terms = normalizeInvestorCatalogTerms(object.terms)
  const financialProfile = normalizeInvestorCatalogFinancialProfile(
    object.financial_profile
  )
  const readiness = normalizeInvestorCatalogReadiness(object.readiness)
  if (
    id === null ||
    status !== 'LIVE' ||
    (runtimeScope !== 'LOCAL_PILOT' && runtimeScope !== 'TESTNET') ||
    assetClass === null ||
    !isPilotAssetClass(assetClass) ||
    name === null ||
    description === null ||
    chainID === null ||
    tokenContract === null ||
    price === null ||
    currency === null ||
    terms === null ||
    financialProfile === null ||
    readiness === null ||
    !investorCatalogProfileMatchesRuntime(
      runtimeScope,
      chainID,
      financialProfile
    )
  ) {
    return null
  }
  return {
    id,
    status,
    runtime_scope: runtimeScope,
    asset_class: assetClass,
    name,
    description,
    chain_id: chainID,
    token_contract: tokenContract,
    price,
    currency,
    terms,
    financial_profile: financialProfile,
    readiness,
  }
}

function investorCatalogProfileMatchesRuntime(
  runtimeScope: PilotRuntimeScope,
  chainID: number,
  profile: InvestorCatalogFinancialProfile
): boolean {
  if (runtimeScope === 'LOCAL_PILOT') {
    return (
      chainID === 31337 &&
      profile.consideration_source === 'SYNTHETIC_TEST' &&
      profile.payment_method === 'SYNTHETIC_TEST' &&
      profile.provider_kind === 'PAYMENT' &&
      profile.provider_name === 'blockxone-local-pilot' &&
      profile.provider_environment === 'TEST'
    )
  }
  return (
    (chainID === 80002 || chainID === 84532 || chainID === 11155111) &&
    profile.consideration_source === 'TEST_PROVIDER' &&
    profile.payment_method === 'STRIPE' &&
    profile.provider_kind === 'PAYMENT' &&
    profile.provider_name === 'stripe' &&
    (profile.provider_environment === 'TEST' ||
      profile.provider_environment === 'STAGING')
  )
}

export function normalizeInvestorCatalogList(
  value: unknown
): InvestorCatalogListItem[] | null {
  if (!Array.isArray(value)) return null
  const result: InvestorCatalogListItem[] = []
  for (const item of value) {
    const normalized = normalizeInvestorCatalogOffering(item)
    if (!normalized) return null
    result.push(normalized)
  }
  return result
}

export function normalizeInvestorCatalogOfferingDetail(
  value: unknown
): InvestorCatalogOfferingDetail | null {
  return normalizeInvestorCatalogOffering(value)
}

export function activeInstrumentTerms(instrument: InstrumentRecord): InstrumentTerms | null {
  if (instrument.active_terms?.status === 'ACTIVE') return instrument.active_terms
  if (!Array.isArray(instrument.terms) && instrument.terms?.status === 'ACTIVE') {
    return instrument.terms
  }
  return null
}

export function draftInstrumentTerms(instrument: InstrumentRecord): InstrumentTerms | null {
  if (instrument.draft_terms?.status === 'DRAFT') return instrument.draft_terms
  if (!Array.isArray(instrument.terms) && instrument.terms?.status === 'DRAFT') {
    return instrument.terms
  }
  return null
}

export function termsCheckerStatus(
  terms: InstrumentTerms,
  viewerUserId: string
): 'ACTIVE' | 'CHECKER_REQUIRED' | 'MAKER_CANNOT_APPROVE' {
  if (terms.status === 'ACTIVE') return 'ACTIVE'
  return terms.prepared_by_user_id === viewerUserId
    ? 'MAKER_CANNOT_APPROVE'
    : 'CHECKER_REQUIRED'
}

export function chainEvidenceLabel(subscription: ControlledSubscription): string {
  if (
    subscription.transaction_hash &&
    subscription.block_hash &&
    subscription.chain_finalized_at
  ) {
    return `Finalized with ${subscription.confirmations} confirmation${
      subscription.confirmations === 1 ? '' : 's'
    }`
  }
  if (subscription.mint_chain_operation_id) return 'Issuance operation pending'
  return 'Not issued. No transaction evidence'
}

export function newIdempotencyKey(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${suffix}`
}
