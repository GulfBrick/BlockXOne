'use client'

import { Card } from '@/components/ui/card'

type AuditRow = {
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

const AUDIT_ROWS: AuditRow[] = [
  { time: '09:12', actor: 'compliance@blockxone.local', action: 'Approved', target: 'CASE-1021', detail: 'KYC | risk: Medium | docs verified' },
  { time: '08:55', actor: 'admin@blockxone.local', action: 'Edited rule', target: 'Jurisdiction blocklist', detail: 'Added BY, SY' },
  { time: '08:30', actor: 'compliance@blockxone.local', action: 'Rejected', target: 'CASE-1017', detail: 'Wallet | sanctions match | auto reject' },
  { time: 'Yesterday', actor: 'admin@blockxone.local', action: 'Feature toggle', target: 'Wallet gating', detail: 'Enabled MetaMask required' }
]

export default function ComplianceAudit() {
  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Audit log
          </div>
          <h1 className="text-3xl font-bold">Reviewer actions</h1>
          <p className="text-muted-foreground max-w-2xl">Trace key decisions to keep the route live during demos. Replace with your audit feed later.</p>
        </div>

        <Card className="overflow-hidden bg-white/5 border-white/10">
          <div className="grid grid-cols-5 gap-3 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
            <div>Time</div>
            <div>Actor</div>
            <div>Action</div>
            <div>Target</div>
            <div>Detail</div>
          </div>
          <div className="divide-y divide-white/5">
            {AUDIT_ROWS.map((row, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-3 px-4 py-3 text-sm">
                <div className="text-muted-foreground text-xs">{row.time}</div>
                <div className="font-mono text-xs break-all">{row.actor}</div>
                <div>{row.action}</div>
                <div className="text-xs">{row.target}</div>
                <div className="text-sm text-muted-foreground">{row.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}