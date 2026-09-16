import type { Metadata, Viewport } from 'next'
import { Abril_Fatface, Archivo, JetBrains_Mono, STIX_Two_Text } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const abril = Abril_Fatface({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-accent',
  display: 'swap',
})

const archivo = Archivo({
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
})

const stix = STIX_Two_Text({
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal', 'italic'],
  variable: '--font-reading',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  applicationName: 'BlockXOne',
  title: {
    default: 'BlockXOne | Multi-Asset Tokenisation Platform',
    template: '%s | BlockXOne',
  },
  description: 'One platform for multi-asset tokenisation, programmable ownership, investor onboarding, issuance, servicing, and reporting.',
  manifest: '/site.webmanifest',
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

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#031A28',
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
      className={`${abril.variable} ${archivo.variable} ${stix.variable} ${jetBrainsMono.variable}`}
    >
      <body className="font-ui">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
