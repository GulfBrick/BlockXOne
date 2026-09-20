import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { privateResponse } from '../supabase/http'
import { parseRecoveryIntent, type RecoveryError } from './contracts'
import { submitRecoveryCommand, type RecoveryOperation } from './server'

const statuses: Record<RecoveryError, number> = { invalid_request: 400, unauthorised: 401, forbidden: 403, step_up_required: 403, conflict: 409, expired: 409, unavailable: 503 }
export function recoveryErrorResponse(error: RecoveryError, status = statuses[error]): NextResponse {
  return privateResponse(NextResponse.json({ ok: false, error }, { status }))
}
export async function handleRecoveryAction(form: URLSearchParams, client: SupabaseClient, operation?: RecoveryOperation): Promise<NextResponse> {
  try {
    if (!(form instanceof URLSearchParams) || new TextEncoder().encode(form.toString()).length > 8192) return recoveryErrorResponse('invalid_request')
    const fields: Record<string, string> = Object.create(null)
    for (const [key, value] of form) {
      if (Object.hasOwn(fields, key)) return recoveryErrorResponse('invalid_request')
      fields[key] = value
    }
    const intent = parseRecoveryIntent(fields)
    if (!intent) return recoveryErrorResponse('invalid_request')
    const result = await submitRecoveryCommand(client, intent, operation)
    return result.ok ? privateResponse(NextResponse.json(result)) : recoveryErrorResponse(result.error)
  } catch { return recoveryErrorResponse('unavailable') }
}
