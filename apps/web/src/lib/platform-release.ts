import { TESTNET_APP_ORIGIN } from './testnet-fund/contracts'

/** One product version; deployment identity and business readiness remain separate. */
export const PLATFORM_VERSION = '1.1.0-rc.12'
export type PlatformEnvironment = 'TESTNET' | 'MAINNET'
export type PlatformRelease = { version: string; environment: PlatformEnvironment; source: string }

export function platformRelease(env: Record<string, string | undefined>): PlatformRelease | null {
  if (env.BLOCKXONE_AUTH_MODE !== 'supabase' || env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE !== 'supabase') return null
  let origin: URL
  try { origin = new URL(env.BLOCKXONE_APP_ORIGIN || '') } catch { return null }
  if (origin.protocol !== 'https:' || origin.origin !== env.BLOCKXONE_APP_ORIGIN || origin.username || origin.password || origin.port) return null
  const test = env.SUPABASE_URL === 'https://fegnnnlseuejkrusbbkv.supabase.co'
    && env.VERCEL_ENV === 'preview'
    && (origin.origin === TESTNET_APP_ORIGIN
      || (origin.hostname.endsWith('.vercel.app') && origin.hostname !== 'block-x-one.vercel.app'))
  const main = env.SUPABASE_URL === 'https://oqkevkjbkpugjotihtda.supabase.co'
    && env.VERCEL_ENV === 'production' && ['bx1.co.za', 'www.bx1.co.za', 'block-x-one.vercel.app'].includes(origin.hostname)
  if (!test && !main) return null
  const environment: PlatformEnvironment = test ? 'TESTNET' : 'MAINNET'
  // Existing deployments derive identity from the validated target/origin/project
  // tuple. Any additional explicit binding must agree; it is never a fallback.
  if (env.NEXT_PUBLIC_SUPABASE_URL !== undefined && env.NEXT_PUBLIC_SUPABASE_URL !== env.SUPABASE_URL) return null
  if (env.BLOCKXONE_ENVIRONMENT !== undefined && env.BLOCKXONE_ENVIRONMENT !== environment) return null
  if (env.NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE !== undefined && env.NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE !== environment) return null
  const source = /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '') ? env.VERCEL_GIT_COMMIT_SHA!.slice(0, 12) : 'source unavailable'
  return { version: PLATFORM_VERSION, environment, source }
}

/** Identity entry is shared. This does not admit financial or chain commands. */
export function identityEnvironmentEnabled(env: Record<string, string | undefined>): boolean {
  return platformRelease(env) !== null
}

