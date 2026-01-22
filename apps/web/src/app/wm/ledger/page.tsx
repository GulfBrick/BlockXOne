'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { getTransactions, getTotalVolume, getTotalTransactions, type Transaction } from '@/lib/transactions'
import { AnimatedCard } from '@/components/motion/animated-card'

export default function LedgerPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell' | 'mint' | 'burn'>('all')
  const [totalVolume, setTotalVolume] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    loadTransactions()
  }, [])

  const loadTransactions = () => {
    const txns = getTransactions()
    setTransactions(txns)
    setTotalVolume(getTotalVolume())
    setTotalCount(getTotalTransactions())
  }

  const filteredTransactions = filter === 'all' 
    ? transactions 
    : transactions.filter(t => t.type === filter)

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'buy': return 'text-green-400 bg-green-400/10'
      case 'sell': return 'text-red-400 bg-red-400/10'
      case 'mint': return 'text-blue-400 bg-blue-400/10'
      case 'burn': return 'text-orange-400 bg-orange-400/10'
      case 'nav_update': return 'text-cyan-400 bg-cyan-400/10'
      default: return 'text-gray-400 bg-gray-400/10'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400'
      case 'pending': return 'text-yellow-400'
      case 'failed': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl font-bold mb-2">Transaction Ledger</h1>
          <p className="text-muted-foreground mb-8">Complete history of all fund transactions</p>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <AnimatedCard>
              <div className="text-sm text-muted-foreground mb-1">Total Volume</div>
              <div className="text-2xl font-bold">R{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </AnimatedCard>
            <AnimatedCard>
              <div className="text-sm text-muted-foreground mb-1">Total Transactions</div>
              <div className="text-2xl font-bold">{totalCount}</div>
            </AnimatedCard>
            <AnimatedCard>
              <div className="text-sm text-muted-foreground mb-1">Active Investors</div>
              <div className="text-2xl font-bold">
                {new Set(transactions.map(t => t.investorEmail)).size}
              </div>
            </AnimatedCard>
          </div>

          <div className="glass-surface rounded-2xl p-6">
            <div className="flex flex-wrap gap-2 mb-6">
              {(['all', 'buy', 'sell', 'mint', 'burn'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === type
                      ? 'bg-primary text-white'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-16 h-16 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-muted-foreground">No transactions yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Transactions will appear here when investors make purchases
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTransactions.map((txn) => (
                  <motion.div
                    key={txn.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeColor(txn.type)}`}>
                            {txn.type.toUpperCase()}
                          </span>
                          <span className="font-semibold">{txn.fundName}</span>
                          <span className="text-sm text-muted-foreground">({txn.fundSymbol})</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {txn.investorName} • {txn.investorEmail}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(txn.timestamp).toLocaleString('en-ZA', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold mb-1">
                          {txn.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} tokens
                        </div>
                        <div className="text-sm text-muted-foreground mb-1">
                          @ R{txn.pricePerToken.toFixed(2)}
                        </div>
                        <div className="text-lg font-bold text-primary">
                          R{txn.totalAmount.toFixed(2)}
                        </div>
                        <div className={`text-xs ${getStatusColor(txn.status)}`}>
                          {txn.status}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
