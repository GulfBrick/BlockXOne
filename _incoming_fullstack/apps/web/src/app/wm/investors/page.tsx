'use client'

import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'

const INVESTORS = [
  { id: '1', name: 'John Smith', email: 'john@example.com', kyc: 'Approved', holdings: 'R52,000', joined: '2025-08-15' },
  { id: '2', name: 'Sarah Johnson', email: 'sarah@example.com', kyc: 'Approved', holdings: 'R38,500', joined: '2025-09-22' },
  { id: '3', name: 'Michael Chen', email: 'michael@example.com', kyc: 'Pending', holdings: 'R0', joined: '2025-10-12' },
]

export default function WMInvestorsPage() {
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Investors</h1>
          <p className="text-muted-foreground mb-8">Manage your investor relationships</p>

          <div className="space-y-4">
            {INVESTORS.map((investor, index) => (
              <motion.div
                key={investor.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1">{investor.name}</h3>
                      <p className="text-sm text-muted-foreground">{investor.email}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">KYC Status</div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          investor.kyc === 'Approved' ? 'bg-green-400/10 text-green-400' : 'bg-yellow-400/10 text-yellow-400'
                        }`}>
                          {investor.kyc}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Holdings</div>
                        <div className="font-semibold">{investor.holdings}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Joined</div>
                        <div className="font-semibold">{investor.joined}</div>
                      </div>
                    </div>
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
