'use client'

import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { PageTransition } from './motion/page-transition'
import { AuthProvider } from '@/lib/auth-context-v2'
import { LayoutWrapper } from './layout-wrapper'
import { LoadingAnimation } from './effects/loading-animation'
import { usePathname } from 'next/navigation'

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

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <LoadingAnimation />
          <LayoutWrapper>
            <PageTransition routeKey={pathname}>
              {children}
            </PageTransition>
          </LayoutWrapper>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
