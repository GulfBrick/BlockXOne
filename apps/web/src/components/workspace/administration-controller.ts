import { parseAdminIntent, parseAdminResult, type AdminIntent, type AdminReadProjection, type AdminResult } from '@/lib/administration/contracts'

export type AdministrationCommandState = {
  phase: 'idle' | 'pending' | 'unknown' | 'confirmed' | 'denied' | 'stale'
  result: AdminResult | null
  retryReady: boolean
  refreshing: boolean
}
type Dependencies = {
  post: (body: URLSearchParams, signal: AbortSignal) => Promise<unknown>
  refresh: () => void
  onChange: (state: AdministrationCommandState) => void
}
const freshState = (): AdministrationCommandState => ({ phase: 'idle', result: null, retryReady: false, refreshing: false })
export function administrationBinding(view: AdminReadProjection): string | null {
  return view.caller && view.scope ? `${view.scope.organisationId}:${view.caller.principalId}:${view.caller.personId}` : null
}

// This controller is deliberately volatile. A refresh reconciles server facts;
// it never proves rollback, replaces a request key, or automatically retries.
export function createAdministrationController(initial: AdminReadProjection, dependencies: Dependencies) {
  let binding = administrationBinding(initial)
  let view = initial
  let state = freshState()
  let intent: AdminIntent | null = null
  let abort: AbortController | null = null
  let generation = 0
  let disposed = false
  const emit = (next: AdministrationCommandState) => { state = next; dependencies.onChange({ ...next }) }
  const invalidate = () => {
    generation += 1
    abort?.abort()
    abort = null
    intent = null
    binding = null
    view = { availability: 'unavailable', scopeRevision: null, policyVersion: 1, caller: null, scope: null, people: [], entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
    emit({ ...freshState(), phase: 'stale' })
  }
  const execute = async () => {
    if (disposed || !intent || view.availability !== 'ready' || !binding || state.phase === 'pending') return
    const frozen = intent
    const ticket = ++generation
    const executionAbort = new AbortController()
    abort = executionAbort
    const signal = executionAbort.signal
    emit({ ...freshState(), phase: 'pending' })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { executionAbort.abort(); reject(new Error('Unavailable')) }, 15_000)
      })
      const body = new URLSearchParams()
      for (const [key, value] of Object.entries(frozen)) body.set(key, value)
      const raw = await Promise.race([dependencies.post(body, signal), deadline])
      if (disposed || ticket !== generation || signal.aborted) return
      const result = parseAdminResult(raw)
      const expectedState = frozen.intent === 'propose' ? 'PENDING_REVIEW' : frozen.intent === 'review' ? (frozen.decision === 'approve' ? 'APPROVED' : 'REJECTED') : frozen.intent === 'apply' ? 'APPLIED' : 'CANCELLED'
      if (!result || (result.ok && (result.state !== expectedState || (frozen.intent !== 'apply' && result.scopeState !== 'READY') || (frozen.intent !== 'propose' && result.proposalId !== frozen.proposalId))) || (!result.ok && result.error === 'unavailable')) {
        emit({ ...freshState(), phase: 'unknown' })
        return
      }
      emit({ ...freshState(), phase: result.ok ? 'confirmed' : 'denied', result, refreshing: true })
      dependencies.refresh()
    } catch {
      if (!disposed && ticket === generation) emit({ ...freshState(), phase: 'unknown' })
    } finally { if (timeout) clearTimeout(timeout); if (ticket === generation) abort = null }
  }
  return {
    getState: () => ({ ...state }),
    matches: (candidate: AdminReadProjection) => binding !== null && binding === administrationBinding(candidate),
    update(candidate: AdminReadProjection) {
      if (disposed) return
      const nextBinding = administrationBinding(candidate)
      const bindingChanged = binding !== nextBinding
      if (!nextBinding || (binding && binding !== nextBinding)) invalidate()
      view = candidate
      binding = nextBinding
      if (state.phase === 'stale' && nextBinding) emit(freshState())
      else if (state.refreshing) emit({ ...state, refreshing: false, retryReady: state.phase === 'unknown' && candidate.availability === 'ready' })
      else if (candidate.availability !== 'ready' && state.retryReady) emit({ ...state, retryReady: false })
      // A newly admitted scope may arrive on an in-place refresh while React
      // still renders the gated branch. Publish binding changes even at idle.
      else if (bindingChanged) emit({ ...state })
    },
    async submit(candidate: AdminIntent) {
      if (disposed || state.phase === 'unknown' || state.phase === 'pending' || state.refreshing || view.availability !== 'ready') return
      const parsed = parseAdminIntent(candidate)
      if (!parsed || parsed.organisationId !== view.scope.organisationId) return
      intent = Object.freeze({ ...parsed })
      await execute()
    },
    checkRecordedStatus() {
      if (disposed || state.phase !== 'unknown' || state.refreshing) return
      emit({ ...state, retryReady: false, refreshing: true })
      dependencies.refresh()
    },
    async retryOriginal() {
      if (state.phase !== 'unknown' || !state.retryReady || state.refreshing) return
      await execute()
    },
    invalidate,
    dispose() { invalidate(); disposed = true },
  }
}

export async function postAdministration(body: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  const response = await fetch('/auth/admin-command', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' }, body, signal,
  })
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) throw new Error('Unavailable')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 131072) throw new Error('Unavailable')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const value: unknown = JSON.parse(text)
    const result = parseAdminResult(value)
    if (!result || (result.ok && !response.ok)) throw new Error('Unavailable')
    return result
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
