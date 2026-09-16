import { NextResponse } from 'next/server'
import { proxyJsonToApi } from '@/lib/server-api'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
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
    return await proxyJsonToApi('/v1/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
    })
  } catch (error) {
    console.error('Signup proxy error:', error)
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 502 })
  }
}
