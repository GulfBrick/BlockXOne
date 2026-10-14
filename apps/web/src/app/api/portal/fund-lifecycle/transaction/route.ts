import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundPreparationRequestSchema } from '@/lib/portal/fund-lifecycle-contracts'
import { prepareExecution } from '@/lib/portal/fund-lifecycle-execution'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundPreparationRequestSchema, (input, { client }) => prepareExecution(client, input))
}
