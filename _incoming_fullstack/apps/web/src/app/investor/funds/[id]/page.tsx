'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TabContent } from '@/components/motion/tab-content'
import { addTransaction } from '@/lib/transactions'

const FUND_DETAILS = {
  '1': {
    name: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    nav: 'R10.52',
    navValue: 10.52,
    aum: 'R125M',
    performance: '+18.3%',
    manager: 'Apex Capital',
    chain: 'Ethereum',
    tokenAddress: '0x1234...5678',
    description: 'A diversified portfolio of high-growth technology companies with strong fundamentals and innovative business models.',
    strategy: 'Long-term growth through strategic investments in emerging technology sectors including AI, cloud computing, and fintech.',
    fees: { management: '1.5%', performance: '20%', entry: '0%', exit: '0.5%' },
    terms: { minInvestment: 'R10,000', minInvestmentValue: 10000, lockup: '6 months', redemptionFreq: 'Quarterly' },
    documents: [
      { name: 'Prospectus', url: '#', size: '2.4 MB' },
      { name: 'Fund Terms', url: '#', size: '856 KB' },
      { name: 'Risk Disclosure', url: '#', size: '1.2 MB' }
    ],
    navHistory: [
      { date: '2025-10', value: 10.52 },
      { date: '2025-09', value: 10.28 },
      { date: '2025-08', value: 9.95 },
      { date: '2025-07', value: 9.73 },
      { date: '2025-06', value: 9.42 },
      { date: '2025-05', value: 9.18 },
    ]
  },
  '2': {
    name: 'Sustainable Energy Fund',
    symbol: 'SENF',
    nav: 'R8.94',
    navValue: 8.94,
    aum: 'R87M',
    performance: '+12.7%',
    manager: 'GreenVest Partners',
    chain: 'Polygon',
    tokenAddress: '0x9876...4321',
    description: 'Investing in renewable energy and sustainable infrastructure projects across emerging markets.',
    strategy: 'Focus on solar, wind, and clean energy technologies with proven track records and government support.',
    fees: { management: '1.2%', performance: '15%', entry: '0%', exit: '0.3%' },
    terms: { minInvestment: 'R5,000', minInvestmentValue: 5000, lockup: '3 months', redemptionFreq: 'Monthly' },
    documents: [
      { name: 'Prospectus', url: '#', size: '1.8 MB' },
      { name: 'ESG Report', url: '#', size: '3.2 MB' }
    ],
    navHistory: [
      { date: '2025-10', value: 8.94 },
      { date: '2025-09', value: 8.72 },
      { date: '2025-08', value: 8.45 },
    ]
  }
}

