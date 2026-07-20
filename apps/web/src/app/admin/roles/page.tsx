'use client'

import { Card } from '@/components/ui/card'

type Role = {
  name: string
  description: string
  permissions: string[]
}

const ROLES: Role[] = [
  {
    name: 'Investor',
    description: 'Can browse funds, subscribe, redeem, and view portfolio.',
    permissions: ['View funds', 'Create KYC case', 'Subscribe via MetaMask']
  },
  {
    name: 'ComplianceOfficer',
    description: 'Reviews KYC and wallet approvals; manages rules.',
    permissions: ['View compliance queue', 'Approve / reject cases', 'Edit rules']
  },
  {
    name: 'OfferingManager',
    description: 'Creates funds and manages orders.',
    permissions: ['Create fund', 'Manage orders', 'Link treasury wallet']
  },
  {
    name: 'SuperAdmin',
    description: 'Full control for demos and feature toggles.',
    permissions: ['Access admin control center', 'Impersonate roles', 'Toggle features']
  }
]

export default function AdminRoles() {
  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Roles
          </div>
          <h1 className="text-3xl font-bold">Role overview</h1>
          <p className="text-muted-foreground max-w-2xl">Reference matrix so this route is no longer a 404. Wire to your RBAC backend as needed.</p>
        </div>

        <div className="space-y-4">
          {ROLES.map((role) => (
            <Card key={role.name} className="p-5 bg-white/5 border-white/10">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="text-lg font-semibold">{role.name}</div>
                </div>
                <div className="text-sm text-muted-foreground">{role.description}</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {role.permissions.map((p) => (
                    <span key={p} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}