'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WALLET_CHAIN_ID, WALLET_CHAIN_NAME, WALLET_ORIGIN, type LinkedWallet, type WalletChallenge, type WalletErrorCode } from '@/lib/wallets/contracts'

export type MetaMaskProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
}
type MetaMaskChoice = { id: string; provider: MetaMaskProvider }
export type WalletLinkState = {
  phase: 'idle' | 'connecting' | 'connected' | 'challenging' | 'signing' | 'submitting' | 'refreshing' | 'error'
  address: string | null
  chainId: number | null
  message: string
  mustReload: boolean
}
type WalletPost = (path: string, body: URLSearchParams, signal: AbortSignal) => Promise<unknown>

const initialState: WalletLinkState = { phase: 'idle', address: null, chainId: null, message: '', mustReload: false }
const addressPattern = /^0x[0-9a-f]{40}$/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const busyPhases = new Set(['connecting', 'challenging', 'signing', 'submitting', 'refreshing'])
const errorCopy: Record<WalletErrorCode, string> = {
  invalid_request: 'Wallet verification could not start. Reconnect MetaMask and try again.',
  unauthorised: 'Your session or organisation access has changed. Reload the workspace and sign in again if needed.',
  unavailable: 'Wallet linking is temporarily unavailable. Please try again later.',
  expired: 'The ownership request expired. Select Verify wallet ownership to request a new one.',
  conflict: 'This wallet cannot be linked to this organisation. Contact your administrator.',
  invalid_signature: 'The ownership signature could not be verified. Reconnect the intended account and try again.',
  rate_limited: 'Too many ownership requests. Wait ten minutes before trying again.',
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function safeAddress(value: unknown): string | null {
  return typeof value === 'string' && addressPattern.test(value) && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null
}
function firstAccount(value: unknown): string | null { return Array.isArray(value) ? safeAddress(value[0]) : null }
function chainNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null
  const parsed = Number.parseInt(value.slice(2), 16)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function responseError(value: unknown): string | null {
  if (!record(value) || value.ok !== false) return null
  return typeof value.error === 'string' && Object.hasOwn(errorCopy, value.error)
    ? errorCopy[value.error as WalletErrorCode] : errorCopy.unavailable
}
function challengeFrom(value: unknown, address: string, now: number): WalletChallenge | null {
  if (!record(value) || value.ok !== true || !record(value.challenge)) return null
  const c = value.challenge
  if (typeof c.challengeId !== 'string' || !uuidPattern.test(c.challengeId) || safeAddress(c.address) !== address ||
      c.chainId !== WALLET_CHAIN_ID || c.domain !== WALLET_ORIGIN || typeof c.message !== 'string' ||
      !c.message.startsWith('Link this wallet to BlockXOne. This is not a transaction or financial approval.') ||
      c.message.length > 8_192 || typeof c.issuedAt !== 'string' || typeof c.expiresAt !== 'string') return null
  const issued = Date.parse(c.issuedAt); const expires = Date.parse(c.expiresAt)
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= now || expires <= issued || expires - issued > 300_000) return null
  return c as WalletChallenge
}
function walletFrom(value: unknown, organisationId: string, address: string): LinkedWallet | null {
  if (!record(value) || value.ok !== true || !record(value.wallet)) return null
  const w = value.wallet
  return typeof w.id === 'string' && uuidPattern.test(w.id) && w.organisationId === organisationId &&
    safeAddress(w.address) === address && w.chainId === WALLET_CHAIN_ID && w.status === 'PENDING' &&
    typeof w.verifiedAt === 'string' && Number.isFinite(Date.parse(w.verifiedAt)) ? w as LinkedWallet : null
}

