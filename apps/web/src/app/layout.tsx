import type { Metadata } from 'next'
import { IBM_Plex_Sans, JetBrains_Mono, Sora } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
})

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'BlockXOne - Multi-Asset Tokenization Platform',
  description: 'BlockXOne is a multi-asset tokenization platform for regulated private-market assets, investor onboarding, issuance, servicing, and reporting.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} ${ibmPlexSans.variable} ${jetBrainsMono.variable} font-[family:var(--font-body)]`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
