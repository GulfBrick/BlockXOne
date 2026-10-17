import 'server-only'

import { platformRelease, type PlatformEnvironment } from '@/lib/platform-release'
import { WALLET_ORIGIN } from './contracts'

type Environment = Record<string, string | undefined>
export type WalletEnvironmentProfile = Readonly<{
  environment: PlatformEnvironment
  applicationOrigin: string
  project: string
  directHost: string
  poolerHost: string
}>

const targets = {
  TESTNET: { project: 'fegnnnlseuejkrusbbkv', applicationOrigin: 'https://testnet.bx1.co.za' },
  MAINNET: { project: 'oqkevkjbkpugjotihtda', applicationOrigin: WALLET_ORIGIN },
} as const

/** Wallet ownership uses the existing statement domain on both deployments.
 * The request origin and database project are a separate, exact environment
 * binding. Keeping the statement unchanged preserves historical proof bytes;
 * it never permits a TEST request to use the MAIN verifier credentials. */
export function walletEnvironmentProfile(env: Environment = process.env): WalletEnvironmentProfile | null {
  const release = platformRelease(env)
  if (!release) return null
  const target = targets[release.environment]
  if (env.BLOCKXONE_APP_ORIGIN !== target.applicationOrigin
    || env.SUPABASE_URL !== `https://${target.project}.supabase.co`) return null
  return Object.freeze({
    environment: release.environment,
    applicationOrigin: target.applicationOrigin,
    project: target.project,
    directHost: `db.${target.project}.supabase.co`,
    // Existing projects' verified Connect-panel endpoint. No region wildcard,
    // unrelated Supabase project or generic DATABASE_URL fallback is accepted.
    poolerHost: 'aws-0-eu-central-1.pooler.supabase.com',
  })
}
