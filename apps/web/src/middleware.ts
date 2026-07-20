import { NextRequest, NextResponse } from 'next/server'

import { isProductionWebPathBlocked } from './lib/release-policy'

export function middleware(request: NextRequest) {
  if (isProductionWebPathBlocked(request.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        'Cache-Control': 'no-store'
      }
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|bxo_drop.mp4).*)']
}
