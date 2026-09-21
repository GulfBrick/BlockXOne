import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { privateResponse } from '../supabase/http'
import { parseAdminIntent, type AdminError } from './contracts'
import { submitAdministrationCommand } from './server'

const statuses: Record<AdminError, number> = {
  invalid_request: 400, unauthorised: 401, forbidden: 403, unconfigured: 403,
  mfa_required: 403, step_up_required: 403, conflict: 409, expired: 409,
  governance_hold: 409, rate_limited: 429, unavailable: 503,
}
export function administrationErrorResponse(error: AdminError, status = statuses[error]): NextResponse {
  return privateResponse(NextResponse.json({ ok: false, error }, { status }))
}

// Dispatcher owns method/origin checks, the bounded body read and jar.finish.
export async function handleAdministrationAction(form: URLSearchParams, client: SupabaseClient): Promise<NextResponse> {
  try {
    if (!(form instanceof URLSearchParams) || new TextEncoder().encode(form.toString()).length > 8192) return administrationErrorResponse('invalid_request')
    const fields: Record<string, string> = Object.create(null)
    for (const [key, value] of form) {
      if (Object.hasOwn(fields, key)) return administrationErrorResponse('invalid_request')
      fields[key] = value
    }
    const intent = parseAdminIntent(fields)
    if (!intent) return administrationErrorResponse('invalid_request')
    const result = await submitAdministrationCommand(client, intent)
    return result.ok ? privateResponse(NextResponse.json(result)) : administrationErrorResponse(result.error)
  } catch { return administrationErrorResponse('unavailable') }
}
