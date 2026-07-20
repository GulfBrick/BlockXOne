import { PublicShell } from './public-shell'

type MarketingPageProps = {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}

export function MarketingPage({ eyebrow, title, description, children }: MarketingPageProps) {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <section className="max-w-3xl space-y-6">
          <div className="inline-flex rounded-md border border-[#3B82F6]/25 bg-[#3B82F6]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#60A5FA]">
            {eyebrow}
          </div>
          <h1 className="font-[family:var(--font-display)] text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="text-base leading-8 text-white/65 sm:text-lg">
            {description}
          </p>
        </section>

        <section className="mt-14">
          {children}
        </section>
      </main>
    </PublicShell>
  )
}
