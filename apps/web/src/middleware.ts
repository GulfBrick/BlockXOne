import { NextRequest, NextResponse } from 'next/server'

import {
  isPilotWebPathAllowed,
  isProductionWebPathBlocked,
} from './lib/release-policy'

export function middleware(request: NextRequest) {
  if (isProductionWebPathBlocked(request.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        'Cache-Control': 'no-store'
      }
    })
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
