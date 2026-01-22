'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

type ChainInfo = {
  chain_id: number
  name: string
  is_testnet: boolean
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
  request: (args: { method: string; params?: any[] | object }) => Promise<any>
  on?: (event: string, handler: (...args: any[]) => void) => void
  removeListener?: (event: string, handler: (...args: any[]) => void) => void
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
  const eth = (window as any).ethereum as EthereumProvider | undefined
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
  let hex = '0x'
  for (const b of enc) hex += b.toString(16).padStart(2, '0')
  return hex
}

export function WalletWidget() {
  const router = useRouter()
  const { user, loginWithToken } = useAuth()

  const [eth, setEth] = useState<EthereumProvider | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number>(0)
  const [chains, setChains] = useState<ChainInfo[]>([])
  const [status, setStatus] = useState<string>('')
  const [creatingKyc, setCreatingKyc] = useState(false)

  const apiBase = useMemo(() => getApiBase(), [])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      const provider = await getEthereum()
      if (!mounted) return
      setEth(provider)

      // Load chain list from backend (works without auth in dev)
      try {
        const res = await fetch(`${apiBase}/v1/chains`)
        if (res.ok) {
          const data = (await res.json()) as ChainInfo[]
          setChains(Array.isArray(data) ? data : [])
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

      const onAccountsChanged = (accounts: string[]) => {
        setAddress(accounts?.[0] || null)
      }
      const onChainChanged = (cid: string) => {
        setChainId(parseChainIdHex(cid))
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
    if (!eth) {
      setStatus('MetaMask not detected. Install MetaMask and refresh.')
      return
    }
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      setAddress(accounts?.[0] || null)
      const cid = (await eth.request({ method: 'eth_chainId' })) as string
      setChainId(parseChainIdHex(cid))
    } catch (e: any) {
      setStatus(e?.message || 'Wallet connection failed')
    }
  }

  async function switchTo(targetChainId: number) {
    setStatus('')
    if (!eth) return

    const info = chains.find((c) => c.chain_id === targetChainId)
    const hex = info?.metamask_chain_id || `0x${targetChainId.toString(16)}`

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      })
      setChainId(targetChainId)
    } catch (e: any) {
      // Unrecognized chain => attempt add
      if (e?.code === 4902 && info?.rpc_urls?.length) {
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
        } catch (e2: any) {
          setStatus(e2?.message || 'Failed to add/switch chain')
        }
        return
      }
      setStatus(e?.message || 'Failed to switch chain')
    }
  }

  async function linkWallet() {
    setStatus('')
    if (!eth || !address) {
      setStatus('Connect MetaMask first.')
      return
    }
    if (!chainId) {
      setStatus('Switch to a supported chain, then try again.')
      return
    }

    try {
      setStatus('Signing…')
      const nonce = crypto.randomUUID()
      const message = `BlockXOne wallet connect\n\nDomain: ${window.location.host}\nAddress: ${address}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`

      const signature = (await eth.request({
        method: 'personal_sign',
        params: [utf8ToHex(message), address],
      })) as string

      setStatus('Submitting…')
      const resp = await blockXOneApi.wallet.connect({
        address,
        chainId,
        message,
        signature,
        email: user?.email,
      }) as any

      if (resp?.token) {
        await loginWithToken(resp.token)
        const roleName = resp?.role || 'User'
        setStatus(`✅ Signed in as ${roleName} (wallet pending compliance approval)`)

        // Auto-start KYC after signup/login (only for Investor role)
        if (roleName === 'Investor') {
          const kycEmail = resp?.email || user?.email || `${address}@blockxone.dev`
          const kycUserId = resp?.user_id || user?.id
          if (kycUserId && kycEmail) {
            try {
              setCreatingKyc(true)
              const created = await blockXOneApi.kyc.createCase(kycUserId, kycEmail, 'KYC') as any
              const kycId = created?.id || created?.case_id
              if (kycId && typeof window !== 'undefined') {
                window.localStorage.setItem('bx_kyc_case_id', kycId)
              }
              setStatus(`✅ Signed in as ${roleName}. KYC case created — redirecting…`)
              setTimeout(() => router.push('/investor/kyc'), 1500)
            } catch (err: any) {
              setStatus(`⚠️ Signed in, but KYC case creation failed: ${err?.message || 'unknown error'}`)
            } finally {
              setCreatingKyc(false)
            }
          }
        }
      } else {
        setStatus('⚠️ Wallet linked, but no token returned.')
      }
    } catch (e: any) {
      setStatus(`❌ Wallet link failed: ${e?.message || 'unknown error'}`)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md bg-black/30 border border-white/10 px-2 text-sm"
        value={chainId || ''}
        onChange={(e) => switchTo(Number(e.target.value))}
        disabled={!eth}
      >
        <option value="" disabled>
          {chains.length ? 'Select chain' : 'Chains'}
        </option>
        {chains.map((c) => (
          <option key={c.chain_id} value={c.chain_id}>
            {c.name}{c.is_testnet ? ' (testnet)' : ''}
          </option>
        ))}
      </select>

      {!isConnected ? (
        <Button size="sm" onClick={connect}>
          Connect MetaMask
        </Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" onClick={linkWallet}>
            Link {shortAddr(address)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddress(null)
              setStatus('Disconnected (local)')
            }}
          >
            Disconnect
          </Button>
        </>
      )}

      {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
    </div>
  )
}
