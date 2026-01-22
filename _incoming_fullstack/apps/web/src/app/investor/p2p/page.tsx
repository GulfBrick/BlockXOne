'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ORDERS = [
  { id: '1', fund: 'GTGF', side: 'Sell', quantity: 50, price: 'R10.55', total: 'R527.50', status: 'Open' },
  { id: '2', fund: 'SENF', side: 'Buy', quantity: 100, price: 'R8.90', total: 'R890.00', status: 'Open' },
]

export default function P2PTradingPage() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">P2P Trading</h1>
          <p className="text-muted-foreground mb-8">Trade fund tokens with other investors</p>

          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <AnimatedCard>
              <h2 className="text-xl font-semibold mb-4">Create Order</h2>
              
              <div className="flex gap-2 mb-6">
                <Button
                  onClick={() => setSide('buy')}
                  className={side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-white/5'}
                  style={{ flex: 1 }}
                >
                  Buy
                </Button>
                <Button
                  onClick={() => setSide('sell')}
                  className={side === 'sell' ? 'bg-red-600 hover:bg-red-700' : 'bg-white/5'}
                  style={{ flex: 1 }}
                >
                  Sell
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <Label>Fund Token</Label>
                  <select className="w-full mt-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus-ring">
                    <option>GTGF - Global Tech Growth</option>
                    <option>SENF - Sustainable Energy</option>
                    <option>DFYO - DeFi Optimizer</option>
                  </select>
                </div>

                <div>
                  <Label>Quantity</Label>
                  <Input type="number" placeholder="0" className="mt-2" />
                </div>

                <div>
                  <Label>Price per Token</Label>
                  <Input type="number" placeholder="R0.00" className="mt-2" />
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold">R0.00</span>
                  </div>
                  <div className="flex justify-between text-sm mb-4">
                    <span className="text-muted-foreground">Fee (0.5%)</span>
                    <span className="font-semibold">R0.00</span>
                  </div>
                </div>

                <Button className="w-full bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
                  Place {side === 'buy' ? 'Buy' : 'Sell'} Order
                </Button>
              </div>
            </AnimatedCard>

            <AnimatedCard>
              <h2 className="text-xl font-semibold mb-4">Order Book</h2>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm font-semibold text-muted-foreground pb-2 border-b border-white/10">
                  <span>Price</span>
                  <span>Quantity</span>
                  <span>Total</span>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm p-2 rounded bg-red-500/10">
                    <span className="text-red-400">R10.55</span>
                    <span>50</span>
                    <span>R527.50</span>
                  </div>
                  <div className="flex justify-between text-sm p-2 rounded bg-red-500/10">
                    <span className="text-red-400">R10.52</span>
                    <span>120</span>
                    <span>R1,262.40</span>
                  </div>
                  <div className="flex justify-between text-sm p-2 rounded bg-green-500/10">
                    <span className="text-green-400">R10.48</span>
                    <span>80</span>
                    <span>R838.40</span>
                  </div>
                  <div className="flex justify-between text-sm p-2 rounded bg-green-500/10">
                    <span className="text-green-400">R10.45</span>
                    <span>200</span>
                    <span>R2,090.00</span>
                  </div>
                </div>
              </div>
            </AnimatedCard>
          </div>

          <AnimatedCard>
            <h2 className="text-xl font-semibold mb-4">My Orders</h2>
            <div className="space-y-3">
              {ORDERS.map((order) => (
                <div key={order.id} className="flex justify-between items-center p-4 rounded-lg bg-white/5">
                  <div>
                    <div className="font-semibold">{order.fund}</div>
                    <div className="text-sm text-muted-foreground">
                      {order.side} {order.quantity} @ {order.price}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{order.total}</div>
                    <div className="text-sm text-primary">{order.status}</div>
                  </div>
                  <Button size="sm" variant="outline" className="glass-surface hover-elevate press-compress">
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          </AnimatedCard>
        </motion.div>
      </div>
    </div>
  )
}
