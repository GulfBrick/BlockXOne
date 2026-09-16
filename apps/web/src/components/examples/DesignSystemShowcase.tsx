'use client'

import React, { useState } from 'react'
import { LayoutDashboard, Wallet, Settings, Users, TrendingUp, AlertCircle } from 'lucide-react'
import { DataTable } from '../ui/data-table'
import { StatCard } from '../ui/stat-card'
import { StatusBadge } from '../ui/status-badge'
import { SidebarNav, type NavItem } from '../ui/sidebar-nav'
import { CommandPalette, type CommandItem } from '../ui/command-palette'
import { ChartCard, SimpleLineChart, type TimeRange } from '../ui/chart-card'
import { useToast } from '../ui/toast'
import type { ColumnDef } from '@tanstack/react-table'

/**
 * Design System Showcase Component
 * Demonstrates all custom BlockXOne UI components with the institutional design system
 */

export function DesignSystemShowcase() {
  const { addToast } = useToast()
  const [selectedChart, setSelectedChart] = useState<TimeRange>('30d')

  // Sample navigation items
  const navItems: NavItem[] = [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      label: 'Funds',
      icon: <Wallet className="w-5 h-5" />,
      children: [
        { label: 'Active Funds', href: '/funds/active', badge: 12 },
        { label: 'Closed Funds', href: '/funds/closed' },
      ],
    },
    {
      label: 'Administration',
      icon: <Settings className="w-5 h-5" />,
      requiredRole: 'admin',
      children: [
        { label: 'Users', href: '/admin/users' },
        { label: 'Roles', href: '/admin/roles' },
      ],
    },
  ]

  // Sample command palette items
  const commandItems: CommandItem[] = [
    {
      id: 'dashboard',
      label: 'Go to Dashboard',
      description: 'View main dashboard',
      category: 'page',
      icon: <LayoutDashboard className="w-4 h-4" />,
      shortcut: '⌘D',
      onSelect: () => addToast('Navigating to Dashboard', { variant: 'info' }),
    },
    {
      id: 'funds',
      label: 'View Funds',
      description: 'Browse all funds',
      category: 'page',
      icon: <Wallet className="w-4 h-4" />,
      onSelect: () => addToast('Navigating to Funds', { variant: 'info' }),
    },
    {
      id: 'export',
      label: 'Export Data',
      description: 'Export current view to CSV',
      category: 'action',
      onSelect: () => addToast('Export started', { variant: 'success' }),
    },
  ]

  // Sample data table data
  const tableData = [
    {
      id: '1',
      name: 'Global Equity Fund',
      aum: '$2.5B',
      return: '12.5%',
      status: 'Active',
    },
    {
      id: '2',
      name: 'Fixed Income Fund',
      aum: '$1.8B',
      return: '5.2%',
      status: 'Active',
    },
    {
      id: '3',
      name: 'Tech Growth Fund',
      aum: '$850M',
      return: '28.3%',
      status: 'Active',
    },
    {
      id: '4',
      name: 'Legacy Fund',
      aum: '$500M',
      return: '3.1%',
      status: 'Closed',
    },
  ]

  type TableRow = (typeof tableData)[number]

  // Chart data
  const chartData = [
    { date: 'Jan', value: 2100 },
    { date: 'Feb', value: 2300 },
    { date: 'Mar', value: 2200 },
    { date: 'Apr', value: 2500 },
    { date: 'May', value: 2400 },
    { date: 'Jun', value: 2800 },
  ]

  const tableColumns: ColumnDef<TableRow>[] = [
    {
      header: 'Fund Name',
      accessorKey: 'name',
    },
    {
      header: 'AUM',
      accessorKey: 'aum',
    },
    {
      header: 'Return YTD',
      accessorKey: 'return',
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info) => (
        <StatusBadge
          variant={String(info.getValue()) === 'Active' ? 'success' : 'neutral'}
          label={String(info.getValue())}
          size="sm"
        />
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      {/* Command Palette */}
      <CommandPalette items={commandItems} />

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 border-r border-bxo-border-subtle">
          <div className="p-6 border-b border-bxo-border-subtle">
            <h1 className="text-2xl font-bold text-bxo-accent-primary">BlockXOne</h1>
            <p className="text-xs text-bxo-text-tertiary mt-1">Design System</p>
          </div>
          <SidebarNav items={navItems} userRole="admin" />
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 space-y-12">
          {/* Header */}
          <div>
            <h1 className="text-4xl font-bold mb-2">Design System Showcase</h1>
            <p className="text-bxo-text-secondary">
              Institutional-grade UI components with Bloomberg-meets-Stripe aesthetic
            </p>
          </div>

          {/* Section: Statistics */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Statistics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                value={125400000}
                label="Assets Under Management"
                change={{ value: 12.5, isPositive: true }}
                icon={<TrendingUp className="w-5 h-5" />}
                sparklineData={[100, 150, 120, 200, 180, 220, 210]}
              />
              <StatCard
                value={47}
                label="Active Funds"
                change={{ value: 3, isPositive: true }}
                icon={<Wallet className="w-5 h-5" />}
              />
              <StatCard
                value={284}
                label="Total Investors"
                change={{ value: 8, isPositive: true }}
                icon={<Users className="w-5 h-5" />}
              />
              <StatCard
                value={9.8}
                label="Avg. Fund Performance"
                change={{ value: 0.5, isPositive: false }}
                icon={<AlertCircle className="w-5 h-5" />}
              />
            </div>
          </section>

          {/* Section: Data Table */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Data Table Component</h2>
            <DataTable
              columns={tableColumns}
              data={tableData}
              defaultPageSize={10}
              density="normal"
              onRowClick={(row) =>
                addToast(`Selected: ${(row as TableRow).name}`, { variant: 'info' })
              }
            />
          </section>

          {/* Section: Status Badges */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Status Badges</h2>
            <div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-bxo-text-secondary min-w-24">Success</span>
                  <StatusBadge variant="success" label="Approved" size="md" />
                  <StatusBadge variant="success" label="Active" size="sm" />
                  <StatusBadge variant="success" label="Completed" size="lg" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-bxo-text-secondary min-w-24">Warning</span>
                  <StatusBadge variant="warning" label="Pending Review" size="md" />
                  <StatusBadge variant="warning" label="Expiring" size="sm" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-bxo-text-secondary min-w-24">Error</span>
                  <StatusBadge variant="error" label="Failed" size="md" />
                  <StatusBadge variant="error" label="Rejected" size="sm" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-bxo-text-secondary min-w-24">Info</span>
                  <StatusBadge variant="info" label="Information" size="md" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-bxo-text-secondary min-w-24">Pending</span>
                  <StatusBadge variant="pending" label="Processing" size="md" animated />
                </div>
              </div>
            </div>
          </section>

          {/* Section: Charts */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Chart Component</h2>
            <ChartCard
              title="Assets Under Management"
              subtitle="Historical trend over time"
              timeRange={selectedChart}
              onTimeRangeChange={(range) => setSelectedChart(range)}
              showTimeRangeSelector
              height="lg"
            >
              <SimpleLineChart
                data={chartData}
                dataKey="value"
                xAxisKey="date"
              />
            </ChartCard>
          </section>

          {/* Section: Color Palette */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Color Palette</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { name: 'Primary', color: 'var(--bxo-bg-primary)' },
                { name: 'Surface', color: 'var(--bxo-surface)' },
                { name: 'Elevated', color: 'var(--bxo-surface-elevated)' },
                { name: 'Accent', color: 'var(--bxo-accent-primary)' },
                { name: 'Success', color: 'var(--bxo-success)' },
                { name: 'Warning', color: 'var(--bxo-warning)' },
                { name: 'Danger', color: 'var(--bxo-danger)' },
                { name: 'Info', color: 'var(--bxo-info)' },
              ].map((item) => (
                <div key={item.name} className="space-y-2">
                  <div
                    className="w-full h-20 rounded-lg border border-bxo-border-subtle"
                    style={{ backgroundColor: item.color }}
                  />
                  <p className="text-xs text-bxo-text-secondary text-center">{item.name}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Typography */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Typography Scale</h2>
            <div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 space-y-3">
              <div className="text-4xl font-bold">Heading 4XL (36px)</div>
              <div className="text-3xl font-bold">Heading 3XL (30px)</div>
              <div className="text-2xl font-bold">Heading 2XL (24px)</div>
              <div className="text-xl font-bold">Heading XL (20px)</div>
              <div className="text-lg font-bold">Heading LG (18px)</div>
              <div className="text-base font-bold">Body Base (16px)</div>
              <div className="text-sm font-bold">Body SM (14px)</div>
              <div className="text-xs font-bold">Body XS (12px)</div>
            </div>
          </section>

          {/* Section: Interactions */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Interactive Components</h2>
            <div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 space-y-3">
              <button
                onClick={() =>
                  addToast('Success! Your action was completed', {
                    variant: 'success',
                    description: 'All changes have been saved',
                  })
                }
                className="px-6 py-2 bg-bxo-accent-primary text-white rounded-lg hover:bg-bxo-accent-primary-dark transition-colors"
              >
                Primary Button
              </button>
              <button
                onClick={() =>
                  addToast('This is a warning message', {
                    variant: 'warning',
                    description: 'Please review before proceeding',
                  })
                }
                className="px-6 py-2 bg-bxo-surface-elevated border border-bxo-border-default text-bxo-text-primary rounded-lg hover:bg-bxo-border-subtle transition-colors"
              >
                Secondary Button
              </button>
              <button
                onClick={() =>
                  addToast('An error occurred during processing', {
                    variant: 'error',
                    description: 'Please try again',
                  })
                }
                className="px-6 py-2 bg-bxo-danger/10 text-bxo-danger rounded-lg hover:bg-bxo-danger/20 transition-colors"
              >
                Danger Button
              </button>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-bxo-border-subtle pt-8 text-center text-sm text-bxo-text-secondary">
            <p>BlockXOne Design System v1.0.0 © 2024</p>
            <p className="mt-2 text-xs text-bxo-text-tertiary">
              Institutional-grade UI with Bloomberg-meets-Stripe aesthetic
            </p>
          </footer>
        </main>
      </div>
    </div>
  )
}
