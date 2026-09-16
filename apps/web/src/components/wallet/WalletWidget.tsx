'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context-v2'
import { useWallet } from '@/hooks/useBlockXOne'
import {
  requireUsableWalletChallenge,
  walletLinkFailureMessage,
} from '@/lib/wallet-linking'
import { Button } from '@/components/ui/button'

type ChainInfo = {
  chain_id: number
  name: string
  is_testnet: boolean
  is_pilot?: boolean
  execution_ready?: boolean
  availability?: string
  network_tier?: 'local' | 'testnet' | string
  metamask_chain_id: string
  rpc_urls?: string[]
  block_explorer_url?: string
  native_currency?: {
    name: string
    symbol: string
    decimals: number
  }
}

type EthereumProvider = {
  isMetaMask?: boolean
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

type WalletRpcError = {
  code?: number
  message?: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function getApiBase() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
}

async function getEthereum(): Promise<EthereumProvider | null> {
  if (typeof window === 'undefined') return null
  const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum
  return eth || null
}

function parseChainIdHex(hex?: string): number {
  if (!hex) return 0
  try {
    return parseInt(hex, 16)
  } catch {
    return 0
  }
}

function utf8ToHex(str: string) {
  const enc = new TextEncoder().encode(str)
  return `0x${Array.from(enc, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function WalletWidget() {
  const { user } = useAuth()
  const {
    challenge: requestWalletChallenge,
    connect: submitWalletLink,
  } = useWallet()

  const [eth, setEth] = useState<EthereumProvider | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number>(0)
  const [chains, setChains] = useState<ChainInfo[]>([])
  const [status, setStatus] = useState<string>('')
  const [statusIsError, setStatusIsError] = useState(false)
  const [linking, setLinking] = useState(false)

  const apiBase = useMemo(() => getApiBase(), [])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      const provider = await getEthereum()
      if (!mounted) return
      setEth(provider)

      // The controlled UI never offers mainnet wallet linking.
      try {
        const res = await fetch(`${apiBase}/v1/chains`)
        if (res.ok) {
          const data = (await res.json()) as ChainInfo[]
          setChains(
            Array.isArray(data)
              ? data.filter((chain) => chain.is_pilot === true && chain.execution_ready === true)
              : []
          )
        }
      } catch {
        // ignore
      }

      if (!provider) return

      try {
        const [acct] = (await provider.request({ method: 'eth_accounts' })) as string[]
        if (acct) setAddress(acct)
      } catch {
        // ignore
      }

      try {
        const cid = (await provider.request({ method: 'eth_chainId' })) as string
        setChainId(parseChainIdHex(cid))
      } catch {
        // ignore
      }

      const onAccountsChanged = (...args: unknown[]) => {
        const [accounts] = args
        if (!Array.isArray(accounts)) {
          setAddress(null)
          return
        }
        const nextAddress = typeof accounts[0] === 'string' ? accounts[0] : null
        setAddress(nextAddress)
      }
      const onChainChanged = (...args: unknown[]) => {
        const [cid] = args
        setChainId(typeof cid === 'string' ? parseChainIdHex(cid) : 0)
      }

      provider.on?.('accountsChanged', onAccountsChanged)
      provider.on?.('chainChanged', onChainChanged)

      return () => {
        provider.removeListener?.('accountsChanged', onAccountsChanged)
        provider.removeListener?.('chainChanged', onChainChanged)
      }
    })()

    return () => {
      mounted = false
    }
  }, [apiBase])

  const isConnected = !!address

  async function connect() {
    setStatus('')
    setStatusIsError(false)
    if (!eth) {
      setStatus('MetaMask not detected. Install MetaMask and refresh.')
      setStatusIsError(true)
      return
    }
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      setAddress(accounts?.[0] || null)
      const cid = (await eth.request({ method: 'eth_chainId' })) as string
      setChainId(parseChainIdHex(cid))
    } catch (error) {
      setStatus(getErrorMessage(error, 'Wallet connection failed'))
      setStatusIsError(true)
    }
  }

  async function switchTo(targetChainId: number) {
    setStatus('')
    setStatusIsError(false)
    if (!eth) return

    const info = chains.find((c) => c.chain_id === targetChainId)
    const hex = info?.metamask_chain_id || `0x${targetChainId.toString(16)}`

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      })
      setChainId(targetChainId)
    } catch (error) {
      const walletError = error as WalletRpcError
      // Unrecognized chain => attempt add
      if (walletError.code === 4902 && info?.rpc_urls?.length) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: hex,
                chainName: info.name,
                rpcUrls: info.rpc_urls,
                nativeCurrency: info.native_currency || {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                blockExplorerUrls: info.block_explorer_url ? [info.block_explorer_url] : [],
              },
            ],
          })
          // After adding, switch again
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: hex }],
          })
          setChainId(targetChainId)
        } catch (nestedError) {
          setStatus(getErrorMessage(nestedError, 'Failed to add/switch chain'))
          setStatusIsError(true)
        }
        return
      }
      setStatus(getErrorMessage(error, 'Failed to switch chain'))
      setStatusIsError(true)
    }
  }

  async function linkWallet() {
    setStatus('')
    setStatusIsError(false)
    if (!user) {
      setStatus('Sign in before linking a wallet.')
      setStatusIsError(true)
      return
    }
    if (!eth || !address) {
      setStatus('Connect MetaMask first.')
      setStatusIsError(true)
      return
    }
    if (!chainId) {
      setStatus('Switch to a supported chain, then try again.')
      setStatusIsError(true)
      return
    }
    if (!chains.some((chain) =>
      chain.chain_id === chainId && chain.is_pilot === true && chain.execution_ready === true
    )) {
      setStatus('Switch to an execution-ready BlockXOne chain before linking this wallet.')
      setStatusIsError(true)
      return
    }

    setLinking(true)
    try {
      const requestedAddress = address
      const requestedChainId = chainId
      const domain = window.location.host

      setStatus('Requesting a one-time wallet challenge…')
      const challenge = requireUsableWalletChallenge(
        await requestWalletChallenge({
          address: requestedAddress,
          chainId: requestedChainId,
          domain,
        })
      )

      setStatus('Review and sign the one-time challenge in MetaMask…')
      const signature = (await eth.request({
        method: 'personal_sign',
        params: [utf8ToHex(challenge.message), requestedAddress],
      })) as string

      requireUsableWalletChallenge(challenge)
      setStatus('Verifying the signed challenge…')
      const resp = await submitWalletLink({
        challengeId: challenge.challenge_id,
        address: requestedAddress,
        chainId: requestedChainId,
        message: challenge.message,
        signature,
      })

      if (resp.id) {
        const walletState = resp.status ? ` (${resp.status.toLowerCase()})` : ''
        setStatus(`Wallet linked to ${user.email}${walletState}.`)
      } else {
        setStatus('Wallet link completed.')
      }
    } catch (error) {
      setStatus(walletLinkFailureMessage(error))
      setStatusIsError(true)
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <select
        className="h-11 min-w-0 max-w-full flex-1 rounded-md border border-white/10 bg-black/30 px-2 text-sm sm:w-auto sm:flex-none"
        value={chainId || ''}
        onChange={(e) => switchTo(Number(e.target.value))}
        disabled={!eth || linking}
        aria-label="Wallet network"
      >
        <option value="" disabled>
          {chains.length ? 'Select chain' : 'Chains'}
        </option>
        {chains.map((c) => (
          <option key={c.chain_id} value={c.chain_id}>
            {c.name}{c.network_tier === 'local' ? ' (local development, no real value)' : c.is_testnet ? ' (public testnet)' : ''}
          </option>
        ))}
      </select>

      {!isConnected ? (
        <Button className="min-h-11 max-w-full shrink-0" size="sm" onClick={connect} disabled={linking}>
          Connect MetaMask
        </Button>
      ) : (
        <>
          <Button className="min-h-11 max-w-full shrink-0" size="sm" variant="secondary" onClick={linkWallet} disabled={linking}>
            {linking ? 'Linking…' : `Link ${shortAddr(address)}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 max-w-full shrink-0"
            disabled={linking}
            onClick={() => {
              setAddress(null)
              setStatus('Disconnected (local)')
              setStatusIsError(false)
            }}
          >
            Disconnect
          </Button>
        </>
      )}

      {status ? (
        <span
          className={`w-full min-w-0 break-words text-xs sm:w-auto sm:max-w-xs ${
            statusIsError ? 'text-destructive' : 'text-muted-foreground'
          }`}
          role={statusIsError ? 'alert' : 'status'}
          aria-live={statusIsError ? 'assertive' : 'polite'}
        >
          {status}
        </span>
      ) : null}
    </div>
  )
}
