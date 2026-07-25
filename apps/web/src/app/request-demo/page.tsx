import Link from 'next/link'

import { MarketingPage } from '@/components/public/marketing-page'
import { Button } from '@/components/ui/button'

export default function RequestDemoPage() {
  return (
    <MarketingPage
      eyebrow="Request demo"
      title="Start with the right BlockXOne conversation."
      description="BlockXOne is being rebuilt around clearer public, investor, and operator surfaces. If you already have operator credentials, use the operator login. If you are evaluating the platform, this page defines the intended walkthrough path."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bxo-card p-7">
          <h2 className="text-xl font-semibold text-bxo-text-primary">Evaluation topics</h2>
          <div className="mt-5 grid gap-3 text-sm leading-7 text-bxo-text-secondary">
            <div>Asset classes and launch scope</div>
            <div>Investor onboarding and qualification model</div>
            <div>Operator controls, servicing, and reporting workflows</div>
            <div>Token standard, chain strategy, and integration boundary</div>
          </div>
        </div>

        <div className="bxo-panel p-7">
          <h2 className="text-xl font-semibold text-bxo-text-primary">Current next step</h2>
          <p className="mt-4 text-sm leading-7 text-bxo-text-secondary">
            The public conversion path is being rebuilt alongside the platform shell. For now, operator access and investor
            access are split explicitly while the demo intake workflow is finalized.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="bxo-primary-cta h-11 rounded-xl font-semibold">
              <Link href="/operator/login">Operator login</Link>
            </Button>
            <Button asChild variant="outline" className="bxo-secondary-cta h-11 rounded-xl">
              <Link href="/">Back to overview</Link>
            </Button>
          </div>
        </div>
      </div>
    </MarketingPage>
  )
}
