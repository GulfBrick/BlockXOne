import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundTransactionRequestSchema } from '@/lib/portal/fund-lifecycle-contracts'
import { claimExecution } from '@/lib/portal/fund-lifecycle-execution'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundTransactionRequestSchema, (input, { client }) => claimExecution(client, input))
}
