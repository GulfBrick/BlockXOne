'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const router = useRouter()

  const handleLogin = () => {
    // For demo purposes, just redirect to home
    // In production, this would go to /api/login
    router.push('/')
  }

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

          <h2 className="text-xl font-semibold mb-2">Welcome Back</h2>
          <p className="text-muted-foreground mb-8">
            Sign in to access your account
          </p>

          <div className="space-y-3 mb-6">
            <Button
              onClick={handleLogin}
              className="w-full bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Sign In (Demo)
            </Button>
            
            <p className="text-xs text-muted-foreground">
              In production, this would use Replit Auth
            </p>
          </div>

          <div className="pt-6 border-t border-white/10">
            <p className="text-sm text-muted-foreground mb-3">Demo Portals:</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => router.push('/investor/market')}
                variant="outline"
                size="sm"
                className="glass-surface hover-elevate press-compress focus-ring"
              >
                Investor
              </Button>
              <Button
                onClick={() => router.push('/wm')}
                variant="outline"
                size="sm"
                className="glass-surface hover-elevate press-compress focus-ring"
              >
                Wealth Manager
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
