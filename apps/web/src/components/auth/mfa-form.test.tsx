import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMfaCodeInputRef, createMfaFormController, registerMfaPageLifecycle, readMfaResponse, MfaForm, type MfaFormState } from './mfa-form'
import { MFA_ENROLL_QR_MAX_CHARACTERS, MFA_ENROLL_RESPONSE_MAX_BYTES, MFA_RESPONSE_MAX_BYTES, type MfaView } from '@/lib/supabase/mfa-contracts'

const factorId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const empty: MfaView = { state: 'unenrolled', factors: [], hasPendingTotp: false }
const enrolled: MfaView = { state: 'challenge_required', factors: [{ id: factorId, status: 'verified', factorType: 'totp' }], hasPendingTotp: false }
const pending: MfaView = { state: 'unenrolled', factors: [{ id: factorId, status: 'unverified', factorType: 'totp' }], hasPendingTotp: true }
const setup = { ok: true, factorId, secret: 'JBSWY3DPEHPK3PXP', qrCode: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>' }
function fixture(view = empty, continuation: 'workspace' | 'setup' | 'security' = 'security') {
  const post = vi.fn<Parameters<typeof createMfaFormController>[0]['post']>().mockResolvedValue(setup)
  const navigate = vi.fn()
  const states: MfaFormState[] = []
  const controller = createMfaFormController({ view, continuation, post, navigate, onChange: state => states.push(state) })
  return { post, navigate, states, controller }
}
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>(done => { resolve = done })
  return { promise, resolve }
}

