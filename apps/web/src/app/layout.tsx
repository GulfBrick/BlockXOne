import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Orbitron } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
})

const inter = Inter({
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
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: {
      url: '/brand/apple-touch-icon.png',
      sizes: '180x180',
      type: 'image/png',
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${orbitron.variable} ${inter.variable} ${jetBrainsMono.variable}`}
    >
      <body className="font-ui">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
