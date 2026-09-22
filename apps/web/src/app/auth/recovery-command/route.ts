import { type NextRequest, NextResponse } from 'next/server'
import { resolveAuthMode } from '@/lib/auth-mode'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { handleRecoveryAction, recoveryErrorResponse } from '@/lib/recovery/actions'
import { RecoveryOperation } from '@/lib/recovery/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
async function readRecoveryForm(request: NextRequest, operation: RecoveryOperation): Promise<URLSearchParams> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new Error()
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new Error()
  const reader = request.body?.getReader()
  if (!reader) return new URLSearchParams()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  operation.signal.addEventListener('abort', cancel, { once: true })
  if (operation.signal.aborted) cancel()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await operation.wait(() => reader.read())
      if (done) break
      size += value.length
      if (size > 8192) { cancel(); throw new Error() }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new Error()
    operation.check()
    return form
  } finally { operation.signal.removeEventListener('abort', cancel); reader.releaseLock() }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const jar = responseCookieAdapter(request)
  const operation = new RecoveryOperation(request.signal)
  try {
    const mode = resolveAuthMode()
    if (mode !== 'supabase') return jar.finish(recoveryErrorResponse('unavailable', mode === 'legacy' ? 404 : 503))
    if (request.nextUrl.pathname !== '/auth/recovery-command' || request.nextUrl.search) return jar.finish(recoveryErrorResponse('invalid_request'))
    if (!hasCanonicalOrigin(request) || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) return jar.finish(recoveryErrorResponse('forbidden'))
    let form: URLSearchParams
    try { form = await readRecoveryForm(request, operation) } catch { return jar.finish(recoveryErrorResponse(operation.signal.aborted ? 'unavailable' : 'invalid_request')) }
    operation.check()
    const client = createRequestSupabaseClient(jar.adapter)
    return jar.finish(await handleRecoveryAction(form, client, operation))
  } catch { return jar.finish(recoveryErrorResponse('unavailable')) }
  finally { operation.dispose() }
}
function methodNotAllowed(): NextResponse {
  return privateResponse(NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 405, headers: { Allow: 'POST' } }))
}
export const GET = methodNotAllowed
export const HEAD = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const OPTIONS = methodNotAllowed
