'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { HexGrid } from '@/components/effects/hex-grid'

export default function Home() {

  return (
    <main className="min-h-screen relative bg-[#0D0F14]">
      <HexGrid />
      
      <section id="hero" className="relative min-h-[100svh]">
        <div className="min-h-[100svh] flex flex-col items-center justify-center px-4 pt-12 pb-20">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="w-full max-w-3xl mb-10 md:mb-12 flex flex-col items-center justify-center gap-4"
          >
            <div className="w-full aspect-video bg-gradient-to-br from-cyan-900/20 to-blue-900/20 rounded-lg p-4 flex items-center justify-center">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-contain rounded"
                style={{
                  filter: 'drop-shadow(0 0 40px rgba(0, 188, 212, 0.6))',
                }}
              >
                <source src="/bxo_drop.mp4" type="video/mp4" />
              </video>
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-center z-10"
          >
            <h1 className="text-5xl md:text-7xl font-bold mb-4 bg-gradient-to-r from-[#00B6FF] via-[#0894E6] to-[#0A6FB6] bg-clip-text text-transparent">
              BlockXOne
            </h1>
            <p className="text-xl md:text-2xl text-gray-400 mb-8 max-w-2xl">
              Tokenize Funds. Trade with Guardrails.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="relative z-10 bg-gradient-to-b from-transparent via-[#0D0F14] to-[#0D0F14] -mt-24 md:-mt-32 pt-12 pb-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {[
              {
                title: 'For Investors',
                description: 'Access tokenized investment opportunities',
                features: [
                  'Browse vetted fund marketplace',
                  'Complete KYC verification',
                  'Subscribe & redeem positions',
                  'P2P secondary trading',
                  'Real-time portfolio tracking'
                ],
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )
              },
              {
                title: 'For Wealth Managers',
                description: 'Tokenize and manage your funds',
                features: [
                  'Create ERC-3643 compliant tokens',
                  'Manage investor subscriptions',
                  'Update NAV and distributions',
                  'Comprehensive reporting',
                  'Cap table management'
                ],
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                )
              },
              {
                title: 'Compliance & Admin',
                description: 'Enterprise-grade controls',
                features: [
                  'KYC approval workflows',
                  'Jurisdiction-based rules',
                  'Immutable audit logs',
                  'Account freeze controls',
                  'Role & permission management'
                ],
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                )
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.15 }}
                viewport={{ once: true }}
                className="holographic-card group"
              >
                <div className="inline-block p-3 rounded-xl bg-primary/10 mb-4 text-primary">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-3 text-white">{feature.title}</h3>
                <p className="text-sm text-gray-400 mb-4">{feature.description}</p>
                <ul className="space-y-2 text-sm text-gray-500">
                  {feature.features.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="text-primary">✓</span> {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="text-center glass-panel p-12 rounded-3xl max-w-4xl mx-auto"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6 bg-gradient-to-r from-[#00B6FF] to-[#0A6FB6] bg-clip-text text-transparent">
              Start Investing Today
            </h2>
            <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
              Join thousands of investors accessing premium tokenized funds on the blockchain
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/login">
                <Button 
                  size="lg"
                  className="bg-gradient-to-r from-[#00B6FF] to-[#0894E6] hover:from-[#0894E6] hover:to-[#0A6FB6] text-white px-8 py-6 text-lg hover-elevate press-compress shadow-lg shadow-[#00B6FF]/20"
                >
                  Sign In
                </Button>
              </Link>
              <Link href="/investor/market">
                <Button 
                  size="lg"
                  variant="outline" 
                  className="glass-surface border-[#1A3A5A] px-8 py-6 text-lg hover-elevate press-compress"
                >
                  Explore Funds
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="text-center glass-surface rounded-2xl p-8 max-w-3xl mx-auto mt-12"
          >
            <h2 className="text-2xl font-bold mb-4 text-white">Built with Enterprise Security</h2>
            <p className="text-gray-400 mb-6">
              2FA authentication • App Check enforcement • Field-level encryption • SOC 2 compliant
            </p>
            <div className="flex justify-center gap-8 text-sm flex-wrap">
              <span className="flex items-center gap-2 text-gray-400">
                <span className="text-primary">🔒</span> WCAG 2.1 AA
              </span>
              <span className="flex items-center gap-2 text-gray-400">
                <span className="text-primary">🔒</span> GDPR Compliant
              </span>
              <span className="flex items-center gap-2 text-gray-400">
                <span className="text-primary">🔒</span> ISO 27001
              </span>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  )
}
