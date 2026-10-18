import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundSetupRetryRequestSchema } from '@/lib/portal/fund-setup-recovery-contracts'
import { recoverFundSetup } from '@/lib/portal/fund-setup-recovery-server'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 120
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundSetupRetryRequestSchema, (input, { client, actorId }) => recoverFundSetup(client, actorId, input))
}