describe('MFA transient controller', () => {
  it.each([MFA_ENROLL_QR_MAX_CHARACTERS, MFA_ENROLL_QR_MAX_CHARACTERS + 1])('enforces the shared enrollment QR bound: %s', async length => {
    const f = fixture()
    const prefix = 'data:image/svg+xml;utf-8,<svg>'
    f.post.mockResolvedValue({ ...setup, qrCode: `${prefix}${'x'.repeat(length - prefix.length - 6)}</svg>` })
    await f.controller.enroll()
    expect(f.controller.getState().reloadRequired).toBe(length > MFA_ENROLL_QR_MAX_CHARACTERS)
    expect(f.controller.getState().setup?.qrCode.length).toBe(length > MFA_ENROLL_QR_MAX_CHARACTERS ? undefined : length)
    f.controller.dispose()
    expect(f.controller.getState().setup).toBeUndefined()
  })
  it('clears a code input that mounts only after enrollment when detached', () => {
    const input = createMfaCodeInputRef()
    input.clear()
    const lateNode = { value: '012345' }
    input.attach(lateNode)
    input.attach(null)
    expect(lateNode.value).toBe('')
  })
  it('clears the old code node when React replaces it and tracks the new node', () => {
    const input = createMfaCodeInputRef()
    const oldNode = { value: '012345' }
    const newNode = { value: '678901' }
    input.attach(oldNode)
    input.attach(newNode)
    expect(oldNode.value).toBe('')
    expect(newNode.value).toBe('678901')
    input.clear()
    expect(newNode.value).toBe('')
  })
  it('retains the same node until explicit submission or page lifecycle clearing', () => {
    const input = createMfaCodeInputRef()
    const node = { value: '012345' }
    input.attach(node)
    input.attach(node)
    expect(node.value).toBe('012345')
    const target = new EventTarget()
    const remove = registerMfaPageLifecycle(target, input.clear, () => {})
    target.dispatchEvent(new Event('pagehide'))
    expect(node.value).toBe('')
    remove()
    input.attach(null)
    input.clear()
  })
  it('clears setup synchronously on pagehide and removes lifecycle listeners on unmount', async () => {
    const target = new EventTarget()
    const f = fixture()
    await f.controller.enroll()
    const restore = vi.fn()
    const remove = registerMfaPageLifecycle(target, () => f.controller.clear(), restore)
    target.dispatchEvent(new Event('pagehide'))
    expect(f.controller.getState().setup).toBeUndefined()
    expect(f.controller.getState().reloadRequired).toBe(true)
    const cached = new Event('pageshow')
    Object.defineProperty(cached, 'persisted', { value: true })
    target.dispatchEvent(cached)
    expect(restore).toHaveBeenCalledOnce()
    remove()
    target.dispatchEvent(cached)
    expect(restore).toHaveBeenCalledOnce()
  })
  it('ignores ordinary pageshow and clears before restoring a cached page', () => {
    const target = new EventTarget()
    const calls: string[] = []
    const remove = registerMfaPageLifecycle(target, () => calls.push('clear'), () => calls.push('restore'))
    target.dispatchEvent(new Event('pageshow'))
    expect(calls).toEqual([])
    const cached = new Event('pageshow')
    Object.defineProperty(cached, 'persisted', { value: true })
    target.dispatchEvent(cached)
    expect(calls).toEqual(['clear', 'restore'])
    remove()
  })
  it('never enrolls automatically and returns setup only after explicit POST', async () => {
    const f = fixture()
    expect(f.post).not.toHaveBeenCalled()
    expect(f.controller.getState().setup).toBeUndefined()
    await f.controller.enroll()
    expect(f.post.mock.calls[0][0]).toBe('/auth/mfa-enroll')
    expect(f.post.mock.calls[0][1].toString()).toBe('')
    expect(f.controller.getState().setup).toEqual({ factorId, secret: setup.secret, qrCode: setup.qrCode })
  })
  it.each([enrolled, pending, { ...empty, state: 'unsupported_factor' as const }])('never enrolls duplicate or unsupported state %j', async view => {
    const f = fixture(view)
    await f.controller.enroll()
    expect(f.post).not.toHaveBeenCalled()
  })
  it('preserves leading zeros, exact field list and safe fixed continuation', async () => {
    const f = fixture(enrolled, 'setup')
    f.post.mockResolvedValue({ ok: true, next: '/login?setup=1' })
    await f.controller.verify(factorId, '012345')
    expect(f.post.mock.calls[0][0]).toBe('/auth/mfa-verify')
    expect(f.post.mock.calls[0][1].toString()).toBe(`factorId=${factorId}&code=012345&continuation=setup`)
    expect(f.navigate).toHaveBeenCalledWith('/login?setup=1')
    expect(f.controller.getState().setup).toBeUndefined()
  })
  it.each(['12345', '1234567', '123a56', '１２３４５６', ' 123456'])('rejects malformed code %s before POST', async code => {
    const f = fixture(enrolled)
    await f.controller.verify(factorId, code)
    expect(f.post).not.toHaveBeenCalled()
    expect(f.controller.getState().error).toBe('invalid_code')
  })
  it('refuses a factor not supplied by the server view', async () => {
    const f = fixture(enrolled)
    await f.controller.verify(secondId, '123456')
    expect(f.post).not.toHaveBeenCalled()
  })
  it('can verify retained pending enrollment only on security continuation', async () => {
    const allowed = fixture(pending)
    allowed.post.mockResolvedValue({ ok: true, next: '/workspace/security' })
    await allowed.controller.verify(factorId, '123456')
    expect(allowed.post).toHaveBeenCalledOnce()
    const denied = fixture(pending, 'workspace')
    await denied.controller.verify(factorId, '123456')
    expect(denied.post).not.toHaveBeenCalled()
  })
  it('suppresses duplicate submissions and stale responses after pagehide', async () => {
    const f = fixture()
    const d = deferred()
    f.post.mockReturnValue(d.promise)
    const first = f.controller.enroll()
    await f.controller.enroll()
    expect(f.post).toHaveBeenCalledOnce()
    const signal = f.post.mock.calls[0][2]
    f.controller.clear()
    expect(signal.aborted).toBe(true)
    d.resolve(setup)
    await first
    expect(f.controller.getState().setup).toBeUndefined()
    expect(f.controller.getState().reloadRequired).toBe(true)
    expect(f.navigate).not.toHaveBeenCalled()
  })
  it('cannot navigate from a late verification after disposal', async () => {
    const f = fixture(enrolled)
    const d = deferred()
    f.post.mockReturnValue(d.promise)
    const request = f.controller.verify(factorId, '123456')
    f.controller.dispose()
    d.resolve({ ok: true, next: '/workspace' })
    await request
    expect(f.navigate).not.toHaveBeenCalled()
  })
  it.each(['https://evil.test', '//evil.test', '/workspace?token=secret', '/admin', '/workspace/'])('rejects unknown next URL %s', async next => {
    const f = fixture(enrolled)
    f.post.mockResolvedValue({ ok: true, next })
    await f.controller.verify(factorId, '123456')
    expect(f.navigate).not.toHaveBeenCalled()
    expect(f.controller.getState()).toMatchObject({ error: 'unavailable', reloadRequired: true })
  })
  it('erases secret after unknown verify outcome and cannot retry without reload', async () => {
    const f = fixture()
    await f.controller.enroll()
    f.post.mockRejectedValue(Error('secret provider payload'))
    await f.controller.verify(factorId, '123456')
    expect(f.controller.getState()).toMatchObject({ error: 'unavailable', reloadRequired: true })
    expect(f.controller.getState().setup).toBeUndefined()
    await f.controller.enroll()
    expect(f.post).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(f.controller.getState())).not.toContain('provider payload')
  })
  it.each(['invalid_code', 'rate_limited'])('renders fixed recoverable %s without provider text', async error => {
    const f = fixture(enrolled)
    f.post.mockResolvedValue({ ok: false, error, details: 'private' })
    await f.controller.verify(factorId, '123456')
    expect(f.controller.getState()).toMatchObject({ error, reloadRequired: false })
    expect(JSON.stringify(f.controller.getState())).not.toContain('private')
  })
  it.each([{ ...setup, qrCode: 'https://evil.test/qr' }, { ...setup, secret: '<script>' }, { ...setup, factorId: 'invalid' }])('rejects malformed enrollment response', async result => {
    const f = fixture()
    f.post.mockResolvedValue(result)
    await f.controller.enroll()
    expect(f.controller.getState()).toMatchObject({ error: 'unavailable', reloadRequired: true })
    expect(f.controller.getState().setup).toBeUndefined()
  })
})

