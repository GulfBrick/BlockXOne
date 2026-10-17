import { NextRequest } from 'next/server'
import { z } from 'zod'
import { fundApiRequest } from '@/lib/portal/fund-lifecycle-api'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { findFundRecipient } from '@/lib/portal/fund-recipient-server'

const schema = z.object({ delivery_binding_id: z.string().uuid(), operating_context: portalOperatingContextSchema }).strict()
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  return fundApiRequest(request, schema, (input, { client, actorId }) => findFundRecipient(client, actorId, input.delivery_binding_id, input.operating_context))
}
