import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthMode } from '@/lib/auth-mode'
import { hasCanonicalOrigin, InvalidAuthRequest, privateResponse, readAuthForm, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { staffInvitationAction, type StaffResult } from '@/lib/administration/staff-invitations'

export const dynamic = 'force-dynamic'
export const revalidate = 0
function status(result: StaffResult): number {
  if (result.ok) return 200
  return { invalid_request:400,unauthorised:401,forbidden:403,mfa_required:403,step_up_required:403,
    governance_hold:423,conflict:409,outcome_unknown:503,unavailable:503 }[result.error]
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const mode = resolveAuthMode()
  if (mode !== 'supabase') return privateResponse(NextResponse.json({ ok:false,error:'unavailable' }, { status:503 }))
  if (request.nextUrl.pathname !== '/auth/staff-invite' || request.nextUrl.search || !hasCanonicalOrigin(request)) {
    return privateResponse(NextResponse.json({ ok:false,error:'invalid_request' }, { status:403 }))
  }
  const jar = responseCookieAdapter(request)
  try {
    const form = await readAuthForm(request)
    const result = await staffInvitationAction(createRequestSupabaseClient(jar.adapter),form)
    return jar.finish(NextResponse.json(result,{status:status(result)}))
  } catch (error) {
    const code = error instanceof InvalidAuthRequest ? 'invalid_request' : 'unavailable'
    return jar.finish(NextResponse.json({ok:false,error:code},{status:code==='invalid_request'?400:503}))
  }
}
