import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicShell } from '@/components/public/public-shell'
import { FAQ_TOPICS } from '@/lib/faq-content'

export const metadata: Metadata = {
  title: 'Frequently asked questions | BlockXOne',
  description: 'Help with BlockXOne applications, independent review, verification, signing, wallets and environments.',
}

const topicLink = 'flex min-h-11 items-center border-b border-bxo-border-subtle py-3 text-sm text-bxo-text-secondary hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'

export default function FaqPage() {
  return <PublicShell>
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[90rem] px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <header className="border-b border-bxo-border-subtle pb-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-bxo-accent-primary">Help centre</p>
        <h1 className="mt-5 max-w-4xl font-ui text-4xl font-medium tracking-tight text-bxo-text-primary sm:text-6xl">Frequently asked questions</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-bxo-text-secondary">Getting started, completing an application and understanding what each step means. All answers are visible below.</p>
      </header>
      <div className="grid gap-12 py-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-20">
        <nav aria-label="FAQ topics" className="self-start">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-bxo-text-primary">On this page</h2>
          {FAQ_TOPICS.map(topic => <a key={topic.id} href={`#${topic.id}`} className={topicLink}>{topic.title}</a>)}
          <Link href="/request-demo" className={topicLink}>Contact / walkthrough</Link>
        </nav>
        <div className="min-w-0 space-y-12">
          {FAQ_TOPICS.map(topic => <section key={topic.id} id={topic.id} aria-labelledby={`${topic.id}-title`} tabIndex={-1} className="scroll-mt-28 border-b border-bxo-border-subtle pb-10">
            <h2 id={`${topic.id}-title`} className="text-2xl font-medium text-bxo-text-primary">{topic.title}</h2>
            <div className="mt-8 space-y-8">
              {topic.questions.map(item => <article key={item.question} className="max-w-[70ch]">
                <h3 className="text-lg font-semibold leading-7 text-bxo-text-primary">{item.question}</h3>
                <p className="mt-3 text-base leading-7 text-bxo-text-secondary">{item.answer}</p>
              </article>)}
            </div>
          </section>)}
          <a href="#main-content" className={`${topicLink} w-fit`}>Back to top</a>
        </div>
      </div>
    </main>
  </PublicShell>
}
