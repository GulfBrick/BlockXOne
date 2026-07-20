const PRODUCTION_BLOCKED_PREFIXES = [
  '/register',
  '/login',
  '/api',
  '/investor',
  '/operator',
  '/issuer',
  '/wm',
  '/admin',
  '/compliance',
  '/tokenisation-agent',
  '/test'
] as const

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.trim().split(/[?#]/, 1)[0] || '/'
  const collapsed = `/${withoutQuery}`.replace(/\/{2,}/g, '/')
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1)
  return collapsed
}

export function isProductionWebPathBlocked(
  pathname: string,
  environment: string | undefined = process.env.NODE_ENV
): boolean {
  const normalizedEnvironment = (environment || '').trim().toLowerCase()
  if (['dev', 'development', 'test'].includes(normalizedEnvironment)) return false
  const normalized = normalizePathname(pathname)
  return PRODUCTION_BLOCKED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}

export { PRODUCTION_BLOCKED_PREFIXES }
