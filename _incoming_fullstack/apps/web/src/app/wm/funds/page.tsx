'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const DEFAULT_FUNDS = [
  {
    id: '1',
    name: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    aum: 'R125M',
    investors: 347,
    nav: 'R10.52',
    status: 'Published',
  },
  {
    id: '2',
    name: 'Sustainable Energy Fund',
    symbol: 'SENF',
    aum: 'R87M',
    investors: 256,
    nav: 'R8.94',
    status: 'Published',
  },
]

export default function WMFundsPage() {
  const [funds, setFunds] = useState(DEFAULT_FUNDS)

  useEffect(() => {
    const fundsData = localStorage.getItem('funds')
    if (fundsData) {
      const storedFunds = JSON.parse(fundsData)
      setFunds(storedFunds.length > 0 ? storedFunds : DEFAULT_FUNDS)
    } else {
      localStorage.setItem('funds', JSON.stringify(DEFAULT_FUNDS))
    }
  }, [])
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">My Funds</h1>
              <p className="text-muted-foreground">Manage your tokenized funds</p>
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
                          {fund.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{fund.symbol}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">AUM</div>
                        <div className="text-lg font-semibold">{fund.aum}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Investors</div>
                        <div className="text-lg font-semibold">{fund.investors}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">NAV</div>
                        <div className="text-lg font-semibold">{fund.nav}</div>
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