export default function FundDetailPage() {
  const params = useParams()
  const fundId = params.id as string
  const fund = FUND_DETAILS[fundId as keyof typeof FUND_DETAILS] || FUND_DETAILS['1']
  const [activeTab, setActiveTab] = useState('overview')
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [buyAmount, setBuyAmount] = useState('')
  const [buySuccess, setBuySuccess] = useState(false)

  const parsedAmount = parseFloat(buyAmount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0
  const normalizedAmount = isValidAmount ? Number(parsedAmount.toFixed(2)) : 0
  const tokensToBuy = normalizedAmount / fund.navValue
  const totalCost = normalizedAmount

  const handleBuy = () => {
    if (!isValidAmount || normalizedAmount < fund.terms.minInvestmentValue) return

    addTransaction({
      type: 'buy',
      fundId: fundId,
      fundName: fund.name,
      fundSymbol: fund.symbol,
      investorName: 'John Investor',
      investorEmail: 'investor@demo.com',
      quantity: Number(tokensToBuy.toFixed(4)),
      pricePerToken: fund.navValue,
      totalAmount: normalizedAmount,
      status: 'completed'
    })

    setBuySuccess(true)
    setTimeout(() => {
      setBuySuccess(false)
      setShowBuyModal(false)
      setBuyAmount('')
    }, 2500)
  }

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <Link href="/investor/market" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Marketplace
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass-surface rounded-2xl p-8 mb-6"
        >
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">{fund.name}</h1>
              <p className="text-muted-foreground">{fund.symbol} • Managed by {fund.manager}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary mb-1">{fund.nav}</div>
              <div className="text-sm text-muted-foreground">NAV per Token</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">1Y Performance</div>
              <div className="text-xl font-semibold text-green-400">{fund.performance}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Total AUM</div>
              <div className="text-xl font-semibold">{fund.aum}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Blockchain</div>
              <div className="text-xl font-semibold">{fund.chain}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Token Address</div>
              <div className="text-sm font-mono">{fund.tokenAddress}</div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button 
              onClick={() => setShowBuyModal(true)}
              className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
            >
              Subscribe Now
            </Button>
            <Button variant="outline" className="glass-surface hover-elevate press-compress focus-ring">
              Add to Watchlist
            </Button>
          </div>
        </motion.div>

        <div className="glass-surface rounded-2xl p-6">
          <div className="flex gap-4 border-b border-white/10 mb-6">
            {['overview', 'performance', 'documents', 'terms'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 px-2 text-sm font-medium transition-colors relative ${
                  activeTab === tab
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {activeTab === tab && (
                  <motion.div
                    layoutId="activeTab"
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
                  <h3 className="text-lg font-semibold mb-3">Description</h3>
                  <p className="text-muted-foreground leading-relaxed">{fund.description}</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Investment Strategy</h3>
                  <p className="text-muted-foreground leading-relaxed">{fund.strategy}</p>
                </div>
              </div>
            )}

            {activeTab === 'performance' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">NAV History</h3>
                <div className="space-y-2">
                  {fund.navHistory.map((entry) => (
                    <div key={entry.date} className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                      <span className="text-sm text-muted-foreground">{entry.date}</span>
                      <span className="font-semibold">R{entry.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold mb-4">Fund Documents</h3>
                {fund.documents.map((doc) => (
                  <div key={doc.name} className="flex justify-between items-center p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{doc.name}</div>
                        <div className="text-sm text-muted-foreground">{doc.size}</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="hover-elevate press-compress">
                      Download
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'terms' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Fund Terms</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Minimum Investment</div>
                      <div className="font-semibold">{fund.terms.minInvestment}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Lock-up Period</div>
                      <div className="font-semibold">{fund.terms.lockup}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Redemption Frequency</div>
                      <div className="font-semibold">{fund.terms.redemptionFreq}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-4">Fee Structure</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {Object.entries(fund.fees).map(([key, value]) => (
                      <div key={key} className="p-4 rounded-lg bg-white/5">
                        <div className="text-sm text-muted-foreground mb-1">
                          {key.charAt(0).toUpperCase() + key.slice(1)} Fee
                        </div>
                        <div className="font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabContent>
        </div>
      </div>

      <AnimatePresence>
        {showBuyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowBuyModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-surface rounded-2xl p-6 max-w-md w-full"
            >
              {!buySuccess ? (
                <>
                  <h2 className="text-2xl font-bold mb-4">Subscribe to {fund.symbol}</h2>
                  <p className="text-muted-foreground mb-6">
                    Enter the amount you want to invest in {fund.name}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <Label>Investment Amount (ZAR)</Label>
                      <Input
                        type="number"
                        placeholder="10000"
                        value={buyAmount}
                        onChange={(e) => setBuyAmount(e.target.value)}
                        className="mt-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Minimum: {fund.terms.minInvestment}
                      </p>
                    </div>

                    {isValidAmount && normalizedAmount >= fund.terms.minInvestmentValue && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-lg bg-primary/10 border border-primary/20"
                      >
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Tokens to receive</span>
                          <span className="font-semibold">{tokensToBuy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        </div>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Price per token</span>
                          <span className="font-semibold">{fund.nav}</span>
                        </div>
                        <div className="border-t border-white/10 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="font-semibold">Total Cost</span>
                            <span className="font-bold text-primary">R{totalCost.toFixed(2)}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div className="flex gap-3 pt-4">
                      <Button
                        onClick={handleBuy}
                        disabled={!isValidAmount || normalizedAmount < fund.terms.minInvestmentValue}
                        className="flex-1 bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
                      >
                        Confirm Purchase
                      </Button>
                      <Button
                        onClick={() => setShowBuyModal(false)}
                        variant="outline"
                        className="flex-1 glass-surface hover-elevate press-compress"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Purchase Successful!</h3>
                  <p className="text-muted-foreground mb-2">
                    You've successfully purchased {tokensToBuy.toLocaleString(undefined, { maximumFractionDigits: 4 })} {fund.symbol} tokens
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total: R{totalCost.toFixed(2)}
                  </p>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
