import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundRecipientReadRequestSchema } from '@/lib/portal/fund-recipient-contracts'
import { readFundRecipient } from '@/lib/portal/fund-recipient-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundRecipientReadRequestSchema, async (input, { client, actorId }) => ({ snapshot: await readFundRecipient(client, actorId, input.case_id, input.operating_context) }))
}
