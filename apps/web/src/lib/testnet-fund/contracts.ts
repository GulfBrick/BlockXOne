export const DEMO_CHAIN_ID = 80002 as const
export const DEMO_PROJECT = 'fegnnnlseuejkrusbbkv'
export const TESTNET_APP_ORIGIN = 'https://testnet.bx1.co.za' as const
export type DemoOperation = { id: string; fund_id: string; kind: 'MINT' | 'BURN'; wallet: string; units: string; status: 'PREPARED' | 'CONFIRMED'; transaction_hash: string | null; block_number: string | null }
export type DemoSubscription = { id: string; investor_wallet: string; units: string; amount_minor: string; status: string; operation_id: string | null }
export type DemoRedemption = DemoSubscription
export type DemoFund = {
  id: string; organisation_id: string; name: string; status: 'DRAFT' | 'OPEN'; chain_id: 80002; currency: 'ZAR_TEST'; cash_decimals: 2; unit_decimals: 0;
  unit_price_minor: string; cap_units: string; contract_address: string | null; contract_owner: string | null; deployment_transaction_hash: string | null;
  issued_units: string; reserved_subscription_units: string; reserved_redemption_units: string; synthetic_cash_minor: string;
  subscriptions: DemoSubscription[]; redemptions: DemoRedemption[]; operations: DemoOperation[];
  holdings: { investor_wallet: string; units: string; reserved_units: string }[];
  distributions: { id: string; amount_minor: string; created_at: string; entitlements: { investor_wallet: string; units: string; amount_minor: string }[] }[];
  journal: { id: string; event_kind: string; unit: 'ZAR_TEST' | 'FUND_UNIT'; source_id: string; lines: { account: string; direction: 'DEBIT' | 'CREDIT'; amount: string }[] }[];
}
export type DemoSnapshot = { funds: DemoFund[]; operation?: DemoOperation }
export type DemoTransaction = { from: string; to?: string; data: string; value: '0x0' }
export const DEMO_COMMANDS = ['create_fund', 'open_offering', 'subscribe', 'record_test_funding', 'prepare_mint', 'record_test_income', 'record_distribution', 'request_redemption', 'prepare_burn', 'complete_test_payout'] as const
export function demoMoney(minor: string): string {
  if (!/^\d+$/.test(minor)) return 'Unavailable'
  return `${BigInt(minor) / 100n}.${(BigInt(minor) % 100n).toString().padStart(2, '0')} ZAR_TEST`
}
export function isDemoEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.BLOCKXONE_TESTNET_FUND_DEMO !== 'enabled' || env.BLOCKXONE_AUTH_MODE !== 'supabase' || env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE !== 'supabase') return false
  if (env.SUPABASE_URL !== `https://${DEMO_PROJECT}.supabase.co` || env.VERCEL_ENV !== 'preview') return false
  try {
    const origin = new URL(env.BLOCKXONE_APP_ORIGIN ?? '')
    return origin.protocol === 'https:' && origin.origin === env.BLOCKXONE_APP_ORIGIN && !origin.username && !origin.password
      && (origin.origin === TESTNET_APP_ORIGIN
        || (origin.hostname.endsWith('.vercel.app') && origin.hostname !== 'block-x-one.vercel.app'))
  } catch { return false }
}
