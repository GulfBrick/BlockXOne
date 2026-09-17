import { NextResponse } from 'next/server'
import { isProductionWebPathBlocked } from '@/lib/release-policy'
import { resolveAuthMode } from '@/lib/auth-mode'

export async function GET(request: Request) {
  if (isProductionWebPathBlocked('/api/login')) {
    return NextResponse.json({ error: 'unavailable' }, {
      status: resolveAuthMode() === 'invalid' ? 503 : 404,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }
  const { searchParams } = new URL(request.url)
  const returnTo = searchParams.get('returnTo') || '/'
  
  // In production, this would redirect to Replit Auth
  // For now, redirect back to the home page (simulating successful login)
  const redirectUrl = new URL(returnTo, request.url)
  
  return NextResponse.redirect(redirectUrl, 302)
}
