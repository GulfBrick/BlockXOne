'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'

export function LoadingAnimation() {
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Loading animation disabled for now
  }, [])

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0F14]"
        >
          <div className="relative">
            <svg width="120" height="120" viewBox="0 0 120 120">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <motion.path
                  key={i}
                  d={`M ${60 + 50 * Math.cos((i * Math.PI) / 3)} ${60 + 50 * Math.sin((i * Math.PI) / 3)} L ${60 + 50 * Math.cos(((i + 1) * Math.PI) / 3)} ${60 + 50 * Math.sin(((i + 1) * Math.PI) / 3)}`}
                  stroke="url(#gradient)"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{
                    duration: 0.8,
                    delay: i * 0.15,
                    ease: "easeInOut"
                  }}
                />
              ))}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00B6FF" />
                  <stop offset="50%" stopColor="#0894E6" />
                  <stop offset="100%" stopColor="#0A6FB6" />
                </linearGradient>
              </defs>
            </svg>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.2, duration: 0.4 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="text-2xl font-bold bg-gradient-to-r from-[#00B6FF] to-[#0A6FB6] bg-clip-text text-transparent">
                BXO
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
