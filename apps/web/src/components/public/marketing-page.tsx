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
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <section className="max-w-3xl space-y-6">
          <div className="bxo-kicker">{eyebrow}</div>
          <h1 className="font-display text-4xl font-semibold leading-tight text-bxo-text-primary sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="text-base leading-8 text-bxo-text-secondary sm:text-lg">
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
