import Image from 'next/image'

import { PublicShell } from './public-shell'

type MarketingPageProps = {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
  heroAside?: React.ReactNode
}

const pageVisuals: Record<string, { src: string; alt: string; caption: string }> = {
  'Asset classes': {
    src: '/editorial/multi-asset-structures-portrait.webp',
    alt: 'Material studies representing private debt, fund interests and real estate ownership structures',
    caption: 'Distinct instruments. Shared operating controls.',
  },
  Investors: {
    src: '/editorial/stewardship-portrait.webp',
    alt: 'Private-market participants reviewing legal records and an architectural asset model',
    caption: 'Clear obligations. Verifiable positions.',
  },
  Operators: {
    src: '/editorial/stewardship-portrait.webp',
    alt: 'Institutional operators reviewing legal records and a structured asset model',
    caption: 'Shared truth. Separate authority.',
  },
  'Trust and control': {
    src: '/editorial/evidence-vault-portrait.webp',
    alt: 'A secure architectural archive of ordered records and a bound ownership register',
    caption: 'Identity, authority, financial integrity and chain evidence.',
  },
}

export function MarketingPage({ eyebrow, title, description, children, heroAside }: MarketingPageProps) {
  const visual = pageVisuals[eyebrow]
  const titleSize = visual
    ? 'text-[clamp(3rem,5vw,5.9rem)]'
    : 'text-[clamp(3.1rem,6.7vw,7.4rem)]'

  return (
    <PublicShell>
      <main id="main-content">
        <div className="bxo-scroll-progress" aria-hidden="true">
          <span data-bxo-scroll-progress />
        </div>

        <section className="bxo-marketing-hero border-b border-bxo-border-subtle">
          <div className={`bxo-marketing-hero__layout ${visual ? 'bxo-marketing-hero__layout--visual' : ''}`}>
            <div className="bxo-marketing-hero__copy" data-bxo-hero-track>
              <div className="bxo-editorial-index" data-bxo-hero-detail data-bxo-hero-kicker>
                <span>BXO</span>
                <span>{eyebrow}</span>
              </div>
              <h1 className="mt-8 text-bxo-text-primary">
                <span className="bxo-type-mask pb-2">
                  <span className={`block font-ui ${titleSize} font-medium leading-[0.91] tracking-[-0.068em]`} data-bxo-hero-line>
                    {title}
                  </span>
                </span>
              </h1>
              <p className="mt-8 max-w-3xl font-reading text-xl leading-8 text-bxo-text-secondary sm:text-2xl sm:leading-9" data-bxo-hero-detail data-bxo-hero-copy>
                {description}
              </p>
            </div>

            {visual ? (
              <figure className="bxo-marketing-hero__media" data-bxo-hero-media data-bxo-parallax-frame>
                <div data-bxo-parallax="hero">
                  <Image
                    src={visual.src}
                    alt={visual.alt}
                    fill
                    priority
                    sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 3rem), (max-width: 1439px) 44vw, 608px"
                    quality={90}
                  />
                </div>
                <figcaption data-bxo-hero-detail data-bxo-hero-caption>{visual.caption}</figcaption>
              </figure>
            ) : null}

            {heroAside ? <div className="bxo-marketing-hero__aside" data-bxo-hero-aside>{heroAside}</div> : null}
          </div>
        </section>

        <div className="mx-auto max-w-[90rem] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
          {children}
        </div>
      </main>
    </PublicShell>
  )
}
