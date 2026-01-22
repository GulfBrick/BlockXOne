import { NextResponse } from 'next/server'

// Mock user for development
const mockUser = {
  id: '1',
  email: 'demo@blockxone.com',
  role: 'Investor',
  status: 'Active',
  kyc_status: 'Approved',
  devices: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export async function GET() {
  // For now, return mock user
  // In production, this would check session and return actual user
  return NextResponse.json(mockUser)
}
