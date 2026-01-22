import { NextResponse } from 'next/server'

export async function GET() {
  // For now, redirect to home
  // In production, this would clear session and redirect to Replit logout
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000'))
}
