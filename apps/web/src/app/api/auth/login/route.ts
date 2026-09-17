import { NextResponse } from 'next/server'
import { isProductionWebPathBlocked } from '@/lib/release-policy'
import { resolveAuthMode } from '@/lib/auth-mode'
import { proxyJsonToApi } from '@/lib/server-api'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (isProductionWebPathBlocked('/api/auth/login')) {
    return NextResponse.json({ error: 'unavailable' }, {
      status: resolveAuthMode() === 'invalid' ? 503 : 404,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }
  let body: { email?: string; password?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 })
  }

  try {
    return await proxyJsonToApi('/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
    })
  } catch (error) {
    console.error('Login proxy error:', error)
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 502 })
  }
}
