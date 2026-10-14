import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundSetupReadRequestSchema } from '@/lib/portal/fund-setup-contracts'
import { readFundSetup } from '@/lib/portal/fund-setup-server'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundSetupReadRequestSchema, (input, { client, actorId }) => readFundSetup(client, actorId, input.product_id, input.operating_context))
}
