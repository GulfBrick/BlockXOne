'use client'

import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { PageTransition } from './motion/page-transition'
import { AuthProvider } from '@/lib/auth-context-v2'
import { LayoutWrapper } from './layout-wrapper'
import { LoadingAnimation } from './effects/loading-animation'
import { usePathname } from 'next/navigation'
import { MotionConfig } from 'framer-motion'
import { isLegacyClientAuthDisabled } from '@/lib/auth-mode'
import { isProductionWebPathBlocked } from '@/lib/release-policy'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  }))

  const pathname = usePathname()
  const nativeDeclared = isLegacyClientAuthDisabled()
  const publicAuthMode = process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE
  const routeUnavailable = nativeDeclared && isProductionWebPathBlocked(
    pathname, 'production', '', '', publicAuthMode, publicAuthMode
  )
  // Middleware/handlers remain authoritative. This also prevents denied legacy
  // client trees from probing Auth or rendering during static build/navigation.
  const content = routeUnavailable ? (
    <main className="min-h-screen bg-bxo-bg-primary px-6 py-24 text-bxo-text-primary">
      <p>This operation is not enabled.</p>
    </main>
  ) : children

  const shell = (
    <MotionConfig reducedMotion="user">
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <LoadingAnimation />
        <LayoutWrapper>
          <PageTransition routeKey={pathname}>
            {content}
          </PageTransition>
        </LayoutWrapper>
      </ThemeProvider>
    </MotionConfig>
  )

  return (
    <QueryClientProvider client={queryClient}>
      {nativeDeclared ? shell : <AuthProvider>{shell}</AuthProvider>}
    </QueryClientProvider>
  )
}
