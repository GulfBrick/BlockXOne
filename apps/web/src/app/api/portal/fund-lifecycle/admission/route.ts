import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { admitFundRelease, fundAdmissionRequestSchema } from '@/lib/portal/fund-admission-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundAdmissionRequestSchema, (input, { client, actorId }) => admitFundRelease(client, actorId, input))
}
