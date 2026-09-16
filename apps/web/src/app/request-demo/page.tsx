import { MarketingPage } from '@/components/public/marketing-page'
import { isDemoRequestEnabled } from '@/lib/demo-request'

import { DemoRequestForm } from './demo-request-form'

export default function RequestDemoPage() {
  const intakeEnabled = isDemoRequestEnabled()
  return (
    <MarketingPage
      eyebrow="Platform access"
      title="Discuss your tokenisation programme."
      description={intakeEnabled
        ? 'Tell us about the asset, jurisdiction, participants, operating model, and workflow you need to support. We will shape the conversation around your requirements and the right BlockXOne deployment path.'
        : 'Explore how BlockXOne supports tokenisation programmes. Online enquiries are temporarily unavailable and this page is not collecting personal information.'}
    >
      <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-28" data-bxo-reveal>
          <section className="border-y border-bxo-border-subtle py-8" aria-labelledby="request-process-heading">
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Enquiry process</p>
            <h2 id="request-process-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl">What happens next</h2>
            <ol className="mt-8 border-t border-bxo-border-subtle">
              {[
                ['Requirements review', 'We assess your intended instrument, jurisdiction, participants, integrations, and operating controls.'],
                ['Focused walkthrough', 'The session follows the workflow and decisions your team needs to understand.'],
                ['Implementation path', 'We define scope, responsibilities, integrations, assurance requirements, and commercial terms.'],
              ].map(([title, description], index) => (
                <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-bxo-border-subtle py-5">
                  <span className="font-ui text-xs font-semibold tabular-nums text-bxo-accent-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="font-ui text-base font-semibold text-bxo-text-primary">{title}</h3>
                    <p className="mt-2 font-reading text-base leading-7 text-bxo-text-secondary">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="border-b border-bxo-border-subtle py-8" aria-labelledby="enquiry-boundary-heading">
            <h2 id="enquiry-boundary-heading" className="font-ui text-base font-semibold text-bxo-text-primary">A platform enquiry, not an application</h2>
            <p className="mt-3 font-reading text-base leading-7 text-bxo-text-secondary">
              {intakeEnabled
                ? 'Submitting this form does not create an account, approve an instrument or investor, reserve implementation capacity, guarantee production deployment, or make an investment offer.'
                : 'This public website does not create an account, approve an instrument or investor, or make an investment offer. Online enquiry intake is not currently available.'}
            </p>
          </section>
        </aside>

        <div className="min-w-0" data-bxo-reveal>
          <DemoRequestForm />
        </div>
      </div>
    </MarketingPage>
  )
}
