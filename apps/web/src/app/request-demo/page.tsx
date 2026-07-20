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
        <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-7">
          <h2 className="text-xl font-semibold text-white">Evaluation topics</h2>
          <div className="mt-5 grid gap-3 text-sm leading-7 text-white/64">
            <div>Asset classes and launch scope</div>
            <div>Investor onboarding and qualification model</div>
            <div>Operator controls, servicing, and reporting workflows</div>
            <div>Token standard, chain strategy, and integration boundary</div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-[#3B82F6]/12 bg-[#3B82F6]/[0.06] p-7">
          <h2 className="text-xl font-semibold text-white">Current next step</h2>
          <p className="mt-4 text-sm leading-7 text-white/64">
            The public conversion path is being rebuilt alongside the platform shell. For now, operator access and investor
            access are split explicitly while the demo intake workflow is finalized.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-md bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA] text-white">
              <Link href="/operator/login">Operator login</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-md border-white/12 bg-white/5 text-white hover:bg-white/10">
              <Link href="/">Back to overview</Link>
            </Button>
          </div>
        </div>
      </div>
    </MarketingPage>
  )
}
