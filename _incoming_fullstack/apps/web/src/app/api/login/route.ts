import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const returnTo = searchParams.get('returnTo') || '/'
  
  // In production, this would redirect to Replit Auth
  // For now, redirect back to the home page (simulating successful login)
  const redirectUrl = new URL(returnTo, request.url)
  
  return NextResponse.redirect(redirectUrl, 302)
}
