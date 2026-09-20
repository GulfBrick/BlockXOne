import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readWorkspace } from '@/lib/supabase/server'
import { readMfaContext, hasRequiredMfa, isMfaContextCurrent } from '@/lib/supabase/mfa'
import { isDemoEnvironment, type DemoSnapshot } from './contracts'
import { demoFundArtifact } from './artifact.generated'

export class DemoError extends Error {
  constructor(message: string, public readonly status = 409) { super(message) }
}
export function requireDemoEnvironment() {
  if (!isDemoEnvironment(process.env)) throw new DemoError('Testnet fund demo is not enabled on this deployment.', 404)
}
export async function requireDemoAccess(client: SupabaseClient) {
  requireDemoEnvironment()
  const context = await readMfaContext(client)
  if (!context || !hasRequiredMfa(context)) throw new DemoError('Sign in and complete your existing MFA requirement.', 401)
  const workspace = await readWorkspace(client)
  if (!workspace || !await isMfaContextCurrent(client, context)) throw new DemoError('Your workspace is unavailable.', 403)
  return workspace
}
export async function demoSnapshot(client: SupabaseClient): Promise<DemoSnapshot> {
  const { data, error } = await client.rpc('bx1_demo_snapshot')
  if (error || !data || !Array.isArray(data.funds)) throw new DemoError('Unable to read the saved fund state.', 503)
  return data as DemoSnapshot
}
export async function chainEvidence(client: SupabaseClient, command: 'bind' | 'confirm', params: unknown[], assertActive: () => void) {
  requireDemoEnvironment()
  const session = await client.auth.getSession()
  const token = session.data.session?.access_token
  if (session.error || !token) throw new DemoError('Sign in again.', 401)
  const verified = await client.auth.getUser(token)
  if (verified.error || !verified.data.user) throw new DemoError('Session is no longer valid.', 401)
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  if (claims.sub !== verified.data.user.id || !/^[0-9a-f-]{36}$/i.test(claims.session_id ?? '')) throw new DemoError('Session is unavailable.', 403)
  let url: URL
  try {
    url = new URL(process.env.BLOCKXONE_DEMO_DATABASE_URL ?? '')
    const direct = url.hostname === 'db.fegnnnlseuejkrusbbkv.supabase.co'
    const pooled = url.hostname === 'aws-0-eu-central-1.pooler.supabase.com'
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled) || !url.password || url.pathname !== '/postgres' || url.hash
      || decodeURIComponent(url.username) !== (direct ? 'bx1_demo_chain_verifier' : 'bx1_demo_chain_verifier.fegnnnlseuejkrusbbkv')
      || (url.port || '5432') !== (direct ? '5432' : '6543') || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
  } catch { throw new DemoError('The restricted TEST receipt verifier connection is not configured.', 503) }
  const pool = new Pool({ host: url.hostname, port: Number(url.port || 5432), database: 'postgres', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname }, max: 1, connectionTimeoutMillis: 3000, query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000, application_name: 'bx1-demo-chain-verifier' })
  pool.on('error', () => {})
  try {
    const sql = command === 'bind' ? 'select public.bx1_demo_bind_contract($1,$2,$3,$4,$5,$6)' : 'select public.bx1_demo_confirm_chain($1,$2,$3,$4,$5,$6)'
    assertActive()
    await pool.query(sql, [...params, verified.data.user.id, claims.session_id])
  } catch { throw new DemoError('Verified chain evidence could not be saved. Do not resend; refresh and verify again.') }
  finally { await pool.end() }
}
export async function loadTestnetFundPage() {
  requireDemoEnvironment()
  const client = await createPageSupabaseClient()
  const workspace = await requireDemoAccess(client)
  return { workspace, snapshot: await demoSnapshot(client), configuration: { chainId: 80002 as const, contractArtifactAvailable: Boolean(demoFundArtifact) } }
}
