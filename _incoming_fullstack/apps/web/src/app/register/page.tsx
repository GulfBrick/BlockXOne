'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'

export default function RegisterPage() {
  useEffect(() => {
    // Auto-redirect to Replit Auth
    const timer = setTimeout(() => {
      window.location.href = '/api/login'
    }, 1000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,188,212,0.1),transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative"
      >
        <div className="glass-surface rounded-2xl p-12 text-center">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">
              <span className="bg-gradient-to-r from-primary to-white bg-clip-text text-transparent">
                BlockXOne
              </span>
            </h1>
          </div>

          <h2 className="text-xl font-semibold mb-2">Create Account</h2>
          <p className="text-muted-foreground mb-8">
            Start your investment journey with BlockXOne
          </p>

          <div className="flex items-center justify-center mb-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>

          <Button
            onClick={() => window.location.href = '/api/login'}
            className="w-full bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
          >
            Continue to Sign Up
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
