import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundRecipientClaimSigningRequestSchema } from '@/lib/portal/fund-recipient-contracts'
import { readFundRecipientClaimSigningRequest } from '@/lib/portal/fund-recipient-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundRecipientClaimSigningRequestSchema, async (input, { client, actorId }) => readFundRecipientClaimSigningRequest(client, actorId, input.case_id, input.operating_context))
}
