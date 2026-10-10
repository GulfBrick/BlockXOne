import { NextRequest, NextResponse } from 'next/server'
import { privateResponse } from '@/lib/supabase/http'
import { PortalError } from './server'

export function portalFailure(error: unknown) {
  const known = error instanceof PortalError
  return privateResponse(NextResponse.json({ error: known ? error.message : 'The request outcome is unavailable. Refresh before retrying; do not create a second request.' }, { status: known ? error.status : 503 }))
}
/** Bound actual bytes even when content-length is absent or dishonest. */
export async function readPortalBody(request: NextRequest, limit: number): Promise<Uint8Array> {
  const claimed = request.headers.get('content-length')
  if (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > limit)) throw new PortalError('The request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new PortalError('A request body is required.', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new PortalError('The upload timed out. Try again.', 408)) }, 12000) })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) { await reader.cancel(); throw new PortalError('The request is too large.', 413) }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } finally { clearTimeout(timer); reader.releaseLock() }
}
