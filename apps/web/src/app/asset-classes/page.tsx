import { MarketingPage } from '@/components/public/marketing-page'

const assetClasses = [
  {
    title: 'Private funds',
    text: 'Fund vehicles with controlled onboarding, subscriptions, investor reporting, and redemption workflows.',
  },
  {
    title: 'Private credit',
    text: 'Debt programs with issuance controls, eligibility rules, payout events, and servicing visibility.',
  },
  {
    title: 'Real-estate vehicles',
    text: 'Property-backed structures with document workflows, investor onboarding, and lifecycle operations.',
  },
  {
    title: 'Structured products',
    text: 'Cash-equivalent and structured debt programs with clear issuance, settlement, and reporting controls.',
  },
]

export default function AssetClassesPage() {
  return (
    <MarketingPage
      eyebrow="Asset classes"
      title="Built for regulated private-market instruments."
      description="BlockXOne is multi-asset by architecture while keeping its launch focus on the asset classes that need strong operating controls first."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {assetClasses.map((item) => (
          <div key={item.title} className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-6">
            <h2 className="text-xl font-semibold text-white">{item.title}</h2>
            <p className="mt-4 text-sm leading-7 text-white/64">{item.text}</p>
          </div>
        ))}
      </div>
    </MarketingPage>
  )
}
