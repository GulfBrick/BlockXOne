import { isAuthErrorCode } from './supabase/contracts'
import { parseAdministrationQuery } from './administration/query'
import { parseRecoveryQuery } from './recovery/contracts'

export type AuthReferrerPolicy = 'no-referrer' | 'strict-origin'
type AuthSearchParams = Record<string, string | string[] | undefined>

// Fetch serializes Origin as null for native navigation POSTs under no-referrer.
// Clean form documents use strict-origin: it preserves same-origin HTTPS POSTs
// while never disclosing a URL path/query in Referer. Token/error responses keep
// no-referrer. Do not solve this by accepting missing or null request origins.
export function authDocumentReferrerPolicy(
  pathname: string,
  searchParams: URLSearchParams | AuthSearchParams,
): AuthReferrerPolicy {
  if (pathname === '/workspace/recovery') return parseRecoveryQuery(searchParams) ? 'strict-origin' : 'no-referrer'
  if (pathname === '/workspace/administration') return parseAdministrationQuery(searchParams) ? 'strict-origin' : 'no-referrer'
  if (!['/login', '/login/mfa', '/workspace', '/workspace/security', '/auth/confirm'].includes(pathname)) return 'no-referrer'
  const entries = searchParams instanceof URLSearchParams ? [...searchParams.entries()] : Object.entries(searchParams).filter(([, value]) => value !== undefined)
  const seen = new Set<string>()
  for (const [key, value] of entries) {
    if (seen.has(key)) return 'no-referrer'
    seen.add(key)
    if (pathname === '/login/mfa' && key === 'continue' && value === 'setup') continue
    if (pathname === '/login' && key === 'setup' && value === '1') continue
    if (pathname === '/login' && key === 'error' && isAuthErrorCode(value)) continue
    return 'no-referrer'
  }
  return 'strict-origin'
}
