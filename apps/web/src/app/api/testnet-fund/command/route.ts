import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { hasCanonicalOrigin, responseCookieAdapter } from '@/lib/supabase/http'
import { DEMO_COMMANDS } from '@/lib/testnet-fund/contracts'
import { chainEvidence, DemoError, demoSnapshot, requireDemoAccess, requireDemoEnvironment } from '@/lib/testnet-fund/server'
import { deploymentTransaction, operationTransaction, reconcileFund, verifyDeployment, verifyOperation } from '@/lib/testnet-fund/chain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const envelope = z.object({ command: z.string().max(40), key: z.string().uuid(), payload: z.record(z.unknown()) }).strict()
const id = z.string().uuid()
const hash = z.string().regex(/^0x[0-9a-f]{64}$/i)
const wallet = z.string().regex(/^0x[0-9a-f]{40}$/i)
async function readBody(request: NextRequest): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new DemoError('Expected JSON.', 400)
  const reader = request.body?.getReader()
  if (!reader) throw new DemoError('Request is empty.', 400)
  const chunks: Uint8Array[] = []; let length = 0
  const bodyDeadline = AbortSignal.any([request.signal, AbortSignal.timeout(5000)])
  if (bodyDeadline.aborted) { await reader.cancel(); reader.releaseLock(); throw new DemoError('Request was cancelled.', 408) }
  const cancel = () => { void reader.cancel().catch(() => {}) }
  bodyDeadline.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const part = await reader.read(); if (bodyDeadline.aborted) throw new DemoError('Request body timed out.', 408); if (part.done) break
      length += part.value.length
      if (length > 8192) { await reader.cancel(); throw new DemoError('Request is too large.', 413) }
      chunks.push(part.value)
    }
  } finally { bodyDeadline.removeEventListener('abort', cancel); reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export async function GET(request: NextRequest) {
  const cookies = responseCookieAdapter(request)
  try {
    requireDemoEnvironment()
    const client = createRequestSupabaseClient(cookies.adapter)
    await requireDemoAccess(client)
    return cookies.finish(NextResponse.json({ snapshot: await demoSnapshot(client) }))
  } catch (error) { return cookies.finish(failure(error)) }
}
function failure(error: unknown) {
  if (error instanceof DemoError) return NextResponse.json({ error: error.message, outcome: error.status === 202 ? 'PENDING' : 'NOT_APPLIED_OR_UNKNOWN' }, { status: error.status })
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid demo request.' }, { status: 400 })
  return NextResponse.json({ error: 'Unable to confirm the outcome. Refresh saved state before retrying.', outcome: 'UNKNOWN' }, { status: 503 })
}
export async function POST(request: NextRequest) {
  const cookies = responseCookieAdapter(request)
  const deadline = Date.now() + 48000
  const assertActive = () => { if (request.signal.aborted || Date.now() >= deadline) throw new DemoError('Request expired. Refresh saved state before retrying.', 503) }
  try {
    requireDemoEnvironment()
    if (!hasCanonicalOrigin(request)) throw new DemoError('Request origin is not allowed.', 403)
    const body = envelope.parse(await readBody(request))
    const client = createRequestSupabaseClient(cookies.adapter)
    await requireDemoAccess(client)
    assertActive()
    if ((DEMO_COMMANDS as readonly string[]).includes(body.command)) {
      const { error } = await client.rpc('bx1_demo_command', { p_command: body.command, p_key: body.key, p_payload: body.payload }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]))
      if (error) {
        const rejected = ['23514', '22023', '42501', '23505', '22P02'].includes(error.code)
        throw new DemoError(rejected ? 'The saved state or supplied values do not permit this action. Refresh and check your inputs.' : 'The command outcome is unresolved. Refresh and retry only the original saved request.', rejected ? 409 : 503)
      }
      return cookies.finish(NextResponse.json({ snapshot: await demoSnapshot(client) }))
    }
    const fundId = id.parse(body.payload.fund_id)
    const snapshot = await demoSnapshot(client)
    const fund = snapshot.funds.find(item => item.id === fundId)
    if (!fund) throw new DemoError('Fund not available in your organisation.', 404)
    let result: Record<string, unknown> = {}
    if (body.command === 'prepare_deployment') {
      const payload = z.object({ fund_id: id, wallet }).strict().parse(body.payload)
      if (fund.contract_address) throw new DemoError('This fund already has a verified token.')
      result = { transaction: await deploymentTransaction(payload.wallet) }
    } else if (body.command === 'verify_deployment') {
      const payload = z.object({ fund_id: id, wallet, transaction_hash: hash }).strict().parse(body.payload)
      const verified = await verifyDeployment(payload.transaction_hash, payload.wallet)
      await requireDemoAccess(client)
      const current = (await demoSnapshot(client)).funds.find(item => item.id === fundId)
      if (!current) throw new DemoError('Fund access changed.', 403)
      assertActive()
      await chainEvidence(client, 'bind', [fund.id, verified.contractAddress, verified.owner, payload.transaction_hash.toLowerCase()], assertActive)
    } else if (body.command === 'prepare_transaction' || body.command === 'verify_transaction') {
      const payload = z.object({ fund_id: id, operation_id: id, transaction_hash: hash.optional() }).strict().parse(body.payload)
      const operation = fund.operations.find(item => item.id === payload.operation_id)
      if (!operation) throw new DemoError('Operation not found.', 404)
      if (body.command === 'prepare_transaction') result = { transaction: operationTransaction(fund, operation) }
      else {
        if (!payload.transaction_hash) throw new DemoError('Transaction hash is required.', 400)
        const verified = await verifyOperation(fund, operation, payload.transaction_hash)
        await requireDemoAccess(client)
        const current = (await demoSnapshot(client)).funds.find(item => item.id === fundId)
        if (!current?.operations.some(item => item.id === operation.id)) throw new DemoError('Operation access changed.', 403)
        assertActive()
        await chainEvidence(client, 'confirm', [operation.id, payload.transaction_hash.toLowerCase(), verified.blockNumber, verified.contractAddress], assertActive)
      }
    } else if (body.command === 'reconcile') {
      z.object({ fund_id: id }).strict().parse(body.payload)
      result = { reconciliation: await reconcileFund(fund) }
    } else throw new DemoError('Unknown demo command.', 400)
    return cookies.finish(NextResponse.json({ ...result, snapshot: await demoSnapshot(client) }))
  } catch (error) { return cookies.finish(failure(error)) }
}
