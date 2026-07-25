import { MarketingPage } from '@/components/public/marketing-page'

export default function ForOperatorsPage() {
  return (
    <MarketingPage
      eyebrow="For operators"
      title="The operator console is where issuance, compliance, and servicing come together."
      description="Issuer, compliance, treasury, tokenisation, and administrative teams need one controlled operating surface with clear ownership and auditability."
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {[
          'Issuance setup, operating parameters, and investor controls',
          'Compliance review queues, role-based actions, and audit visibility',
          'Treasury, servicing, token operations, and lifecycle reporting',
        ].map((item) => (
          <div key={item} className="bxo-card p-6 text-sm leading-7 text-bxo-text-secondary">
            {item}
          </div>
        ))}
      </div>
    </MarketingPage>
  )
}
