import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundSafeSignatureRequestSchema } from '@/lib/portal/fund-lifecycle-contracts'
import { recordExecutionSignature } from '@/lib/portal/fund-lifecycle-execution'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundSafeSignatureRequestSchema, (input, { client }) => recordExecutionSignature(client, input))
}
