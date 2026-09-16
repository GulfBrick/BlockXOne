import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type WorkspaceAction = {
  href: string
  label: string
}

type WorkspaceMetric = {
  label: string
  value: string
  detail: string
}

type WorkspaceCardItem = {
  title: string
  description: string
  href?: string
  actionLabel?: string
}

type WorkspaceTimelineItem = {
  title: string
  description: string
  meta: string
}

export function WorkspaceFrame({
  children,
  accent = 'blue',
}: {
  children: React.ReactNode
  accent?: 'blue' | 'emerald' | 'amber' | 'violet'
}) {
  // Accent only tints the top hairline now. No radial glow flood.
  const accentClasses = {
    blue: 'bg-bxo-accent-primary',
    emerald: 'bg-emerald-500/40',
    amber: 'bg-amber-500/40',
    violet: 'bg-violet-500/40',
  }

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={cn('absolute inset-x-0 top-0 h-px', accentClasses[accent])} />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,transparent,rgba(1,7,13,0.7))]" />
      </div>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">{children}</div>
    </div>
  )
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  eyebrow: string
  title: string
  description: string
  primaryAction?: WorkspaceAction
  secondaryAction?: WorkspaceAction
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl space-y-4">
        <div className="inline-flex rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-bxo-accent-primary">
          {eyebrow}
        </div>
        <div className="space-y-3">
          <h1 className="font-display text-4xl font-bold tracking-tight text-bxo-text-primary sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-8 text-bxo-text-secondary sm:text-lg">{description}</p>
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-3">
          {primaryAction ? (
            <Button asChild className="bxo-primary-cta h-11 rounded-md px-6 text-bxo-bg-primary">
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button asChild variant="outline" className="bxo-secondary-cta h-11 rounded-md px-6">
              <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function WorkspaceMetricGrid({ metrics }: { metrics: WorkspaceMetric[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label} className="bxo-card rounded-[1.5rem] p-6">
          <div className="text-sm text-bxo-text-tertiary">{metric.label}</div>
          <div className="mt-3 text-3xl font-semibold text-bxo-text-primary">{metric.value}</div>
          <div className="mt-2 text-sm leading-6 text-bxo-text-secondary">{metric.detail}</div>
        </Card>
      ))}
    </div>
  )
}

export function WorkspaceFeatureGrid({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: WorkspaceCardItem[]
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold text-bxo-text-primary">{title}</h2>
        <p className="max-w-3xl text-sm leading-7 text-bxo-text-secondary">{description}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title} className="bxo-card rounded-[1.5rem] p-6">
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-bxo-text-primary">{item.title}</div>
                <div className="mt-2 text-sm leading-7 text-bxo-text-secondary">{item.description}</div>
              </div>
              {item.href && item.actionLabel ? (
                <Link href={item.href} className="inline-flex items-center gap-2 text-sm font-medium text-bxo-accent-primary transition hover:text-bxo-accent-primary-light">
                  {item.actionLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function WorkspaceSplit({
  timelineTitle,
  timelineDescription,
  timelineItems,
  sidebarTitle,
  sidebarDescription,
  sidebarItems,
}: {
  timelineTitle: string
  timelineDescription: string
  timelineItems: WorkspaceTimelineItem[]
  sidebarTitle: string
  sidebarDescription: string
  sidebarItems: WorkspaceCardItem[]
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="bxo-card rounded-[1.75rem] p-7">
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-bxo-text-primary">{timelineTitle}</h2>
            <p className="text-sm leading-7 text-bxo-text-secondary">{timelineDescription}</p>
          </div>
          <div className="space-y-4">
            {timelineItems.map((item, index) => (
              <div key={`${item.title}-${index}`} className="flex gap-4 rounded-2xl border border-bxo-border-subtle bg-bxo-surface px-4 py-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-bxo-accent-border bg-bxo-accent-soft text-sm font-semibold text-bxo-accent-primary">
                  {index + 1}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-bxo-text-primary">{item.title}</div>
                  <div className="text-sm leading-6 text-bxo-text-secondary">{item.description}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-bxo-accent-primary">{item.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="bxo-card rounded-[1.75rem] p-7">
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-bxo-text-primary">{sidebarTitle}</h2>
            <p className="text-sm leading-7 text-bxo-text-secondary">{sidebarDescription}</p>
          </div>
          <div className="space-y-3">
            {sidebarItems.map((item) => (
              <div key={item.title} className="rounded-2xl border border-bxo-border-subtle bg-bxo-surface px-4 py-4">
                <div className="text-sm font-semibold text-bxo-text-primary">{item.title}</div>
                <div className="mt-2 text-sm leading-6 text-bxo-text-secondary">{item.description}</div>
                {item.href && item.actionLabel ? (
                  <Link href={item.href} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-bxo-accent-primary transition hover:text-bxo-accent-primary-light">
                    {item.actionLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </section>
  )
}
