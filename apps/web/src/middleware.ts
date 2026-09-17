import { NextRequest, NextResponse } from 'next/server'

import {
  isPilotWebPathAllowed,
  isProductionWebPathBlocked,
} from './lib/release-policy'
import { isSupabaseWebPathAllowed, resolveAuthMode } from './lib/auth-mode'
import { updateSupabaseSession } from './lib/supabase/middleware'
import { authDocumentReferrerPolicy, type AuthReferrerPolicy } from './lib/auth-referrer-policy'

function privateAuthHeaders(response: NextResponse, referrerPolicy: AuthReferrerPolicy = 'no-referrer'): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  response.headers.set('Referrer-Policy', referrerPolicy)
  return response
}

export async function middleware(request: NextRequest) {
  const authMode = resolveAuthMode()
  if (isProductionWebPathBlocked(request.nextUrl.pathname)) {
    const response = new NextResponse(null, {
      status: authMode === 'invalid' ? 503 : 404,
      headers: {
        'Cache-Control': 'no-store'
      }
    })
    return authMode === 'legacy' ? response : privateAuthHeaders(response)
  }

  if (authMode === 'supabase' && isSupabaseWebPathAllowed(request.nextUrl.pathname)) {
    try {
      // Preserve this exact response: replacing it discards refresh cookies.
      const response = await updateSupabaseSession(request)
      const referrerPolicy = request.method === 'GET' && response.status === 200
        ? authDocumentReferrerPolicy(request.nextUrl.pathname, request.nextUrl.searchParams)
        : 'no-referrer'
      return privateAuthHeaders(response, referrerPolicy)
    } catch {
      return privateAuthHeaders(new NextResponse(null, { status: 503 }))
    }
  }

  const response = NextResponse.next()
  if (isPilotWebPathAllowed(request.nextUrl.pathname)) {
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|brand/|bxo_drop.mp4).*)']
}
