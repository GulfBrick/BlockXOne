import type { PortalOperatingContext } from './operating-context'

export class SetupRequestError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message) }
}
export async function setupPost(path: string, body: Record<string, unknown>, actorId: string, context: PortalOperatingContext, signal?: AbortSignal): Promise<unknown> {
  const timeout = path === '/api/portal/fund-lifecycle/setup/retry' || path === '/api/portal/fund-lifecycle/authority-alignment' ? 120000 : 45000
  let response: Response
  try { response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId },
    body: JSON.stringify({ ...body, operating_context: context }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }) }
  catch { throw new SetupRequestError('The request outcome is uncertain. Check the saved setup before retrying.', true) }
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new SetupRequestError('The server did not confirm a saved result. Check the original request before retrying.', true)
  let result: unknown
  try { result = await response.json() } catch { throw new SetupRequestError('The saved response could not be read. Check the original request before retrying.', true) }
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? (result as { error: unknown }).error : null
    throw new SetupRequestError(typeof error === 'string' ? error : 'This action is not currently available. Refresh the saved setup.', response.status >= 500)
  }
  return result
}
