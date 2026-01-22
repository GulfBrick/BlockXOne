'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'

import { AnimatedCard } from '@/components/motion/animated-card'
import { Button } from '@/components/ui/button'
import { Fund, ensureFunds, saveFunds } from '@/lib/demo-funds'

export default function WMFundsPage() {
  const [funds, setFunds] = useState<Fund[]>([])

  const formatZAR = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)

  useEffect(() => {
    const seeded = ensureFunds()
    setFunds(seeded)
    saveFunds(seeded)
  }, [])
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">My Funds</h1>
              <p className="text-muted-foreground">Manage your tokenized funds (mint/burn fees + KYC gates)</p>
            </div>
            <Link href="/wm/funds/new">
              <Button className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create New Fund
              </Button>
            </Link>
          </div>

          <div className="space-y-4">
            {funds.map((fund, index) => (
              <motion.div
                key={fund.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-xl font-semibold">{fund.name}</h3>
                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                          {fund.status || 'Draft'}
                        </span>
                        <span className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 capitalize">
                          {fund.environment}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${fund.kycRequired ? 'bg-amber-400/15 text-amber-300' : 'bg-green-400/10 text-green-300'}`}>
                          {fund.kycRequired ? 'KYC required' : 'KYC optional'}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{fund.symbol} • {fund.chain}</p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">AUM</div>
                        <div className="text-lg font-semibold">{formatZAR(fund.aum)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Investors</div>
                        <div className="text-lg font-semibold">{fund.investors}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">NAV</div>
                        <div className="text-lg font-semibold">{formatZAR(fund.nav)}</div>
                      </div>
                      <div className="col-span-full text-xs text-muted-foreground flex gap-3">
                        <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Mint {fund.mintFeeBps / 100}%</span>
                        <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Burn {fund.burnFeeBps / 100}%</span>
                      </div>
                    </div>

                    <Link href={`/wm/funds/${fund.id}`}>
                      <Button variant="outline" className="glass-surface hover-elevate press-compress">
                        Manage
                      </Button>
                    </Link>
                  </div>
                </AnimatedCard>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
