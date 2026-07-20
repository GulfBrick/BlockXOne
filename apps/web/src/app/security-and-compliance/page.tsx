import { MarketingPage } from '@/components/public/marketing-page'

export default function SecurityAndCompliancePage() {
  return (
    <MarketingPage
      eyebrow="Security and compliance"
      title="BlockXOne should describe control posture precisely, not decorate the page with unverified badges."
      description="Public messaging should focus on role-based access, eligibility controls, auditability, and workflow traceability while certifications remain evidence-based."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {[
          'Role-based access and separate investor versus operator surfaces',
          'Eligibility, qualification, and transfer-control workflows',
          'Auditable servicing and lifecycle operations',
          'Operator traceability for high-risk actions and approvals',
        ].map((item) => (
          <div key={item} className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-6 text-sm leading-7 text-white/64">
            {item}
          </div>
        ))}
      </div>
    </MarketingPage>
  )
}
