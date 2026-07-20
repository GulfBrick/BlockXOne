'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { AnimatedCard } from '@/components/motion/animated-card'
import { TabContent } from '@/components/motion/tab-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FUND_DATA = {
  '1': {
    name: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    aum: 'R125M',
    investors: 347,
    nav: 'R105.20',
    tokenAddress: '0x1234...5678',
    totalSupply: 1187925,
    chain: 'Polygon',
    status: 'Published'
  }
}

export default function FundManagementPage() {
  const params = useParams()
  const fundId = params.id as string
  const fund = FUND_DATA[fundId as keyof typeof FUND_DATA] || FUND_DATA['1']
  
  const [activeTab, setActiveTab] = useState('overview')
  const [mintAmount, setMintAmount] = useState('')
  const [burnAmount, setBurnAmount] = useState('')
  const [navValue, setNavValue] = useState(fund.nav.replace('R', ''))
  const [showSuccess, setShowSuccess] = useState(false)

  const handleMint = () => {
    if (!mintAmount || parseFloat(mintAmount) <= 0) return
    setShowSuccess(true)
    setTimeout(() => {
      setShowSuccess(false)
      setMintAmount('')
    }, 3000)
  }

  const handleBurn = () => {
    if (!burnAmount || parseFloat(burnAmount) <= 0) return
    setShowSuccess(true)
    setTimeout(() => {
      setShowSuccess(false)
      setBurnAmount('')
    }, 3000)
  }

  const handleNavUpdate = () => {
    if (!navValue || parseFloat(navValue) <= 0) return
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), 3000)
  }

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <Link href="/wm/funds" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Funds
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="glass-surface rounded-2xl p-8 mb-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h1 className="text-3xl font-bold mb-2">{fund.name}</h1>
                <p className="text-muted-foreground">{fund.symbol}</p>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary">
                {fund.status}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Total AUM</div>
                <div className="text-2xl font-bold">{fund.aum}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">NAV per Token</div>
                <div className="text-2xl font-bold">{fund.nav}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Total Supply</div>
                <div className="text-2xl font-bold">{fund.totalSupply.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Investors</div>
                <div className="text-2xl font-bold">{fund.investors}</div>
              </div>
            </div>
          </div>

          {showSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-surface border border-primary/20 rounded-xl p-4 mb-6 flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold">Transaction Submitted</div>
                <div className="text-sm text-muted-foreground">Your transaction has been processed successfully</div>
              </div>
            </motion.div>
          )}

          <div className="glass-surface rounded-2xl p-6">
            <div className="flex gap-4 border-b border-white/10 mb-6">
              {['overview', 'tokens', 'nav', 'investors'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`pb-3 px-2 text-sm font-medium transition-colors relative ${
                    activeTab === tab ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {activeTab === tab && (
                    <motion.div
                      layoutId="fundTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                      transition={{ duration: 0.2 }}
                    />
                  )}
                </button>
              ))}
            </div>

            <TabContent activeKey={activeTab}>
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Fund Details</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg bg-white/5">
                        <div className="text-sm text-muted-foreground mb-1">Token Address</div>
                        <div className="font-mono text-sm">{fund.tokenAddress}</div>
                      </div>
                      <div className="p-4 rounded-lg bg-white/5">
                        <div className="text-sm text-muted-foreground mb-1">Blockchain</div>
                        <div className="font-semibold">{fund.chain}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'tokens' && (
                <div className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <AnimatedCard>
                      <h3 className="text-lg font-semibold mb-4">Mint Tokens</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Issue new fund tokens for capital raises or subscriptions
                      </p>
                      <div className="space-y-4">
                        <div>
                          <Label>Number of Tokens</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={mintAmount}
                            onChange={(e) => setMintAmount(e.target.value)}
                            className="mt-2"
                          />
                        </div>
                        <div className="p-3 rounded-lg bg-white/5">
                          <div className="text-xs text-muted-foreground mb-1">Value at Current NAV</div>
                          <div className="text-lg font-semibold">
                            R{mintAmount ? (parseFloat(mintAmount) * parseFloat(fund.nav.replace('R', ''))).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <Button
                          onClick={handleMint}
                          disabled={!mintAmount || parseFloat(mintAmount) <= 0}
                          className="w-full bg-green-600 hover:bg-green-700 hover-elevate press-compress focus-ring"
                        >
                          Mint Tokens
                        </Button>
                      </div>
                    </AnimatedCard>

                    <AnimatedCard>
                      <h3 className="text-lg font-semibold mb-4">Burn Tokens</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Remove tokens from circulation for redemptions or adjustments
                      </p>
                      <div className="space-y-4">
                        <div>
                          <Label>Number of Tokens</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={burnAmount}
                            onChange={(e) => setBurnAmount(e.target.value)}
                            className="mt-2"
                          />
                        </div>
                        <div className="p-3 rounded-lg bg-white/5">
                          <div className="text-xs text-muted-foreground mb-1">Value at Current NAV</div>
                          <div className="text-lg font-semibold">
                            R{burnAmount ? (parseFloat(burnAmount) * parseFloat(fund.nav.replace('R', ''))).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <Button
                          onClick={handleBurn}
                          disabled={!burnAmount || parseFloat(burnAmount) <= 0}
                          className="w-full bg-red-600 hover:bg-red-700 hover-elevate press-compress focus-ring"
                        >
                          Burn Tokens
                        </Button>
                      </div>
                    </AnimatedCard>
                  </div>

                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-primary mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-sm">
                        <div className="font-semibold mb-1">Token Management Notice</div>
                        <div className="text-muted-foreground">
                          All token operations are recorded on the blockchain and require gas fees. 
                          Ensure you have sufficient funds in your wallet before proceeding.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'nav' && (
                <div className="space-y-6">
                  <AnimatedCard>
                    <h3 className="text-lg font-semibold mb-4">Update NAV</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Set the Net Asset Value per token based on fund performance
                    </p>
                    <div className="space-y-4">
                      <div>
                        <Label>NAV per Token (ZAR)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={navValue}
                          onChange={(e) => setNavValue(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <div className="text-xs text-muted-foreground mb-1">Total Fund Value</div>
                        <div className="text-lg font-semibold">
                          R{navValue ? (parseFloat(navValue) * fund.totalSupply).toLocaleString(undefined, {maximumFractionDigits: 2}) : '0.00'}
                        </div>
                      </div>
                      <Button
                        onClick={handleNavUpdate}
                        disabled={!navValue || parseFloat(navValue) <= 0}
                        className="w-full bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
                      >
                        Update NAV
                      </Button>
                    </div>
                  </AnimatedCard>

                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">NAV History</h3>
                    <div className="space-y-2">
                      {[
                        { date: '2025-10-15', value: 105.20, change: '+2.3%' },
                        { date: '2025-10-01', value: 102.85, change: '+1.8%' },
                        { date: '2025-09-15', value: 101.04, change: '-0.5%' },
                      ].map((entry) => (
                        <div key={entry.date} className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                          <span className="text-sm text-muted-foreground">{entry.date}</span>
                          <div className="flex items-center gap-4">
                            <span className="font-semibold">R{entry.value.toFixed(2)}</span>
                            <span className={`text-sm ${entry.change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                              {entry.change}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'investors' && (
                <div>
                  <h3 className="text-lg font-semibold mb-4">Investor Distribution</h3>
                  <div className="space-y-3">
                    {[
                      { name: 'John Smith', holdings: 12500, value: 'R1,315,000' },
                      { name: 'Sarah Johnson', holdings: 8200, value: 'R862,640' },
                      { name: 'Michael Chen', holdings: 15600, value: 'R1,641,120' },
                    ].map((investor) => (
                      <div key={investor.name} className="flex justify-between items-center p-4 rounded-lg bg-white/5">
                        <div>
                          <div className="font-semibold">{investor.name}</div>
                          <div className="text-sm text-muted-foreground">{investor.holdings.toLocaleString()} tokens</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{investor.value}</div>
                          <div className="text-xs text-muted-foreground">
                            {((investor.holdings / fund.totalSupply) * 100).toFixed(2)}% of total
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabContent>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
