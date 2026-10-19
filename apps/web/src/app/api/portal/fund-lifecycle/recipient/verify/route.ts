import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundRecipientVerifyRequestSchema } from '@/lib/portal/fund-recipient-contracts'
import { verifyFundRecipient } from '@/lib/portal/fund-recipient-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundRecipientVerifyRequestSchema, async (input, { client, actorId }) => ({ snapshot: await verifyFundRecipient(client, actorId, input) }))
}
