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
  if (!['/login', '/workspace', '/auth/confirm'].includes(pathname)) return 'no-referrer'
  const entries = searchParams instanceof URLSearchParams ? [...searchParams.entries()] : Object.entries(searchParams).filter(([, value]) => value !== undefined)
  const seen = new Set<string>()
  for (const [key, value] of entries) {
    if (seen.has(key) || pathname !== '/login') return 'no-referrer'
    seen.add(key)
    if (key === 'setup' && value === '1') continue
    if (key === 'error' && typeof value === 'string' && ['invalid_credentials', 'invalid_request', 'access_denied', 'unavailable'].includes(value)) continue
    return 'no-referrer'
  }
  return 'strict-origin'
}
