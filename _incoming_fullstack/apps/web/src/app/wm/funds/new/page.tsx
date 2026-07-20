'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { AnimatedCard } from '@/components/motion/animated-card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function NewFundPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    category: 'Equity',
    strategy: '',
    minInvestment: '1000',
    managementFee: '2.0',
    performanceFee: '20.0',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Get existing funds
    const fundsData = localStorage.getItem('funds')
    const existingFunds = fundsData ? JSON.parse(fundsData) : []

    // Create new fund
    const newFund = {
      id: String(existingFunds.length + 1),
      name: formData.name,
      symbol: formData.symbol.toUpperCase(),
      category: formData.category,
      strategy: formData.strategy,
      aum: 'R0',
      investors: 0,
      nav: 'R10.00',
      minInvestment: Number(formData.minInvestment),
      managementFee: Number(formData.managementFee),
      performanceFee: Number(formData.performanceFee),
      status: 'Published',
      createdAt: new Date().toISOString(),
    }

    // Save to localStorage
    const updatedFunds = [...existingFunds, newFund]
    localStorage.setItem('funds', JSON.stringify(updatedFunds))

    // Redirect to fund management page
    router.push(`/wm/funds/${newFund.id}`)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-4 mb-8">
            <Link href="/wm/funds">
              <Button variant="ghost" className="hover-elevate press-compress">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Button>
            </Link>
            <div>
              <h1 className="text-4xl font-bold">Create New Fund</h1>
              <p className="text-muted-foreground">Launch a new tokenized investment fund</p>
            </div>
          </div>

          <AnimatedCard>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-primary">Fund Information</h2>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Fund Name *
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="e.g., Global Tech Growth Fund"
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Symbol *
                    </label>
                    <input
                      type="text"
                      name="symbol"
                      value={formData.symbol}
                      onChange={handleChange}
                      required
                      placeholder="e.g., GTGF"
                      maxLength={6}
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all uppercase"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Category *
                    </label>
                    <select
                      name="category"
                      value={formData.category}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    >
                      <option value="Equity">Equity</option>
                      <option value="Fixed Income">Fixed Income</option>
                      <option value="Alternative">Alternative</option>
                      <option value="Real Estate">Real Estate</option>
                      <option value="Multi-Asset">Multi-Asset</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Minimum Investment (ZAR) *
                    </label>
                    <input
                      type="number"
                      name="minInvestment"
                      value={formData.minInvestment}
                      onChange={handleChange}
                      required
                      min="100"
                      step="100"
                      placeholder="1000"
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Investment Strategy *
                  </label>
                  <textarea
                    name="strategy"
                    value={formData.strategy}
                    onChange={handleChange}
                    required
                    placeholder="Describe the fund's investment strategy and objectives..."
                    rows={3}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all resize-none"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-primary">Fee Structure</h2>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Management Fee (% p.a.) *
                    </label>
                    <input
                      type="number"
                      name="managementFee"
                      value={formData.managementFee}
                      onChange={handleChange}
                      required
                      min="0"
                      max="10"
                      step="0.1"
                      placeholder="2.0"
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Performance Fee (%) *
                    </label>
                    <input
                      type="number"
                      name="performanceFee"
                      value={formData.performanceFee}
                      onChange={handleChange}
                      required
                      min="0"
                      max="50"
                      step="0.1"
                      placeholder="20.0"
                      className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Link href="/wm/funds">
                  <Button type="button" variant="outline" className="glass-surface hover-elevate press-compress">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
                  Create Fund
                </Button>
              </div>
            </form>
          </AnimatedCard>

          <div className="mt-6 p-4 glass-surface rounded-lg border border-border/50">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              What happens next?
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Your fund will be created and published to the marketplace</li>
              <li>• Investors can browse and purchase fund tokens</li>
              <li>• You can manage tokens, NAV, and investor relations from the fund dashboard</li>
              <li>• All transactions will be recorded in the ledger</li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