// Announced metadata is a selection hint, not proof of provider or wallet identity.
// Never render supplied icons/HTML or fall back to an arbitrary injected provider.
export function discoverMetaMask(target: EventTarget, onProvider: (provider: MetaMaskChoice) => void): () => void {
  const seen = new Set<string>()
  const announce = (event: Event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    if (!record(detail) || !record(detail.info) || !record(detail.provider)) return
    const { info, provider } = detail
    if (info.rdns !== 'io.metamask' || typeof info.uuid !== 'string' || !uuidPattern.test(info.uuid) ||
      typeof provider.request !== 'function' || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function' || seen.has(info.uuid)) return
    seen.add(info.uuid)
    onProvider({ id: info.uuid, provider: provider as MetaMaskProvider })
  }
  target.addEventListener('eip6963:announceProvider', announce)
  target.dispatchEvent(new Event('eip6963:requestProvider'))
  return () => target.removeEventListener('eip6963:announceProvider', announce)
}

// A bounded controller makes the exact browser interaction testable without a DOM
// shim. Signature/message values exist only in the lifetime of one user action.
export function createWalletLinkController(deps: { post: WalletPost; refresh: () => void; onChange: (state: WalletLinkState) => void; now?: () => number; savedMessage?: string }) {
  let state: WalletLinkState = { ...initialState }
  let provider: MetaMaskProvider | null = null
  let organisationId = ''
  let generation = 0
  let abort: AbortController | null = null
  let disposed = false
  let expectedWallet: LinkedWallet | null = null
  const now = deps.now ?? Date.now
  const update = (patch: Partial<WalletLinkState>) => {
    if (disposed) return
    state = { ...state, ...patch }; deps.onChange({ ...state })
  }
  const invalidate = () => {
    generation += 1; abort?.abort(); abort = null
    const unknown = state.mustReload || state.phase === 'submitting' || state.phase === 'refreshing'
    update({ phase: 'idle', address: null, chainId: null, mustReload: unknown,
      message: unknown ? 'Wallet changed while verification was being saved. Reload the workspace to check its status.' : 'Wallet account or network changed. Connect MetaMask again.' })
  }
  const events = ['accountsChanged', 'chainChanged', 'disconnect']
  const detach = () => { if (provider) for (const event of events) { try { provider.removeListener(event, invalidate) } catch { /* A failed provider cannot prevent attempt invalidation. */ } } }
  const begin = (phase: WalletLinkState['phase'], message: string) => {
    generation += 1; abort?.abort(); abort = new AbortController()
    update({ phase, message }); return { id: generation, signal: abort.signal }
  }
  const current = (attempt: { id: number; signal: AbortSignal }) => !disposed && !attempt.signal.aborted && attempt.id === generation
  const stable = async (selected: MetaMaskProvider, address: string, attempt: { id: number; signal: AbortSignal }) => {
    const account = firstAccount(await selected.request({ method: 'eth_accounts' }))
    if (!current(attempt)) return false
    const chain = chainNumber(await selected.request({ method: 'eth_chainId' }))
    if (!current(attempt)) return false
    if (account !== address || chain !== WALLET_CHAIN_ID) { invalidate(); return false }
    return true
  }
  const reject = (error: unknown) => update({ phase: 'error', message: record(error) && error.code === 4001
    ? 'Request cancelled in MetaMask. No ownership change was confirmed.'
    : 'MetaMask could not complete the request. Unlock the wallet, check its connection and try again.' })

  return {
    getState: () => ({ ...state }),
    select(next: MetaMaskProvider | null, org: string) {
      if (disposed || (provider === next && organisationId === org)) return
      detach(); invalidate(); provider = next; organisationId = org; expectedWallet = null
      if (provider) {
        try { for (const event of events) provider.on(event, invalidate) }
        catch { detach(); provider = null; update({ phase: 'error', message: 'MetaMask could not be monitored safely. Reload the wallet and try again.' }); return }
      }
      update({ message: state.mustReload ? state.message : '' })
    },
    async connect() {
      if (disposed || busyPhases.has(state.phase) || state.mustReload) return
      if (!provider || !organisationId) { update({ phase: 'error', message: 'Select your organisation and a MetaMask wallet first.' }); return }
      const selected = provider
      const attempt = begin('connecting', 'Open MetaMask to connect your account…')
      try {
        const address = firstAccount(await selected.request({ method: 'eth_requestAccounts' }))
        if (!current(attempt)) return
        if (!address) { update({ phase: 'error', message: 'Unlock MetaMask and select an account, then connect again.' }); return }
        const chainId = chainNumber(await selected.request({ method: 'eth_chainId' }))
        if (!current(attempt)) return
        if (!chainId) { update({ phase: 'error', message: 'MetaMask returned an unsupported network. Check the wallet and reconnect.' }); return }
        update({ phase: 'connected', address, chainId, message: chainId === WALLET_CHAIN_ID
          ? 'Connected. Review your account and network, then verify wallet ownership.'
          : 'Switch to Polygon Amoy testnet (80002) in MetaMask, then reconnect. No automatic network change will be requested.' })
      } catch (error) { if (current(attempt)) reject(error) }
    },
    async verify() {
      if (disposed || busyPhases.has(state.phase) || state.mustReload) return
      if (!provider || !organisationId || !state.address || state.chainId !== WALLET_CHAIN_ID) return
      const selected = provider; const address = state.address; const org = organisationId
      const attempt = begin('challenging', 'Preparing a one-time ownership request…')
      let consumeStarted = false
      try {
        const issued = await deps.post('/api/wallet/challenge', new URLSearchParams({ organisationId: org, address, chainId: String(WALLET_CHAIN_ID) }), attempt.signal)
        if (!current(attempt)) return
        const issuedError = responseError(issued)
        if (issuedError) { update({ phase: 'error', message: issuedError }); return }
        const challenge = challengeFrom(issued, address, now())
        if (!challenge) { update({ phase: 'error', message: 'The ownership request is invalid or expired. Reconnect and request a new one.' }); return }
        if (!await stable(selected, address, attempt)) return
        update({ phase: 'signing', message: 'Review the ownership-only message in MetaMask. No payment or token approval is requested.' })
        const bytes = new TextEncoder().encode(challenge.message)
        const encoded = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
        const signature = await selected.request({ method: 'personal_sign', params: [encoded, address] })
        if (!current(attempt)) return
        if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) { update({ phase: 'error', message: errorCopy.invalid_signature }); return }
        if (!await stable(selected, address, attempt)) return
        if (Date.parse(challenge.expiresAt) <= now()) { update({ phase: 'error', message: errorCopy.expired }); return }
        update({ phase: 'submitting', message: 'Verifying ownership securely…' }); consumeStarted = true
        const result = await deps.post('/api/wallet/verify', new URLSearchParams({ organisationId: org, challengeId: challenge.challengeId, signature }), attempt.signal)
        if (!current(attempt)) return
        const resultError = responseError(result)
        if (resultError) {
          // A lost commit acknowledgement can be surfaced as unavailable. It is
          // not evidence of rollback; only a fresh server read resolves it.
          if (!record(result) || result.error === 'unavailable' || typeof result.error !== 'string' || !Object.hasOwn(errorCopy, result.error)) throw Error('Unconfirmed result')
          update({ phase: 'error', message: resultError }); return
        }
        expectedWallet = walletFrom(result, org, address)
        if (!expectedWallet) throw Error('Unconfirmed result')
        update({ phase: 'refreshing', message: 'Ownership response received. Reloading the saved workspace state…' })
        deps.refresh()
      } catch (error) {
        if (!current(attempt)) return
        if (consumeStarted) update({ phase: 'error', mustReload: true, message: 'Unable to confirm whether ownership was saved. Reload the workspace before trying again.' })
        else if (state.phase === 'challenging') update({ phase: 'error', message: errorCopy.unavailable })
        else reject(error)
      }
    },
    acceptReload(wallets: LinkedWallet[]) {
      if (state.phase !== 'refreshing' || !expectedWallet) return
      const expected = expectedWallet
      if (wallets.some((wallet) => wallet.id === expected.id && wallet.verifiedAt === expected.verifiedAt && wallet.organisationId === expected.organisationId && wallet.status === 'PENDING')) {
        expectedWallet = null; update({ phase: 'connected', message: deps.savedMessage ?? 'Saved ownership is shown below. Compliance approval is still pending.' })
      }
    },
    dispose() { detach(); generation += 1; abort?.abort(); expectedWallet = null; disposed = true },
  }
}

