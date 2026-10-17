import { NextRequest } from 'next/server'
import { z } from 'zod'
import { fundApiRequest, requireFundRpcResult } from '@/lib/portal/fund-lifecycle-api'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'

const requestSchema = z.object({ policy_id: z.string().uuid(), authority_epoch: z.number().int().positive(),
  wallet_slot: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), wallet_id: z.string().uuid(), operating_context: portalOperatingContextSchema }).strict()
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, requestSchema, async (input, { client }) => {
    const { data, error } = await client.rpc('bx1_portal_bind_roleplay_signer', input).abortSignal(AbortSignal.timeout(10000))
    return requireFundRpcResult(data, error)
  })
}
