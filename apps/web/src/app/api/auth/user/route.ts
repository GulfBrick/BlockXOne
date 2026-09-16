import { NextResponse } from 'next/server'
import { proxyJsonToApi } from '@/lib/server-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
  }

  try {
    return await proxyJsonToApi('/v1/me', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authHeader,
      },
    })
  } catch (error) {
    console.error('User proxy error:', error)
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 502 })
  }
}
