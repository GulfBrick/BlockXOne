import Image from 'next/image'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/asset-classes', label: 'Asset classes' },
  { href: '/for-investors', label: 'For investors' },
  { href: '/for-operators', label: 'For operators' },
  { href: '/security-and-compliance', label: 'Security' },
]

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-[#3B82F6]/40" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,transparent,rgba(7,10,18,0.6))]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0F1A]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="BlockXOne"
              width={52}
              height={52}
              className="h-12 w-12 object-contain"
              priority
            />
            <div className="min-w-0">
              <div className="font-[family:var(--font-display)] text-base font-semibold tracking-[0.18em] text-white sm:text-lg">
                BLOCKXONE
              </div>
              <div className="hidden text-xs text-white/45 sm:block">
                Multi-asset tokenization platform
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-4 py-2 text-sm text-white/68 transition hover:bg-white/6 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button asChild variant="ghost" className="rounded-md text-white/80 hover:bg-white/8 hover:text-white">
              <Link href="/investor/login">Investor login</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-md border-white/12 bg-white/5 text-white hover:bg-white/10">
              <Link href="/operator/login">Operator login</Link>
            </Button>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-white/8 bg-black/20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_0.8fr_0.8fr] lg:px-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="BlockXOne" width={40} height={40} className="h-10 w-10 object-contain" />
              <div className="font-[family:var(--font-display)] text-sm font-semibold tracking-[0.16em] text-white">BLOCKXONE</div>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/55">
              BlockXOne is being rebuilt as a multi-asset tokenization platform for regulated private-market assets,
              with separate public, investor, and operator experiences.
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Platform</div>
            <div className="grid gap-2 text-sm text-white/60">
              <Link href="/how-it-works" className="transition hover:text-white">How it works</Link>
              <Link href="/asset-classes" className="transition hover:text-white">Asset classes</Link>
              <Link href="/security-and-compliance" className="transition hover:text-white">Security</Link>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Access</div>
            <div className="grid gap-2 text-sm text-white/60">
              <Link href="/investor/login" className="transition hover:text-white">Investor login</Link>
              <Link href="/operator/login" className="transition hover:text-white">Operator login</Link>
              <Link href="/request-demo" className="transition hover:text-white">Request demo</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
