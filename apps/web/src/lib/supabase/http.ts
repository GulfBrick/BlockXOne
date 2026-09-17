import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { CookieOptions } from '@supabase/ssr'
import { canonicalAppOrigin, secureCookieOptions, type CookieAdapter } from './server'
import type { AuthReferrerPolicy } from '@/lib/auth-referrer-policy'

export const PENDING_INVITE_COOKIE = 'bx1-pending-invite'
export const LOGIN_EMAIL_COOKIE = 'bx1-login-email'

export function privateResponse(response: NextResponse, referrerPolicy: AuthReferrerPolicy = 'no-referrer'): NextResponse {
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0')
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  response.headers.set('Referrer-Policy', referrerPolicy)
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

// Carries all SDK chunk writes/headers onto whichever response the handler returns.
export function responseCookieAdapter(request: NextRequest) {
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const refreshHeaders = new Headers()
  const adapter: CookieAdapter = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookies, headers) => {
      for (const cookie of cookies) {
        request.cookies.set(cookie.name, cookie.value)
        pending.set(cookie.name, { ...cookie, options: secureCookieOptions(cookie.options) })
      }
      for (const [key, value] of Object.entries(headers)) refreshHeaders.set(key, value)
    },
  }
  return {
    adapter,
    finish(response: NextResponse): NextResponse {
      refreshHeaders.forEach((value, key) => response.headers.set(key, value))
      for (const { name, value, options } of pending.values()) response.cookies.set(name, value, options)
      return privateResponse(response)
    },
  }
}

export function hasCanonicalOrigin(request: NextRequest): boolean {
  const expected = canonicalAppOrigin()
  const host = request.headers.get('host')
  return request.headers.get('origin') === expected && request.nextUrl.origin === expected && host === new URL(expected).host
}

export class InvalidAuthRequest extends Error {}

export async function readAuthForm(request: NextRequest): Promise<URLSearchParams> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new InvalidAuthRequest()
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new InvalidAuthRequest()
  const reader = request.body?.getReader()
  if (!reader) return new URLSearchParams()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 8192) { await reader.cancel(); throw new InvalidAuthRequest() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const form = new URLSearchParams(text)
  for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new InvalidAuthRequest()
  return form
}
