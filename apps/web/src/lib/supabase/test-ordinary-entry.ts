import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { platformRelease } from '@/lib/platform-release'
import { entrySnapshotSchema } from '@/lib/portal/entry-contracts'
import { PortalError } from '@/lib/portal/server'
import { BX1_ROLES } from './contracts'
import { readVerifiedUser } from './server'
import { hasOrdinaryPasswordSession, hasRequiredMfa, isMfaContextCurrent, type VerifiedMfaContext } from './mfa'

const workspaceSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email(), platformUserId: z.string().min(1), displayName: z.string().nullable() }).strict(),
  organisations: z.array(z.object({ id: z.string().uuid(), name: z.string(), roles: z.array(z.enum(BX1_ROLES)) }).strict()),
}).strict()
const envelopeSchema = z.object({ version: z.literal(1), entry: entrySnapshotSchema, workspace: workspaceSchema.nullable() }).strict()

/** Temporary ordinary TEST entry only. This flag never supplies business authority. */
export function testOrdinaryEntryMfaPaused(env: Record<string, string | undefined>): boolean {
  return env.BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED === 'enabled'
    && platformRelease(env)?.environment === 'TESTNET'
    && env.SUPABASE_URL === 'https://fegnnnlseuejkrusbbkv.supabase.co'
    && env.BLOCKXONE_APP_ORIGIN === 'https://testnet.bx1.co.za'
}

export function useTestOrdinaryEntry(context: VerifiedMfaContext, env: Record<string, string | undefined> = process.env): boolean {
  return testOrdinaryEntryMfaPaused(env) && hasOrdinaryPasswordSession(context) && !hasRequiredMfa(context)
}

/** Existing identity contracts, restricted to a separate caller-owned read. */
export async function readTestOrdinaryEntry(client: SupabaseClient, context: VerifiedMfaContext) {
  if (!useTestOrdinaryEntry(context)) throw new PortalError('Ordinary Testnet entry is not enabled.', 403)
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous
    || !await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
  // The independent database gate checks the exact TEST issuer, live native
  // session/profile and password-only AAL1. No MFA predicates or RLS are changed.
  const { data, error } = await client.rpc('bx1_test_ordinary_entry_read').abortSignal(AbortSignal.timeout(12000))
  if (error) throw new PortalError('Ordinary Testnet access is unavailable.', error.code === '42501' ? 403 : 503)
  const parsed = envelopeSchema.safeParse(data)
  if (!parsed.success) throw new PortalError('Your saved identity context could not be verified.', 503)
  const { entry, workspace } = parsed.data
  if (entry.actor.id !== user.id || entry.actor.email !== user.email
    || entry.workflow?.environment !== 'TESTNET' || entry.workflow.actor_id !== user.id
    || entry.workflow.scoped_read_available || entry.admission.manual_test_review
    || entry.applications.some(application => application.user_id !== user.id
      || Object.keys(application.details).length !== 0 || application.review_route !== 'NOT_ADMITTED'
      || application.can_request_mandate || application.handoff != null
      || application.reviewer_id !== null || application.review_notes !== null || Object.keys(application.review_checks).length !== 0)
    || (entry.requests?.length ?? 0) !== 0 || (entry.organisation_mandates?.length ?? 0) !== 0
    || (workspace && (workspace.user.id !== user.id || workspace.user.email !== user.email))) {
    throw new PortalError('Your saved identity context could not be verified.', 503)
  }
  const contexts = new Map(entry.contexts.map(item => [item.organisation_id, item]))
  const organisations = workspace?.organisations ?? []
  if (contexts.size !== entry.contexts.length || contexts.size !== organisations.length
    || new Set(organisations.map(item => item.id)).size !== organisations.length
    || organisations.some(item => {
      const saved = contexts.get(item.id)
      return !saved || saved.context_key !== item.id || saved.name !== item.name
        || new Set(item.roles).size !== item.roles.length || new Set(saved.roles).size !== saved.roles.length
        || item.roles.length !== saved.roles.length || item.roles.some(role => !saved.roles.includes(role))
    })) throw new PortalError('Your saved assignment labels could not be verified.', 503)
  if (!await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
  return parsed.data
}
