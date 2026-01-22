'use client'

import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const HOLDINGS = [
  {
    fundId: '1',
    name: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    quantity: 150,
    avgPrice: 'R9.80',
    currentPrice: 'R10.52',
    value: 'R1,578',
    gain: '+R108',
    gainPercent: '+7.3%',
    allocation: '45%'
  },
  {
    fundId: '2',
    name: 'Sustainable Energy Fund',
    symbol: 'SENF',
    quantity: 200,
    avgPrice: 'R8.50',
    currentPrice: 'R8.94',
    value: 'R1,788',
    gain: '+R88',
    gainPercent: '+5.2%',
    allocation: '55%'
  }
]

export default function PortfolioPage() {
  const totalValue = 'R3,366'
  const totalGain = '+R196'
  const totalGainPercent = '+6.2%'

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Portfolio</h1>
          <p className="text-muted-foreground mb-8">Track your fund holdings and performance</p>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="glass-surface rounded-2xl p-6">
              <div className="text-sm text-muted-foreground mb-2">Total Value</div>
              <div className="text-3xl font-bold mb-1">{totalValue}</div>
              <div className="text-sm text-green-400">{totalGain} ({totalGainPercent})</div>
            </div>
            <div className="glass-surface rounded-2xl p-6">
              <div className="text-sm text-muted-foreground mb-2">Total Holdings</div>
              <div className="text-3xl font-bold mb-1">{HOLDINGS.length}</div>
              <div className="text-sm text-muted-foreground">Active Positions</div>
            </div>
            <div className="glass-surface rounded-2xl p-6">
              <div className="text-sm text-muted-foreground mb-2">Avg Return</div>
              <div className="text-3xl font-bold mb-1">{totalGainPercent}</div>
              <div className="text-sm text-muted-foreground">All Time</div>
            </div>
          </div>

          <div className="space-y-4">
            {HOLDINGS.map((holding, index) => (
              <motion.div
                key={holding.fundId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-1">{holding.name}</h3>
                      <p className="text-sm text-muted-foreground">{holding.symbol}</p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Quantity</div>
                        <div className="font-semibold">{holding.quantity}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Avg Price</div>
                        <div className="font-semibold">{holding.avgPrice}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                        <div className="font-semibold">{holding.currentPrice}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Value</div>
                        <div className="font-semibold">{holding.value}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Gain/Loss</div>
                        <div className="font-semibold text-green-400">{holding.gain} ({holding.gainPercent})</div>
                      </div>
                    </div>

                    <Link href={`/investor/funds/${holding.fundId}`}>
                      <Button size="sm" variant="outline" className="glass-surface hover-elevate press-compress">
                        View Details
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
