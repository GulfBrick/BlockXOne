import { MarketingPage } from '@/components/public/marketing-page'

export default function ForInvestorsPage() {
  return (
    <MarketingPage
      eyebrow="For investors"
      title="Investor access should feel clear, controlled, and trustworthy."
      description="The BlockXOne investor journey is designed around onboarding, qualification, portfolio visibility, documents, and redemption, not crypto-native complexity."
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {[
          'Clear investor onboarding and qualification status',
          'Asset discovery with supporting documents and context',
          'Portfolio visibility, transaction history, and redemption workflows',
        ].map((item) => (
          <div key={item} className="bxo-card p-6 text-sm leading-7 text-bxo-text-secondary">
            {item}
          </div>
        ))}
      </div>
    </MarketingPage>
  )
}
