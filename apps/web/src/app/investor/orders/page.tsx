'use client'

import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'

const ORDERS = [
  {
    id: '1',
    type: 'Subscribe',
    fund: 'Global Tech Growth Fund',
    symbol: 'GTGF',
    quantity: 150,
    amount: 'R1,470',
    status: 'Completed',
    date: '2025-10-10',
  },
  {
    id: '2',
    type: 'Subscribe',
    fund: 'Sustainable Energy Fund',
    symbol: 'SENF',
    quantity: 200,
    amount: 'R1,700',
    status: 'Completed',
    date: '2025-10-08',
  },
  {
    id: '3',
    type: 'Redeem',
    fund: 'DeFi Yield Optimizer',
    symbol: 'DFYO',
    quantity: 50,
    amount: 'R783.50',
    status: 'Processing',
    date: '2025-10-14',
  },
]

export default function OrdersPage() {
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Order History</h1>
          <p className="text-muted-foreground mb-8">View your subscription and redemption orders</p>

          <div className="space-y-4">
            {ORDERS.map((order, index) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          order.type === 'Subscribe' ? 'bg-green-400/10 text-green-400' : 'bg-orange-400/10 text-orange-400'
                        }`}>
                          {order.type}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          order.status === 'Completed' ? 'bg-primary/10 text-primary' : 'bg-yellow-400/10 text-yellow-400'
                        }`}>
                          {order.status}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold mb-1">{order.fund}</h3>
                      <p className="text-sm text-muted-foreground">{order.symbol} • {order.date}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Quantity</div>
                        <div className="text-lg font-semibold">{order.quantity}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Amount</div>
                        <div className="text-lg font-semibold">{order.amount}</div>
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
