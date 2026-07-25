import { MarketingPage } from '@/components/public/marketing-page'

const steps = [
  'Define the asset, operating model, and control boundaries.',
  'Onboard and qualify investors and counterparties.',
  'Review subscriptions, settlement instructions, and approvals.',
  'Issue controlled on-chain positions under policy.',
  'Service documents, reporting, distributions, and lifecycle events.',
  'Redeem or transfer positions with audit and eligibility controls.',
]

export default function HowItWorksPage() {
  return (
    <MarketingPage
      eyebrow="How it works"
      title="Tokenization only works when the operating model is clear."
      description="BlockXOne is designed to coordinate onboarding, eligibility, issuance, servicing, and reporting around the token, not after it."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {steps.map((step, index) => (
          <div key={step} className="bxo-card p-6">
            <div className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Step {index + 1}</div>
            <p className="mt-4 text-sm leading-7 text-bxo-text-secondary">{step}</p>
          </div>
        ))}
      </div>
    </MarketingPage>
  )
}
