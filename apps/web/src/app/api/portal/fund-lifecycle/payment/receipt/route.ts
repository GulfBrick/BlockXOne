import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundPaymentReceiptRequestSchema } from '@/lib/portal/fund-payment-receipt-contracts'
import { resolveFundPaymentReceipt } from '@/lib/portal/fund-payment-receipt'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundPaymentReceiptRequestSchema, (input, { client, actorId }) => resolveFundPaymentReceipt(client, actorId, input))
}
