'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'

import { AnimatedCard } from '@/components/motion/animated-card'
import { FilterBar } from '@/components/motion/filter-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { demoFunds } from '@/lib/demo-funds'

const ENVIRONMENTS = ['All', 'mainnet', 'testnet']

export default function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedChain, setSelectedChain] = useState('All Chains')
  const [selectedEnv, setSelectedEnv] = useState('All')

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(demoFunds.map((fund) => fund.category)))],
    []
  )

  const chains = useMemo(
    () => ['All Chains', ...Array.from(new Set(demoFunds.map((fund) => fund.chain)))],
    []
  )

  const formatZAR = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)

  const filteredFunds = demoFunds.filter((fund) => {
    const matchesSearch =
      fund.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      fund.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'All' || fund.category === selectedCategory
    const matchesChain = selectedChain === 'All Chains' || fund.chain === selectedChain
    const matchesEnv = selectedEnv === 'All' || fund.environment === selectedEnv
    return matchesSearch && matchesCategory && matchesChain && matchesEnv
  })

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Fund Marketplace</h1>
          <p className="text-muted-foreground mb-8">
            Demo-ready funds with KYC gates, mint/burn fees, and testnet (Tokeny-style) flows.
          </p>

          <div className="glass-surface rounded-2xl p-6 mb-8">
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1">
                <Input
                  placeholder="Search funds by name or symbol..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full focus-ring"
                />
              </div>
              <Button className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Advanced Filters
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Category</label>
                <FilterBar 
                  filters={categories} 
                  onFilterClick={setSelectedCategory}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Blockchain</label>
                <FilterBar 
                  filters={chains}
                  onFilterClick={setSelectedChain}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Environment</label>
                <FilterBar filters={ENVIRONMENTS} onFilterClick={setSelectedEnv} />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-2 gap-6">
            {filteredFunds.map((fund, index) => (
              <motion.div
                key={fund.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-semibold mb-1">{fund.name}</h3>
                      <p className="text-sm text-muted-foreground">{fund.symbol} • {fund.category}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${fund.performance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fund.performance >= 0 ? `+${fund.performance.toFixed(1)}%` : `${fund.performance.toFixed(1)}%`}
                      </div>
                      <div className="text-xs text-muted-foreground">1Y Return</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-white/10">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">NAV per Token</div>
                      <div className="text-lg font-semibold">{formatZAR(fund.nav)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Total AUM</div>
                      <div className="text-lg font-semibold">{formatZAR(fund.aum)}</div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Manager</span>
                      <span>{fund.manager}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Min. Investment</span>
                      <span>{formatZAR(fund.minInvestment)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Blockchain</span>
                      <span className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${fund.environment === 'testnet' ? 'bg-yellow-400' : 'bg-primary'}`}></span>
                        {fund.chain}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/10 capitalize">
                          {fund.environment}
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Risk Level</span>
                      <span
                        className={`font-medium ${
                          fund.risk.includes('High')
                            ? 'text-orange-400'
                            : fund.risk.includes('Medium')
                              ? 'text-yellow-400'
                              : 'text-green-400'
                        }`}
                      >
                        {fund.risk}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Fees</span>
                      <span className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10">
                        Mint {fund.mintFeeBps / 100}% • Burn {fund.burnFeeBps / 100}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">KYC</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${fund.kycRequired ? 'bg-amber-400/15 text-amber-300' : 'bg-green-400/10 text-green-300'}`}>
                        {fund.kycRequired ? 'Required' : 'Optional'}
                      </span>
                    </div>
                  </div>

                  <Link href={`/investor/funds/${fund.id}`}>
                    <Button className="w-full bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
                      View Details
                    </Button>
                  </Link>
                </AnimatedCard>
              </motion.div>
            ))}
          </div>

          {filteredFunds.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-surface rounded-2xl p-12 text-center"
            >
              <svg className="w-16 h-16 mx-auto mb-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="text-xl font-semibold mb-2">No funds found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search query</p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
