export type UserRole = 'Investor' | 'WealthManager' | 'ComplianceOfficer' | 'SuperAdmin' | 'SupportAgent'

export type UserStatus = 'Active' | 'Suspended' | 'Locked' | 'Pending'

export type KYCStatus = 'Unstarted' | 'Pending' | 'EDD' | 'Approved' | 'Rejected'

export type InvestorClass = 'Retail' | 'Professional' | 'Institutional' | 'Accredited'

export type FundStatus = 'Draft' | 'Pending' | 'Approved' | 'Published' | 'Closed'

export type OrderType = 'Subscribe' | 'Redeem'

export type OrderStatus = 'Pending' | 'Approved' | 'Executing' | 'Completed' | 'Failed' | 'Cancelled'

export type P2POrderSide = 'Buy' | 'Sell'

export type P2POrderStatus = 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Expired'

export interface User {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  kyc_status: KYCStatus
  investor_class?: InvestorClass
  jurisdiction?: string
  devices: Device[]
  mfa?: MFASettings
  created_at: string
  updated_at: string
}

export interface Device {
  id: string
  name: string
  type: string
  last_used: string
  trusted: boolean
}

export interface MFASettings {
  enabled: boolean
  methods: string[]
  last_verified?: string
}

export interface Fund {
  id: string
  manager_id: string
  name: string
  symbol: string
  category: string
  strategy: string
  chain_id: string
  token_addr?: string
  compliance_standard: string
  terms: FundTerms
  fees: FundFees
  nav_policy: NAVPolicy
  docs: Document[]
  jurisdictions: string[]
  investor_classes: InvestorClass[]
  supply_caps: SupplyCaps
  calendars: Calendar[]
  status: FundStatus
  created_at: string
  updated_at: string
}

export interface FundTerms {
  min_investment: number
  max_investment?: number
  lockup_period?: number
  redemption_frequency: string
  subscription_frequency: string
}

export interface FundFees {
  management_fee: number
  performance_fee: number
  entry_fee?: number
  exit_fee?: number
}

export interface NAVPolicy {
  frequency: string
  calculation_method: string
  pricing_source: string
}

export interface SupplyCaps {
  total_cap?: number
  per_investor_cap?: number
  current_supply: number
}

export interface Calendar {
  type: string
  dates: string[]
}

export interface Document {
  id: string
  name: string
  type: string
  url: string
  uploaded_at: string
}

export interface Order {
  id: string
  type: OrderType
  user_id: string
  fund_id: string
  qty_tokens?: number
  amount_fiat?: number
  price?: number
  status: OrderStatus
  payments: Payment[]
  tx_refs: string[]
  approvals: Approval[]
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  provider: string
  amount: number
  currency: string
  status: string
  reference: string
}

export interface Approval {
  role: UserRole
  user_id: string
  action: string
  timestamp: string
  notes?: string
}

export interface P2POrder {
  id: string
  fund_id: string
  user_id: string
  side: P2POrderSide
  qty: number
  limit_price?: number
  status: P2POrderStatus
  reserve_until?: string
  matches: Match[]
  created_at: string
  updated_at: string
}

export interface Match {
  id: string
  counterparty_id: string
  qty: number
  price: number
  timestamp: string
  tx_hash?: string
}

export interface KYCCase {
  id: string
  user_id: string
  provider_refs: string[]
  results: unknown
  risk_score?: number
  reviewer_id?: string
  status: KYCStatus
  timeline: TimelineEvent[]
  created_at: string
  updated_at: string
}

export interface TimelineEvent {
  action: string
  actor_id?: string
  timestamp: string
  data?: unknown
}

export interface AuditLog {
  id: string
  actor_id: string
  actor_role: UserRole
  action: string
  resource_type: string
  resource_id: string
  before?: unknown
  after?: unknown
  ip: string
  user_agent: string
  timestamp: string
}

export interface Notification {
  id: string
  user_id: string
  type: string
  severity: 'info' | 'warning' | 'error' | 'success'
  title: string
  body: string
  read: boolean
  timestamp: string
}

export interface Wallet {
  id: string
  user_id: string
  provider: string
  addresses: Record<string, string>
  custody_type: 'self' | 'managed'
  balances: Record<string, number>
  last_reconciled: string
}

export interface Transaction {
  id: string
  user_id?: string
  fund_id?: string
  type: string
  gross: number
  fees: number
  net: number
  currency: string
  tx_hash?: string
  chain_id?: string
  status: string
  created_at: string
}

export interface Distribution {
  id: string
  fund_id: string
  amount: number
  record_date: string
  pay_date: string
  tx_refs: string[]
  statements: string[]
}

export interface NAVEntry {
  id: string
  fund_id: string
  date: string
  nav_per_token: number
  source: string
  reviewer_id?: string
  version: number
  created_at: string
}

export interface Settings {
  feature_flags: Record<string, boolean>
  jurisdictions_config: unknown
  fee_tables: unknown
  risk_rules: unknown
  providers: unknown
}
