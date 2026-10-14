import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundRecipientPrepareRequestSchema } from '@/lib/portal/fund-recipient-contracts'
import { prepareFundRecipient } from '@/lib/portal/fund-recipient-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundRecipientPrepareRequestSchema, async (input, { client, actorId }) => ({ snapshot: await prepareFundRecipient(client, actorId, input) }))
}

