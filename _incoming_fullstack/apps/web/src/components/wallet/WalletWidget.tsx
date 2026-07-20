'use client'

import { useMemo, useState } from 'react'
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useSignMessage,
  useSwitchChain,
} from 'wagmi'

import { supportedChains } from '@/lib/wagmi'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/**
 * WalletWidget
 * - Connect MetaMask (Injected connector)
 * - Switch chain (testnets + mainnets)
 * - Sign a message and link wallet to BlockXOne backend
 */
export function WalletWidget() {
  const { user } = useAuth()
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()

  const [status, setStatus] = useState<string>('')

  const injectedConnector = useMemo(() => connectors[0], [connectors])
  const chains = useMemo(() => supportedChains, [])

  async function linkWallet() {
    if (!user || !address) {
      setStatus('Login first, then connect wallet.')
      return
    }

    try {
      setStatus('Signing…')

      const nonce = crypto.randomUUID()
      const message = `BlockXOne wallet connect\n\nDomain: ${window.location.host}\nAddress: ${address}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`

      const signature = await signMessageAsync({ message })

      setStatus('Linking…')
      await blockXOneApi.wallet.connect(user.id, user.email, {
        address,
        chainId,
        message,
        signature,
      })

      setStatus('Linked (pending Compliance approval).')
    } catch (e: any) {
      setStatus(e?.message || 'Link failed')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md bg-black/30 border border-white/10 px-2 text-sm"
        value={chainId}
        onChange={(e) => switchChain?.({ chainId: Number(e.target.value) })}
      >
        {chains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {!isConnected ? (
        <Button size="sm" disabled={isPending} onClick={() => connect({ connector: injectedConnector })}>
          Connect MetaMask
        </Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" onClick={linkWallet}>
            Link {shortAddr(address)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => disconnect()}>
            Disconnect
          </Button>
        </>
      )}

      {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
    </div>
  )
}