async function postWallet(path: string, body: URLSearchParams, signal: AbortSignal, expectedActorId?: string): Promise<unknown> {
  const response = await fetch(path, { method: 'POST', body, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      ...(expectedActorId ? { 'X-BX1-Expected-Actor': expectedActorId } : {}) } })
  const value: unknown = await response.json()
  if (!record(value) || (response.ok !== (value.ok === true))) throw Error('Unconfirmed response')
  return value
}

type WalletLinkProps = { organisations: Array<{ id: string; name: string }>; wallets: LinkedWallet[]; configured: boolean; readUnavailable?: boolean; onRefresh?: () => void; expectedActorId?: string; appearance?: 'workspace' | 'portal' }
export function MetaMaskWalletLink({ organisations, wallets, configured, readUnavailable = false, onRefresh, expectedActorId, appearance = 'workspace' }: WalletLinkProps) {
  const [choices, setChoices] = useState<MetaMaskChoice[]>([])
  const [choiceId, setChoiceId] = useState('')
  const [organisationId, setOrganisationId] = useState(organisations.length === 1 ? organisations[0].id : '')
  const [state, setState] = useState<WalletLinkState>(initialState)
  const controller = useRef<ReturnType<typeof createWalletLinkController> | null>(null)
  const refresh = useRef(onRefresh)
  const status = useRef<HTMLParagraphElement | null>(null)
  const available = configured && !readUnavailable
  useEffect(() => { refresh.current = onRefresh }, [onRefresh])
  useEffect(() => {
    if (!organisations.some(organisation => organisation.id === organisationId)) {
      setOrganisationId(organisations.length === 1 ? organisations[0].id : '')
    }
  }, [organisations, organisationId])
  useEffect(() => {
    if (!available) return
    setState({ ...initialState })
    const instance = createWalletLinkController({ post: (path, body, signal) => postWallet(path, body, signal, expectedActorId),
      savedMessage: appearance === 'portal' ? 'Wallet ownership saved. Choose this proof as your fund delivery wallet below.' : undefined, refresh: () => {
      if (refresh.current) refresh.current()
      else window.location.reload()
    }, onChange: setState })
    controller.current = instance
    const stop = discoverMetaMask(window, (choice) => setChoices((current) => current.some((entry) => entry.id === choice.id) ? current : [...current, choice]))
    return () => { stop(); instance.dispose(); controller.current = null }
  }, [available, expectedActorId, appearance])
  const selectedId = choiceId || (choices.length === 1 ? choices[0].id : '')
  useEffect(() => { controller.current?.select(choices.find((entry) => entry.id === selectedId)?.provider ?? null, organisationId) }, [choices, selectedId, organisationId, available, expectedActorId, appearance])
  useEffect(() => { controller.current?.acceptReload(wallets) }, [wallets])
  useEffect(() => { if (state.phase === 'error') status.current?.focus() }, [state.phase, state.message])
  const busy = busyPhases.has(state.phase)
  const portal = appearance === 'portal'
  const ink = portal ? 'text-[#102238]' : 'text-bxo-text-primary'
  const muted = portal ? 'text-[#495b6d]' : 'text-bxo-text-secondary'
  const line = portal ? 'border-[#d7e1e8]' : 'border-bxo-border-subtle'
  const focus = portal ? 'focus-visible:ring-[#007780]' : 'focus-visible:ring-bxo-accent-primary'
  const controlClass = `min-h-11 w-full min-w-0 rounded-xl border ${line} ${portal ? 'bg-white' : 'bg-bxo-bg-primary'} px-3 py-2 text-base ${ink} focus-visible:outline-none focus-visible:ring-2 ${focus}`
  const buttonClass = `h-auto min-h-11 max-w-full whitespace-normal ${focus}`
  const outlineClass = `${buttonClass} ${portal ? 'border-[#b8c8d4] bg-white text-[#102238] hover:border-[#718a9d] hover:bg-[#eaf2f6] hover:text-[#102238]' : ''}`
  const primaryClass = `${buttonClass} ${portal ? 'bg-[#00e1ea] text-[#102238] hover:bg-[#a8f4f5]' : ''}`
  return <section aria-labelledby="workspace-wallet" className={`mt-8 min-w-0 rounded-xl border ${line} ${portal ? 'bg-white' : 'bg-bxo-surface'} p-6`}>
    <h2 id="workspace-wallet" className={`text-xl font-semibold ${ink}`}>MetaMask wallet</h2>
    <p className={`mt-3 text-base leading-7 ${muted}`}>Ownership verification only. No payment, gas fee or token approval.</p>
    <p className={`mt-2 text-base ${muted}`}>Required network: {WALLET_CHAIN_NAME} · Chain ID {WALLET_CHAIN_ID}</p>
    {!available ? <p role="status" className={`mt-4 text-base ${muted}`}>{readUnavailable ? 'Wallet records are temporarily unavailable. Reload the workspace before linking a wallet.' : 'Wallet linking is being configured'}</p> : <>
      <div className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2">
        {organisations.length > 1 ? <div className="min-w-0"><label htmlFor="wallet-organisation" className={`mb-2 block ${portal ? 'text-base' : 'text-sm'} font-semibold ${ink}`}>Organisation</label>
          <select id="wallet-organisation" className={controlClass} value={organisationId} disabled={busy || state.mustReload} onChange={(event) => setOrganisationId(event.target.value)}>
            <option value="">Select organisation</option>{organisations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select></div> : <p className={`break-words text-base ${muted}`}>Organisation: {organisations[0]?.name ?? 'No active organisation'}</p>}
        {choices.length > 1 ? <div className="min-w-0"><label htmlFor="wallet-provider" className={`mb-2 block ${portal ? 'text-base' : 'text-sm'} font-semibold ${ink}`}>MetaMask provider</label>
          <select id="wallet-provider" className={controlClass} value={selectedId} disabled={busy || state.mustReload} onChange={(event) => setChoiceId(event.target.value)}>
            <option value="">Select MetaMask provider</option>{choices.map((choice, index) => <option key={choice.id} value={choice.id}>MetaMask {index + 1} ({choice.id.slice(0, 8)})</option>)}
          </select></div> : null}
      </div>
      {choices.length === 0 ? <p className={`mt-4 text-base leading-7 ${muted}`}>MetaMask was not detected. Open this site in your MetaMask-enabled browser, or install MetaMask from its official website and reload. Never share your secret recovery phrase.</p> : null}
      {state.address ? <div className={`mt-4 min-w-0 space-y-2 text-base ${muted}`}><p>Connected account: <span className={`block break-all font-mono ${ink}`}>{state.address}</span></p><p>Current network: {state.chainId === WALLET_CHAIN_ID ? WALLET_CHAIN_NAME : 'Unsupported network'} · Chain ID {state.chainId}</p></div> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" className={outlineClass} disabled={busy || state.mustReload || !selectedId || !organisationId} onClick={() => void controller.current?.connect()}>Connect MetaMask</Button>
        <Button type="button" className={primaryClass} disabled={busy || state.mustReload || !state.address || state.chainId !== WALLET_CHAIN_ID} onClick={() => void controller.current?.verify()}>Verify wallet ownership</Button>
        {state.mustReload || state.phase === 'refreshing' ? <Button type="button" variant="outline" className={outlineClass} onClick={() => {
          if (state.mustReload || !refresh.current) window.location.reload()
          else refresh.current()
        }}>{state.mustReload ? 'Reload workspace' : 'Refresh saved wallets'}</Button> : null}
      </div>
      <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className={`mt-4 break-words text-base leading-7 ${muted} focus-visible:outline-none focus-visible:ring-2 ${focus}`}>{state.message}</p>
    </>}
    {wallets.length > 0 ? <ul aria-label="Saved wallet ownership" className="mt-6 space-y-4">{wallets.map((wallet) => <li key={wallet.id} className={`min-w-0 rounded-xl border ${line} p-4`}>
      <p className={`text-base font-semibold ${ink}`}>{portal ? 'Saved ownership proof' : 'Ownership verified: compliance pending'}</p>
      <p className={`mt-2 break-words text-base ${muted}`}>{organisations.find((org) => org.id === wallet.organisationId)?.name}</p>
      <p className={`mt-2 break-all font-mono text-sm ${ink}`}>{wallet.address}</p>
      <p className={`mt-2 text-base ${muted}`}>{WALLET_CHAIN_NAME} · Chain ID {wallet.chainId}{portal ? '' : ` · ${wallet.status}`}</p>
      <p className={`mt-2 break-words text-sm ${muted}`}>Verified: <time dateTime={wallet.verifiedAt}>{wallet.verifiedAt}</time></p>
    </li>)}</ul> : null}
    <p className={`mt-4 text-sm leading-6 ${muted}`}>Wallet ownership does not approve transactions or grant financial access.</p>
  </section>
}
