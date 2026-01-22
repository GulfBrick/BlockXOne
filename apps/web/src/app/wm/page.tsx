'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

import { AnimatedCard } from '@/components/motion/animated-card'
import { Button } from '@/components/ui/button'
import { WalletWidget } from '@/components/wallet/WalletWidget'
import { useAuth } from '@/lib/auth-context-v2'

const STATS = [
  { label: 'Total AUM', value: 'R542M', change: '+12.3%', trend: 'up' },
  { label: 'Active Funds', value: '8', change: '+2', trend: 'up' },
  { label: 'Total Investors', value: '1,247', change: '+89', trend: 'up' },
  { label: 'Pending Orders', value: '23', change: '-5', trend: 'down' }
]

const RECENT_ACTIVITY = [
  { type: 'subscription', investor: 'John Smith', fund: 'Tech Growth Fund', amount: 'R50,000', time: '2 hours ago' },
  { type: 'redemption', investor: 'Sarah Johnson', fund: 'ESG Fund', amount: 'R25,000', time: '5 hours ago' },
  { type: 'nav_update', fund: 'DeFi Optimizer', value: 'R15.67', time: '1 day ago' },
  { type: 'kyc_approval', investor: 'Michael Chen', status: 'Approved', time: '1 day ago' }
]

const PENDING_ACTIONS = [
  { action: 'NAV Update Required', fund: 'Global Tech Growth', due: 'Today', priority: 'high' },
  { action: 'Compliance Review', fund: 'Emerging Markets', due: 'Tomorrow', priority: 'medium' },
  { action: 'Investor Report', fund: 'Sustainable Energy', due: 'In 3 days', priority: 'low' }
]

export default function WealthManagerDashboard() {
  const { user } = useAuth()
  const walletAllowed = Boolean(user?.roles?.some((r) => r === 'OfferingManager' || r === 'IssuerFundManager'))

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
              <h1 className="text-4xl font-bold mb-2">Wealth Manager Dashboard</h1>
              <p className="text-muted-foreground">Manage your funds and investor relationships</p>
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

          {walletAllowed ? (
            <div className="glass-surface rounded-2xl p-4 mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">Wallet linking</div>
                <div className="text-base font-semibold">Link MetaMask to whitelist treasury actions</div>
              </div>
              <WalletWidget />
            </div>
          ) : null}

          <div className="grid md:grid-cols-4 gap-6 mb-8">
            {STATS.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <div className="glass-surface rounded-2xl p-6">
                  <div className="text-sm text-muted-foreground mb-2">{stat.label}</div>
                  <div className="text-3xl font-bold mb-2">{stat.value}</div>
                  <div className={`text-sm flex items-center gap-1 ${
                    stat.trend === 'up' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {stat.trend === 'up' ? '↑' : '↓'} {stat.change}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <AnimatedCard>
              <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
              <div className="space-y-3">
                {RECENT_ACTIVITY.map((activity, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-white/5">
                    <div className="mt-1">
                      {activity.type === 'subscription' && (
                        <div className="w-8 h-8 rounded-full bg-green-400/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                      )}
                      {activity.type === 'redemption' && (
                        <div className="w-8 h-8 rounded-full bg-orange-400/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </div>
                      )}
                      {activity.type === 'nav_update' && (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                        </div>
                      )}
                      {activity.type === 'kyc_approval' && (
                        <div className="w-8 h-8 rounded-full bg-blue-400/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {activity.type === 'subscription' && `${activity.investor} subscribed to ${activity.fund}`}
                        {activity.type === 'redemption' && `${activity.investor} redeemed from ${activity.fund}`}
                        {activity.type === 'nav_update' && `NAV updated for ${activity.fund}`}
                        {activity.type === 'kyc_approval' && `KYC ${activity.status} for ${activity.investor}`}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{activity.time}</div>
                    </div>
                    {activity.amount && (
                      <div className="text-sm font-semibold">{activity.amount}</div>
                    )}
                    {activity.value && (
                      <div className="text-sm font-semibold">{activity.value}</div>
                    )}
                  </div>
                ))}
              </div>
            </AnimatedCard>

            <AnimatedCard>
              <h2 className="text-xl font-semibold mb-4">Pending Actions</h2>
              <div className="space-y-3">
                {PENDING_ACTIONS.map((item, index) => (
                  <div key={index} className="p-4 rounded-lg bg-white/5 border-l-4" style={{
                    borderLeftColor: item.priority === 'high' ? '#f87171' : item.priority === 'medium' ? '#fbbf24' : '#60a5fa'
                  }}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-medium">{item.action}</div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        item.priority === 'high' ? 'bg-red-400/10 text-red-400' :
                        item.priority === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
                        'bg-blue-400/10 text-blue-400'
                      }`}>
                        {item.priority}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mb-3">{item.fund}</div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Due: {item.due}</span>
                      <Button size="sm" variant="ghost" className="hover-elevate press-compress">
                        Take Action
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </AnimatedCard>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Link href="/wm/funds">
              <AnimatedCard className="cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">Manage Funds</div>
                    <div className="text-sm text-muted-foreground">View and edit your funds</div>
                  </div>
                </div>
              </AnimatedCard>
            </Link>

            <Link href="/wm/investors">
              <AnimatedCard className="cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">Investors</div>
                    <div className="text-sm text-muted-foreground">Manage investor relationships</div>
                  </div>
                </div>
              </AnimatedCard>
            </Link>

            <Link href="/wm/reports">
              <AnimatedCard className="cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">Reports</div>
                    <div className="text-sm text-muted-foreground">Generate performance reports</div>
                  </div>
                </div>
              </AnimatedCard>
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
