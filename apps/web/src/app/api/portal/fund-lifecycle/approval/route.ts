import { NextRequest } from 'next/server'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { fundApprovalRequestSchema } from '@/lib/portal/fund-lifecycle-contracts'
import { executeFundCommand } from '@/lib/portal/fund-lifecycle-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, fundApprovalRequestSchema, async (input, { client, actorId }) => ({
    fund_lifecycle: await executeFundCommand(client, actorId, input.operating_context, input.command,
      input.request_key, { operation_id: input.operation_id, expected_revision: input.expected_revision }, input.signing_address),
  }))
}
