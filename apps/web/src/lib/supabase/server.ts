import 'server-only'

import { createServerClient, type CookieOptions, type SetAllCookies } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { BX1_ROLES, type Bx1Role, type Bx1Workspace } from './contracts'

export type CookieAdapter = {
  getAll: () => { name: string; value: string }[] | Promise<{ name: string; value: string }[]>
  setAll: SetAllCookies
}

export class AuthUnavailableError extends Error {
  constructor() { super('Access is temporarily unavailable.'); this.name = 'AuthUnavailableError' }
}

export function secureCookieOptions(options: CookieOptions = {}): CookieOptions {
  const hostOnly = { ...options }
  delete hostOnly.domain
  return { ...hostOnly, path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}

export function canonicalAppOrigin(): string {
  try {
    const raw = process.env.BLOCKXONE_APP_ORIGIN
    if (!raw) throw new Error()
    const url = new URL(raw)
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || raw !== url.origin || url.username || url.password) throw new Error()
    return url.origin
  } catch { throw new AuthUnavailableError() }
}

export function createRequestSupabaseClient(adapter: CookieAdapter): SupabaseClient {
  if (!isSupabaseAuthMode()) throw new AuthUnavailableError()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key?.startsWith('sb_publishable_')) throw new AuthUnavailableError()
  try {
    const parsed = new URL(url)
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error()
  } catch { throw new AuthUnavailableError() }

  return createServerClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: true },
    global: { fetch: (input, init) => globalThis.fetch(input, { ...init, cache: 'no-store' }) },
    cookieOptions: secureCookieOptions(),
    cookies: {
      getAll: adapter.getAll,
      setAll: (cookies, headers) => adapter.setAll(cookies.map((cookie) => ({ ...cookie, options: secureCookieOptions(cookie.options) })), headers),
    },
  })
}

// Network-confirmed identity is necessary but NOT sufficient: RLS also binds the
// signed session_id to auth.sessions, then checks fresh profile/org memberships.
export async function readVerifiedUser(client: SupabaseClient): Promise<User | null> {
  try {
    const { data, error } = await client.auth.getUser()
    if (error) {
      if (error.status === 400 || error.status === 401 || error.status === 403 || error.name === 'AuthSessionMissingError') return null
      throw new AuthUnavailableError()
    }
    return data.user?.id && data.user.email ? data.user : null
  } catch (error) {
    if (error instanceof AuthUnavailableError) throw error
    throw new AuthUnavailableError()
  }
}

export async function readWorkspace(client: SupabaseClient): Promise<Bx1Workspace | null> {
  try {
    const user = await readVerifiedUser(client)
    if (!user) return null
    const { data: profile, error: profileError } = await client.from('bx1_profiles')
      .select('id,platform_user_id,display_name,status').eq('id', user.id).eq('status', 'ACTIVE').maybeSingle()
    if (profileError) throw new AuthUnavailableError()
    if (!profile || profile.id !== user.id || profile.status !== 'ACTIVE') return null
    if (typeof profile.platform_user_id !== 'string' || !profile.platform_user_id) throw new AuthUnavailableError()

    const { data: memberships, error: membershipError } = await client.from('bx1_memberships')
      .select('organisation_id,role,status').eq('user_id', user.id).eq('status', 'ACTIVE')
    if (membershipError) throw new AuthUnavailableError()
    if (!memberships?.length) return null
    for (const member of memberships) {
      if (!BX1_ROLES.includes(member.role as Bx1Role) || typeof member.organisation_id !== 'string' || member.status !== 'ACTIVE') throw new AuthUnavailableError()
    }
    const ids = [...new Set(memberships.map((member) => member.organisation_id as string))]
    const { data: organisations, error: organisationError } = await client.from('bx1_organisations')
      .select('id,name,status').in('id', ids).eq('status', 'ACTIVE')
    if (organisationError) throw new AuthUnavailableError()
    if (!organisations?.length) return null
    const visible = organisations.filter((org) => ids.includes(org.id) && org.status === 'ACTIVE' && typeof org.name === 'string')
    if (!visible.length) return null
    return {
      user: { id: user.id, email: user.email!, platformUserId: profile.platform_user_id, displayName: typeof profile.display_name === 'string' ? profile.display_name : null },
      organisations: visible.map((org) => ({ id: org.id, name: org.name, roles: [...new Set(memberships.filter((member) => member.organisation_id === org.id).map((member) => member.role as Bx1Role))] })),
    }
  } catch { throw new AuthUnavailableError() }
}

const allowedRedirects = new Set(['/workspace', '/login?setup=1'])
export function safeLocalRedirect(value: unknown, fallback = '/workspace'): string {
  return typeof value === 'string' && allowedRedirects.has(value) ? value : allowedRedirects.has(fallback) ? fallback : '/workspace'
}
