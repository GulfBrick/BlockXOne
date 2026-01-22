'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { WalletWidget } from '@/components/wallet/WalletWidget'
import { EmailLoginForm } from '@/components/auth/EmailLoginForm'

export default function LoginPage() {
  const router = useRouter()
  const { user, logout } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [status] = useState<string>('')
  const [loginMode, setLoginMode] = useState<'wallet' | 'email'>('email')

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-10">
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          <Card className="p-4 bg-gradient-to-br from-cyan-900/10 via-primary/5 to-blue-900/10 border-primary/20">
            <div className="aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              >
                <source src="/bxo_drop.mp4" type="video/mp4" />
              </video>
            </div>
          </Card>

          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-primary" />
              BlockXOne explainer
            </div>
            <h1 className="text-4xl font-bold leading-tight">A single bridge to tokenized funds</h1>
            <p className="text-muted-foreground text-lg">
              Watch the short walkthrough, then jump into the dev login. Wallet guardrails, mint/burn fees, KYC-ready flows,
              and Tokeny-style testnet environments are all wired for demo.
            </p>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">MetaMask + wagmi</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Testnets: Base Sepolia, Polygon Amoy</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Mint/Burn fees captured</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">KYC gate optional</span>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button size="lg" variant="outline" className="glass-surface" onClick={() => setShowLogin(true)}>
                Connect wallet to continue
              </Button>
              <Button
                size="lg"
                className="bg-gradient-to-r from-[#00B6FF] to-[#0894E6] hover:from-[#0894E6] hover:to-[#0A6FB6] text-white"
                onClick={() => setShowLogin(true)}
              >
                Start with MetaMask
              </Button>
            </div>
            {user ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="text-primary font-semibold">Signed in:</span>
                <span className="font-mono">{user.email}</span>
                <span className="text-xs">({user.roles.join(', ') || 'no roles'})</span>
              </div>
            ) : null}
          </div>
        </div>

        {showLogin && (
          <div className="space-y-6">
            {user ? (
              <Card className="p-4 flex items-center justify-between bg-white/5 border-white/10">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Signed in as</div>
                  <div className="font-mono text-sm">{user.email}</div>
                  <div className="text-xs text-muted-foreground">Roles: {user.roles.join(', ') || 'none'}</div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    logout()
                    setStatus('Logged out')
                  }}
                >
                  Logout
                </Button>
              </Card>
            ) : null}

            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Login Options</h2>
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">JWT auth</span>
              </div>

              {/* Tab switcher */}
              <div className="flex gap-2 justify-center">
                <Button
                  variant={loginMode === 'email' ? 'default' : 'outline'}
                  onClick={() => setLoginMode('email')}
                >
                  Email Login
                </Button>
                <Button
                  variant={loginMode === 'wallet' ? 'default' : 'outline'}
                  onClick={() => setLoginMode('wallet')}
                >
                  Wallet Login
                </Button>
              </div>

              {loginMode === 'email' ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Sign up as an investor or log in with your existing credentials. Super admin uses this method too.
                  </p>
                  <EmailLoginForm />
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Connect MetaMask, sign the login message, and we'll issue a short-lived JWT. Subsequent API calls use the Bearer
                    token automatically.
                  </p>
                  <WalletWidget />
                </div>
              )}
            </Card>

            {status ? <div className="text-center text-sm text-muted-foreground">{status}</div> : null}
          </div>
        )}
      </div>
    </div>
  )
}
