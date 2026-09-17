import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, readVerifiedUser } from './server'
import { privateResponse, responseCookieAdapter } from './http'

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const cookies = responseCookieAdapter(request)
  try {
    const client = createRequestSupabaseClient(cookies.adapter)
    // Eager, awaited refresh while both request and response cookies are writable.
    // Missing/invalid identity is handled by pages/routes, never by claims alone.
    await readVerifiedUser(client)
    return cookies.finish(NextResponse.next({ request: { headers: request.headers } }))
  } catch {
    return cookies.finish(privateResponse(NextResponse.json({ error: 'unavailable' }, { status: 503 })))
  }
}
