'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'
import { FilterBar } from '@/components/motion/filter-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

const DEMO_FUNDS = [
  {
    id: '1',
    name: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    category: 'Technology',
    aum: 'R125M',
    nav: 'R10.52',
    performance: '+18.3%',
    minInvestment: 'R10,000',
    chain: 'Ethereum',
    manager: 'Apex Capital',
    risk: 'Medium-High'
  },
  {
    id: '2',
    name: 'Sustainable Energy Fund',
    symbol: 'SENF',
    category: 'ESG',
    aum: 'R87M',
    nav: 'R8.94',
    performance: '+12.7%',
    minInvestment: 'R5,000',
    chain: 'Polygon',
    manager: 'GreenVest Partners',
    risk: 'Medium'
  },
  {
    id: '3',
    name: 'DeFi Yield Optimizer',
    symbol: 'DFYO',
    category: 'DeFi',
    aum: 'R203M',
    nav: 'R15.67',
    performance: '+24.1%',
    minInvestment: 'R25,000',
    chain: 'Ethereum',
    manager: 'Quantum Asset Management',
    risk: 'High'
  },
  {
    id: '4',
    name: 'Emerging Markets Bond Fund',
    symbol: 'EMBF',
    category: 'Fixed Income',
    aum: 'R156M',
    nav: 'R12.08',
    performance: '+6.4%',
    minInvestment: 'R15,000',
    chain: 'Polygon',
    manager: 'Sterling Capital',
    risk: 'Low-Medium'
  }
]

const CATEGORIES = ['All', 'Technology', 'ESG', 'DeFi', 'Fixed Income', 'Real Estate']
const CHAINS = ['All Chains', 'Ethereum', 'Polygon', 'Arbitrum']

export default function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedChain, setSelectedChain] = useState('All Chains')

  const filteredFunds = DEMO_FUNDS.filter(fund => {
    const matchesSearch = fund.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         fund.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'All' || fund.category === selectedCategory
    const matchesChain = selectedChain === 'All Chains' || fund.chain === selectedChain
    return matchesSearch && matchesCategory && matchesChain
  })

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Fund Marketplace</h1>
          <p className="text-muted-foreground mb-8">
            Browse and invest in vetted tokenized funds with full compliance
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
                  filters={CATEGORIES} 
                  onFilterClick={setSelectedCategory}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Blockchain</label>
                <FilterBar 
                  filters={CHAINS}
                  onFilterClick={setSelectedChain}
                />
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
                      <div className={`text-lg font-bold ${fund.performance.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                        {fund.performance}
                      </div>
                      <div className="text-xs text-muted-foreground">1Y Return</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-white/10">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">NAV per Token</div>
                      <div className="text-lg font-semibold">{fund.nav}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Total AUM</div>
                      <div className="text-lg font-semibold">{fund.aum}</div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Manager</span>
                      <span>{fund.manager}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Min. Investment</span>
                      <span>{fund.minInvestment}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Blockchain</span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-primary"></span>
                        {fund.chain}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Risk Level</span>
                      <span className={`font-medium ${
                        fund.risk.includes('High') ? 'text-orange-400' :
                        fund.risk.includes('Medium') ? 'text-yellow-400' :
                        'text-green-400'
                      }`}>{fund.risk}</span>
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
