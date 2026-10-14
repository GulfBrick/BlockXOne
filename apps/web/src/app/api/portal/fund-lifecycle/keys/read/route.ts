import { NextRequest } from 'next/server'
import { z } from 'zod'
import { fundApiRequest, requireFundRpcResult } from '@/lib/portal/fund-lifecycle-api'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'

const requestSchema = z.object({ product_id: z.string().uuid(), operating_context: portalOperatingContextSchema }).strict()
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, requestSchema, async (input, { client }) => {
    const { data, error } = await client.rpc('bx1_portal_fund_roleplay_read', input).abortSignal(AbortSignal.timeout(10000))
    if (data === null && !error) return { policy: null }
    return { policy: requireFundRpcResult(data, error) }
  })
}
