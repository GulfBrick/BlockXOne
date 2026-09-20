'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Bx1Workspace } from '@/lib/supabase/contracts'
import { DEMO_PROJECT, demoMoney, type DemoFund, type DemoOperation, type DemoSnapshot, type DemoTransaction } from '@/lib/testnet-fund/contracts'

type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean; providers?: Provider[] }
type Props = { initial: DemoSnapshot; workspace: Bx1Workspace; artifactAvailable: boolean; chainReady: boolean }
type PendingTransaction = { hash?: string; wallet: string; unknown?: boolean }
const inputClass = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100'
const buttonClass = 'rounded-lg border border-cyan-500/40 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40'
function ethereum(): Provider {
  const root = (window as Window & { ethereum?: Provider }).ethereum
  const provider = root?.providers?.find(item => item.isMetaMask) ?? root
  if (!provider?.isMetaMask) throw new Error('Open this preview in a browser with the MetaMask extension.')
  return provider
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm text-slate-300">{label}{children}</label>
}
function Card({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5 sm:p-7"><h2 className="mb-5 flex items-center gap-3 text-xl font-medium text-white"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/10 text-sm text-cyan-300">{number}</span>{title}</h2>{children}</section>
}
export function TestnetFundDemo({ initial, workspace, artifactAvailable, chainReady }: Props) {
  const [snapshot, setSnapshot] = useState(initial)
  const [fundId, setFundId] = useState(initial.funds[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [wallet, setWallet] = useState('')
  const [name, setName] = useState('BlockXOne Demonstration Fund')
  const [organisation, setOrganisation] = useState(workspace.organisations[0]?.id ?? '')
  const [price, setPrice] = useState('10000')
  const [capacity, setCapacity] = useState('10000')
  const [units, setUnits] = useState('100')
  const [distribution, setDistribution] = useState('10000')
  const [redemptionUnits, setRedemptionUnits] = useState('100')
  const [proof, setProof] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const actionLock = useRef(false)
  useEffect(() => { setHydrated(true) }, [])
  const fund = snapshot.funds.find(item => item.id === fundId) ?? snapshot.funds[0]
  const storagePrefix = `bx1-demo:${DEMO_PROJECT}:${workspace.user.id}:`

  async function execute(command: string, payload: Record<string, unknown>): Promise<{ snapshot?: DemoSnapshot; transaction?: DemoTransaction; reconciliation?: unknown }> {
    const signature = JSON.stringify({ command, payload })
    const unresolvedKey = `${storagePrefix}unresolved`
    const unresolved = localStorage.getItem(unresolvedKey)
    if (unresolved && unresolved !== signature) throw new Error('A previous request has an unresolved outcome. Refresh, then retry the exact saved request before starting another action.')
    const storageKey = `${storagePrefix}request:${signature}`
    let key = localStorage.getItem(storageKey)
    if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key) }
    localStorage.setItem(unresolvedKey, signature)
    const response = await fetch('/api/testnet-fund/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ command, key, payload }), signal: AbortSignal.timeout(55000) })
    const result = await response.json()
    if (result.error || !response.ok) {
      // Definitive denials and pending read-only receipt checks may be corrected.
      // Network/5xx outcomes retain the exact request until an idempotent retry.
      if (response.status < 500) localStorage.removeItem(unresolvedKey)
      throw new Error(result.error ?? 'Outcome not confirmed. Refresh before retrying.')
    }
    localStorage.removeItem(unresolvedKey)
    localStorage.removeItem(storageKey)
    if (result.snapshot) { setSnapshot(result.snapshot); if (!fundId && result.snapshot.funds[0]) setFundId(result.snapshot.funds[0].id) }
    return result
  }
  async function run(action: () => Promise<void>) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'Outcome unknown. Refresh saved state; do not repeat a wallet transaction.') }
    finally { actionLock.current = false; setBusy(false); setRevision(value => value + 1) }
  }
  async function refresh() {
    const response = await fetch('/api/testnet-fund/command', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) })
    const result = await response.json()
    if (!response.ok || !result.snapshot) throw new Error(result.error ?? 'Unable to refresh saved state.')
    setSnapshot(result.snapshot)
  }
  function command(action: string, payload: Record<string, unknown>) {
    void run(async () => { await execute(action, payload); setMessage('Saved to the hosted test database.') })
  }
  async function connect() {
    const provider = ethereum()
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('MetaMask did not supply an account.')
    const chain = await provider.request({ method: 'eth_chainId' })
    if (chain !== '0x13882') await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x13882' }] })
    if (await provider.request({ method: 'eth_chainId' }) !== '0x13882') throw new Error('Select Polygon Amoy (80002) in MetaMask.')
    setWallet(accounts[0].toLowerCase())
    setMessage('MetaMask selected on Amoy. This is a test signer, not institutional signing authority.')
  }
  const transactionKey = (selected: DemoFund, operation?: DemoOperation) => `${storagePrefix}chain:${selected.id}:${operation?.id ?? 'deployment'}`
  function pending(selected: DemoFund, operation?: DemoOperation): PendingTransaction | null {
    if (!hydrated || typeof window === 'undefined') return null
    try { const saved = localStorage.getItem(transactionKey(selected, operation)); return saved ? JSON.parse(saved) : null } catch { return null }
  }
  async function sign(selected: DemoFund, operation?: DemoOperation) {
    const provider = ethereum()
    const key = transactionKey(selected, operation)
    if (localStorage.getItem(key)) throw new Error('A submission is already recorded. Verify it instead of sending again.')
    const accounts = await provider.request({ method: 'eth_accounts' })
    const expectedWallet = operation ? selected.contract_owner : wallet
    if (!expectedWallet || !Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== expectedWallet.toLowerCase()) throw new Error('Select the fund presenter wallet in MetaMask, then reconnect.')
    if (await provider.request({ method: 'eth_chainId' }) !== '0x13882') throw new Error('Select Amoy before signing. Nothing was sent.')
    const prepared = await execute(operation ? 'prepare_transaction' : 'prepare_deployment', operation ? { fund_id: selected.id, operation_id: operation.id } : { fund_id: selected.id, wallet: expectedWallet })
    if (!prepared.transaction) throw new Error('No transaction was prepared.')
    const transaction = prepared.transaction
    if (transaction.from.toLowerCase() !== expectedWallet.toLowerCase() || transaction.value !== '0x0') throw new Error('Prepared signer or native value changed.')
    const summary = operation ? `${operation.kind} ${operation.units} non-transferable demo units for ${operation.wallet}` : 'Deploy a new Amoy-only demonstration fund token'
    if (!window.confirm(`${summary}\n\nNetwork: Polygon Amoy 80002\nSigner: ${expectedWallet}\nNative value: 0 (test gas required)\nNo real money or production authority. Continue to MetaMask?`)) return
    const latest = await provider.request({ method: 'eth_accounts' })
    if (!Array.isArray(latest) || latest[0]?.toLowerCase() !== expectedWallet.toLowerCase() || await provider.request({ method: 'eth_chainId' }) !== '0x13882') throw new Error('Account or network changed. Review again; nothing was sent.')
    // Persist ambiguity BEFORE dispatch. Only explicit user rejection can clear it.
    localStorage.setItem(key, JSON.stringify({ wallet: expectedWallet, unknown: true }))
    try {
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] })
      if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('MetaMask did not return a transaction hash.')
      localStorage.setItem(key, JSON.stringify({ wallet: expectedWallet, hash }))
      setMessage('Transaction submitted. Verify after 12 Amoy confirmations; do not send it again.')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) localStorage.removeItem(key)
      throw error
    }
  }
  async function verify(selected: DemoFund, operation?: DemoOperation) {
    const saved = pending(selected, operation)
    let hash = saved?.hash
    if (!hash) {
      const supplied = window.prompt('Paste the transaction hash from MetaMask Activity or the Amoy explorer. Do not send a replacement transaction.')
      if (!supplied || !/^0x[0-9a-f]{64}$/i.test(supplied.trim())) throw new Error('A valid existing transaction hash is required.')
      hash = supplied.trim()
    }
    const signer = saved?.wallet ?? selected.contract_owner ?? wallet
    if (!signer) throw new Error('Connect the original presenter wallet before verifying the deployment.')
    localStorage.setItem(transactionKey(selected, operation), JSON.stringify({ wallet: signer, hash }))
    await execute(operation ? 'verify_transaction' : 'verify_deployment', operation ? { fund_id: selected.id, operation_id: operation.id, transaction_hash: hash } : { fund_id: selected.id, wallet: signer, transaction_hash: hash })
    setMessage('Amoy receipt verified and saved. Register and accounting updated from confirmed evidence.')
  }
  function chainButtons(selected: DemoFund, operation?: DemoOperation) {
    const saved = pending(selected, operation)
    return <div className="mt-3 flex flex-wrap items-center gap-3" data-revision={revision}>
      <button className={buttonClass} disabled={!hydrated || busy || !artifactAvailable || !chainReady || Boolean(saved) || !wallet} onClick={() => void run(() => sign(selected, operation))}>{operation ? `Sign ${operation.kind.toLowerCase()} in MetaMask` : 'Deploy fund token with MetaMask'}</button>
      <button className={buttonClass} disabled={busy || !artifactAvailable} onClick={() => void run(() => verify(selected, operation))}>Verify existing transaction</button>
      {saved?.hash ? <a className="break-all text-xs text-cyan-300 underline" href={`https://amoy.polygonscan.com/tx/${saved.hash}`} target="_blank" rel="noreferrer">View submitted transaction</a> : saved?.unknown ? <p className="text-sm text-amber-300">Submission uncertain. Check MetaMask Activity; sending is locked.</p> : null}
    </div>
  }
  return <main className="mx-auto max-w-7xl px-4 py-10 text-slate-200 sm:px-8">
    <header className="mb-8 border-b border-slate-700 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-300">BlockXOne / Fund lifecycle</p><Link href="/workspace" className="text-sm text-slate-300 underline">Workspace</Link></div>
      <h1 className="mt-5 text-4xl font-medium tracking-tight text-white sm:text-5xl">From fund launch to investor exit.</h1>
      <p className="mt-4 max-w-3xl text-slate-400">Persisted in Supabase. Signed with MetaMask. Verified on Polygon Amoy. This presenter-led demonstration uses fictional parties and synthetic cash; it does not prove independent production approvals.</p>
      <div className="mt-5 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-cyan-400/10 px-3 py-2 text-cyan-200">AMOY · 80002</span><span className="rounded-full bg-amber-400/10 px-3 py-2 text-amber-200">SYNTHETIC TEST CASH · NO REAL MONEY</span><span className="rounded-full bg-slate-800 px-3 py-2">NON-TRANSFERABLE DEMO UNITS</span></div>
      <div className="mt-6 flex flex-wrap items-center gap-3"><button className={buttonClass} disabled={busy} onClick={() => void run(connect)}>Connect MetaMask / select Amoy</button><button className={buttonClass} disabled={busy} onClick={() => void run(refresh)}>Refresh saved state</button>{wallet ? <span className="break-all text-xs text-slate-400">{wallet}</span> : null}</div>
      {!artifactAvailable ? <p className="mt-4 text-amber-200">Token deployment is unavailable until the cloud-compiled contract artifact is included in this preview.</p> : null}
      {!chainReady ? <p className="mt-4 text-amber-200">The restricted receipt-verifier connection still needs activation on this preview. Wallet transactions are disabled until it is configured.</p> : null}
      <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm text-cyan-100">{busy ? 'Working with the hosted platform…' : message}</p>
      {hydrated && localStorage.getItem(`${storagePrefix}unresolved`) ? <button className={buttonClass} disabled={busy} onClick={() => void run(async () => { await refresh(); const saved = JSON.parse(localStorage.getItem(`${storagePrefix}unresolved`) ?? '{}'); if (saved.command && saved.payload) await execute(saved.command, saved.payload); setMessage('Saved request reconciled using its original key.'); })}>Refresh and retry the exact unresolved request</button> : null}
    </header>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card number="01" title="Create and open the fund">
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); command('create_fund', { organisation_id: organisation, name, unit_price_minor: price, cap_units: capacity }) }}>
          <Field label="Demonstration organisation"><select className={inputClass} value={organisation} onChange={event => setOrganisation(event.target.value)}>{workspace.organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></Field>
          <Field label="Fund name"><input className={inputClass} required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-4"><Field label="Unit price (synthetic cents)"><input className={inputClass} inputMode="numeric" pattern="[1-9][0-9]*" value={price} onChange={event => setPrice(event.target.value)} required /></Field><Field label="Maximum whole units"><input className={inputClass} inputMode="numeric" pattern="[1-9][0-9]*" value={capacity} onChange={event => setCapacity(event.target.value)} required /></Field></div>
          <p className="text-xs text-slate-400">Price: {demoMoney(price)} per unit. Opening freezes these demo terms.</p><button className={buttonClass} disabled={busy} type="submit">Create fictional fund</button>
        </form>
        {snapshot.funds.length ? <div className="mt-6 border-t border-slate-700 pt-5"><Field label="Saved fund"><select className={inputClass} value={fund?.id ?? ''} onChange={event => { setFundId(event.target.value); setProof(null) }}>{snapshot.funds.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></Field>{fund?.status === 'DRAFT' ? <><button className={`${buttonClass} mt-3`} disabled={busy || !fund.contract_address} onClick={() => command('open_offering', { fund_id: fund.id })}>Open offering and freeze terms</button>{!fund.contract_address ? <p className="mt-2 text-sm text-slate-300">Deploy and verify the fund token in step 3 before opening the offering.</p> : null}</> : null}</div> : null}
      </Card>
      <Card number="02" title="Subscribe and record test funding">
        {fund ? <><p className="mb-4 text-sm text-slate-400">{fund.name} · {demoMoney(fund.unit_price_minor)} per unit · cap {fund.cap_units} units. Subscription uses the selected MetaMask address as the fictional investor wallet.</p><Field label="Whole fund units"><input className={inputClass} inputMode="numeric" value={units} onChange={event => setUnits(event.target.value)} /></Field><button className={`${buttonClass} mt-3`} disabled={busy || !wallet || fund.status !== 'OPEN'} onClick={() => command('subscribe', { fund_id: fund.id, units, investor_wallet: wallet })}>Accept frozen terms and subscribe</button><div className="mt-5 space-y-4">{fund.subscriptions.map(sub => <div key={sub.id} className="rounded-xl border border-slate-700 p-4"><p>{sub.units} units · {demoMoney(sub.amount_minor)}</p><p className="mt-1 text-xs text-slate-400">{sub.status}</p><div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || sub.status !== 'SUBSCRIBED'} onClick={() => command('record_test_funding', { fund_id: fund.id, subscription_id: sub.id })}>Record synthetic funding</button><button className={buttonClass} disabled={busy || sub.status !== 'FUNDED' || !fund.contract_address} onClick={() => command('prepare_mint', { fund_id: fund.id, subscription_id: sub.id })}>Approve demo issuance</button></div></div>)}</div></> : <p className="text-slate-400">Create and open a fund to start.</p>}
      </Card>
      <Card number="03" title="Deploy and issue on Amoy">
        {fund ? <><p className="text-sm text-slate-400">The presenter deploys and controls this demonstration token. Every mint or burn needs an explicit MetaMask transaction; gas is test POL.</p>{fund.contract_address ? <a className="mt-4 block break-all text-sm text-cyan-300 underline" href={`https://amoy.polygonscan.com/address/${fund.contract_address}`} target="_blank" rel="noreferrer">Verified token: {fund.contract_address}</a> : chainButtons(fund)}<div className="mt-5 space-y-4">{fund.operations.filter(op => op.kind === 'MINT').map(op => <div className="rounded-xl border border-slate-700 p-4" key={op.id}><p>Mint {op.units} units · {op.status}</p><p className="mt-2 break-all text-xs text-slate-400">Investor: {op.wallet}</p>{op.status === 'PREPARED' ? chainButtons(fund, op) : <a className="mt-3 block text-sm text-cyan-300 underline" href={`https://amoy.polygonscan.com/tx/${op.transaction_hash}`} target="_blank" rel="noreferrer">Confirmed receipt · block {op.block_number}</a>}</div>)}</div></> : <p className="text-slate-400">Create a fund first.</p>}
      </Card>
      <Card number="04" title="Holdings and servicing">
        {fund ? <><div className="grid grid-cols-2 gap-4"><div><p className="text-xs uppercase text-slate-400">Confirmed units</p><p className="mt-2 text-3xl text-white">{fund.issued_units}</p></div><div><p className="text-xs uppercase text-slate-400">Synthetic cash</p><p className="mt-2 text-xl text-white">{demoMoney(fund.synthetic_cash_minor)}</p></div></div><div className="my-5 space-y-3">{fund.holdings.map(holding => <div key={holding.investor_wallet} className="rounded-lg bg-slate-950 p-3"><p className="break-all text-xs text-slate-400">{holding.investor_wallet}</p><p className="mt-1">{holding.units} units · {holding.reserved_units} reserved for exit</p></div>)}</div><Field label="Synthetic income / distribution (cents)"><input className={inputClass} inputMode="numeric" value={distribution} onChange={event => setDistribution(event.target.value)} /></Field><p className="mt-3 text-xs text-slate-400">Record a fictional income event before distributing it. Entitlements are frozen from confirmed holdings; this sends no bank payment.</p><div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || fund.issued_units === '0'} onClick={() => command('record_test_income', { fund_id: fund.id, amount_minor: distribution })}>Record synthetic fund income</button><button className={buttonClass} disabled={busy || fund.issued_units === '0'} onClick={() => command('record_distribution', { fund_id: fund.id, amount_minor: distribution })}>Allocate and record synthetic distribution</button></div><div className="mt-5 space-y-2">{fund.distributions.map(item => <details key={item.id} className="rounded-lg border border-slate-700 p-3"><summary>{demoMoney(item.amount_minor)} · saved entitlement snapshot</summary>{item.entitlements.map(row => <p key={row.investor_wallet} className="mt-3 break-all text-xs">{row.investor_wallet}: {demoMoney(row.amount_minor)} on {row.units} units</p>)}</details>)}</div></> : <p className="text-slate-400">Confirmed issuance creates investor holdings here.</p>}
      </Card>
      <Card number="05" title="Redeem, burn and complete exit">
        {fund ? <><Field label="Units to redeem from the connected investor wallet"><input className={inputClass} inputMode="numeric" value={redemptionUnits} onChange={event => setRedemptionUnits(event.target.value)} /></Field><button className={`${buttonClass} mt-3`} disabled={busy || !wallet} onClick={() => command('request_redemption', { fund_id: fund.id, units: redemptionUnits, investor_wallet: wallet })}>Request redemption and reserve units</button><p className="mt-3 text-xs text-slate-400">Cash quote comes from the fund’s frozen unit price, not an amount supplied by the investor.</p><div className="mt-5 space-y-4">{fund.redemptions.map(item => { const operation = fund.operations.find(op => op.id === item.operation_id); return <div className="rounded-xl border border-slate-700 p-4" key={item.id}><p>{item.units} units · {demoMoney(item.amount_minor)}</p><p className="mt-1 text-xs text-slate-400">{item.status}</p>{!item.operation_id ? <button className={`${buttonClass} mt-3`} disabled={busy} onClick={() => command('prepare_burn', { fund_id: fund.id, redemption_id: item.id })}>Approve demo burn</button> : operation?.status === 'PREPARED' ? chainButtons(fund, operation) : null}<button className={`${buttonClass} mt-3`} disabled={busy || item.status !== 'BURNED'} onClick={() => command('complete_test_payout', { fund_id: fund.id, redemption_id: item.id })}>Record synthetic redemption payout</button></div> })}</div></> : <p className="text-slate-400">Create a fund first.</p>}
      </Card>
      <Card number="06" title="Evidence and reconciliation">
        {fund ? <><p className="text-sm text-slate-400">Compare live Amoy supply and wallet balances with the saved register. Every journal must balance independently. Synthetic cash remains separate from chain evidence.</p><button className={`${buttonClass} mt-4`} disabled={busy || !fund.contract_address} onClick={() => void run(async () => { const result = await execute('reconcile', { fund_id: fund.id }); setProof(result.reconciliation) })}>Reconcile chain, register and journals</button>{proof ? <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs text-cyan-200">{JSON.stringify(proof, null, 2)}</pre> : null}<p className="mt-5 text-sm">{fund.journal.length} saved journal entries</p><div className="mt-3 max-h-80 space-y-2 overflow-auto">{fund.journal.map(entry => <details key={entry.id} className="rounded-lg border border-slate-700 p-3 text-xs"><summary>{entry.event_kind} · {entry.unit}</summary>{entry.lines.map((line, index) => <p key={index} className="mt-2">{line.direction} {line.amount} · {line.account}</p>)}</details>)}</div></> : <p className="text-slate-400">The saved evidence appears as you progress.</p>}
      </Card>
    </div>
  </main>
}