describe('bounded MFA response transport', () => {
  const response = (body: string | Uint8Array<ArrayBuffer>, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } })
  const sized = (bytes: number) => {
    const emptyBody = JSON.stringify({ ok: true, padding: '' })
    return JSON.stringify({ ok: true, padding: 'x'.repeat(bytes - emptyBody.length) })
  }
  it.each([false, true])('accepts exactly the applicable byte bound, enrollment=%s', async enrollment => {
    const bound = enrollment ? MFA_ENROLL_RESPONSE_MAX_BYTES : MFA_RESPONSE_MAX_BYTES
    const result = await readMfaResponse(response(sized(bound)), enrollment) as { padding: string }
    expect(result.padding.length).toBe(bound - JSON.stringify({ ok: true, padding: '' }).length)
  })
  it.each([false, true])('rejects overflow without returning response material, enrollment=%s', async enrollment => {
    const bound = enrollment ? MFA_ENROLL_RESPONSE_MAX_BYTES : MFA_RESPONSE_MAX_BYTES
    await expect(readMfaResponse(response(sized(bound + 1)), enrollment)).rejects.toThrow('unavailable')
  })
  it('never enlarges failed enrollment or verification response bounds', async () => {
    await expect(readMfaResponse(response(sized(MFA_RESPONSE_MAX_BYTES + 1), 503), true)).rejects.toThrow('unavailable')
    await expect(readMfaResponse(response(sized(MFA_RESPONSE_MAX_BYTES + 1)))).rejects.toThrow('unavailable')
  })
  it('decodes a multibyte value split across stream chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ok: false, error: 'unavailable', ignored: '中' }))
    const boundary = bytes.indexOf(0xe4) + 1
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, boundary)); controller.enqueue(bytes.slice(boundary)); controller.close()
    } })
    const result = await readMfaResponse(new Response(stream, { headers: { 'content-type': 'application/json' } })) as { error: string }
    expect(result.error).toBe('unavailable')
  })
  it('cancels an overflowing stream', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MFA_RESPONSE_MAX_BYTES + 1)) }, cancel })
    await expect(readMfaResponse(new Response(stream, { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('unavailable')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rejects invalid UTF8, incomplete JSON, HTML and success inside failed HTTP', async () => {
    await expect(readMfaResponse(response(new Uint8Array([0xff])))).rejects.toThrow()
    await expect(readMfaResponse(response('{"ok":'))).rejects.toThrow()
    await expect(readMfaResponse(new Response('<html>private</html>'))).rejects.toThrow('unavailable')
    await expect(readMfaResponse(response('{"ok":true}', 403))).rejects.toThrow('unavailable')
  })
})

describe('MFA accessible markup', () => {
  it('offers opt-in without seed, automatic action or removal controls', () => {
    const html = renderToStaticMarkup(<MfaForm view={empty} continuation="security" />)
    expect(html).toContain('Set up authenticator')
    expect(html).not.toContain(setup.secret)
    expect(html).not.toContain('data:image')
    expect(html).not.toMatch(/unenroll|Remove factor|Delete factor/)
  })
  it('provides labelled code field, zero-safe text input and accessible status', () => {
    const html = renderToStaticMarkup(<MfaForm view={enrolled} continuation="workspace" />)
    for (const text of ['Authentication code', 'type="text"', 'inputMode="numeric"', 'autoComplete="one-time-code"', 'maxLength="6"', 'aria-live="polite"', 'Verify code']) expect(html).toContain(text)
  })
  it('states pending lost-secret guidance rather than starting another factor', () => {
    const html = renderToStaticMarkup(<MfaForm view={pending} continuation="security" />)
    expect(html).toContain('Authenticator setup is unfinished.')
    expect(html).toContain('contact support before starting again')
    expect(html).toContain('Verify existing setup')
    expect(html).not.toContain('Set up authenticator')
  })
  it('unsupported factors have no skip, enrollment or challenge control', () => {
    const html = renderToStaticMarkup(<MfaForm view={{ ...empty, state: 'unsupported_factor' }} continuation="workspace" />)
    expect(html).toContain('not supported on this screen')
    expect(html).not.toContain('Authentication code')
    expect(html).not.toContain('Set up authenticator')
  })
  it('offers a selector only for multiple admitted factors', () => {
    const html = renderToStaticMarkup(<MfaForm view={{ ...enrolled, factors: [...enrolled.factors, { id: secondId, status: 'verified', factorType: 'totp' }] }} continuation="workspace" />)
    expect(html).toContain('<select')
    expect(html).toContain('Authenticator 2')
  })
})
