import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundAuthorityAlignmentRequestSchema } from '@/lib/portal/fund-authority-alignment-contracts'
import { handleFundAuthorityAlignment } from '@/lib/portal/fund-authority-alignment-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundAuthorityAlignmentRequestSchema, (input, { client, actorId }) => handleFundAuthorityAlignment(client, actorId, input))
}
