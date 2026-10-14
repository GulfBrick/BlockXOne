import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundRecipientClaimRequestSchema } from '@/lib/portal/fund-recipient-contracts'
import { claimFundRecipient } from '@/lib/portal/fund-recipient-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundRecipientClaimRequestSchema, async (input, { client, actorId }) => claimFundRecipient(client, actorId, input))
}

