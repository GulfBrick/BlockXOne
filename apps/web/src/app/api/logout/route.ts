import { NextResponse } from 'next/server'
import { isProductionWebPathBlocked } from '@/lib/release-policy'
import { resolveAuthMode } from '@/lib/auth-mode'

export async function GET() {
  if (isProductionWebPathBlocked('/api/logout')) {
    return NextResponse.json({ error: 'unavailable' }, {
      status: resolveAuthMode() === 'invalid' ? 503 : 404,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }
  // For now, redirect to home
  // In production, this would clear session and redirect to Replit logout
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
}
