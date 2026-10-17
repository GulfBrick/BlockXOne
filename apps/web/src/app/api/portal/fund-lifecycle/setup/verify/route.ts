import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundSetupVerifyRequestSchema } from '@/lib/portal/fund-setup-contracts'
import { verifyFundSetup } from '@/lib/portal/fund-setup-server'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundSetupVerifyRequestSchema, (input, { client, actorId }) => verifyFundSetup(client, actorId, input))
}
