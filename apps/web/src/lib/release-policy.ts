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

const PILOT_ALLOWED_PATHS = [
  '/login',
  '/investor/login',
  '/operator/login',
  '/issuer',
  '/api/auth/login',
  '/api/auth/user',
  '/api/logout',
  '/investor/market',
  '/investor/kyc',
  '/investor/portfolio',
  '/wm',
  '/wm/funds',
  '/wm/funds/new',
  '/wm/subscriptions',
  '/wm/settlements',
  '/compliance',
  '/compliance/queue',
  '/compliance/wallets',
  '/tokenisation-agent',
  '/tokenisation-agent/deploy',
  '/tokenisation-agent/whitelist',
  '/tokenisation-agent/mint',
] as const

const PILOT_ALLOWED_PREFIXES = [
  '/investor/funds',
  '/wm/funds',
] as const

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.trim().split(/[?#]/, 1)[0] || '/'
  const collapsed = `/${withoutQuery}`.replace(/\/{2,}/g, '/')
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1)
  return collapsed
}

function isProtectedApplicationPath(pathname: string): boolean {
  return PRODUCTION_BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

function isPairedPilotMode(releaseMode: string, publicReleaseMode: string): boolean {
  return (
    releaseMode === publicReleaseMode &&
    (releaseMode === 'pilot' || releaseMode === 'pilot-share')
  )
}

export function isPilotWebPathAllowed(
  pathname: string,
  environment: string | undefined = process.env.NODE_ENV,
  releaseMode: string | undefined = process.env.BLOCKXONE_RELEASE_MODE,
  publicReleaseMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE
): boolean {
  const normalizedEnvironment = (environment || '').trim().toLowerCase()
  const normalizedReleaseMode = (releaseMode || '').trim().toLowerCase()
  const normalizedPublicReleaseMode = (publicReleaseMode || '').trim().toLowerCase()
  if (
    !['production', 'dev', 'development', 'test'].includes(normalizedEnvironment) ||
    !isPairedPilotMode(normalizedReleaseMode, normalizedPublicReleaseMode)
  ) return false

  const normalized = normalizePathname(pathname)
  if (!isProtectedApplicationPath(normalized)) return false
  if (PILOT_ALLOWED_PATHS.some((path) => normalized === path)) return true
  return PILOT_ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(`${prefix}/`))
}

export function isProductionWebPathBlocked(
  pathname: string,
  environment: string | undefined = process.env.NODE_ENV,
  releaseMode: string | undefined = process.env.BLOCKXONE_RELEASE_MODE,
  publicReleaseMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE
): boolean {
  const normalizedEnvironment = (environment || '').trim().toLowerCase()
  const normalized = normalizePathname(pathname)
  if (!isProtectedApplicationPath(normalized)) return false
  if (
    ['dev', 'development', 'test'].includes(normalizedEnvironment) &&
    (releaseMode || '').trim().toLowerCase() !== 'pilot' &&
    (publicReleaseMode || '').trim().toLowerCase() !== 'pilot'
  ) return false
  return !isPilotWebPathAllowed(normalized, environment, releaseMode, publicReleaseMode)
}

export function isPortalAccessAdvertised(
  environment: string | undefined = process.env.NODE_ENV,
  releaseMode: string | undefined = process.env.BLOCKXONE_RELEASE_MODE,
  publicReleaseMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE
): boolean {
  const normalizedEnvironment = (environment || '').trim().toLowerCase()
  if (['dev', 'development', 'test'].includes(normalizedEnvironment)) return true
  if (normalizedEnvironment !== 'production') return false
  return (
    isPairedPilotMode(
      (releaseMode || '').trim().toLowerCase(),
      (publicReleaseMode || '').trim().toLowerCase()
    )
  )
}

export {
  PILOT_ALLOWED_PATHS,
  PILOT_ALLOWED_PREFIXES,
  PRODUCTION_BLOCKED_PREFIXES,
}
