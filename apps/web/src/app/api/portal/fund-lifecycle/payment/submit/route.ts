import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundPaymentSubmitSchema } from '@/lib/portal/fund-lifecycle-contracts'
import { claimFundPayment } from '@/lib/portal/fund-lifecycle-payment'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundPaymentSubmitSchema, (input, { client, actorId }) => claimFundPayment(client, actorId, input))
}
