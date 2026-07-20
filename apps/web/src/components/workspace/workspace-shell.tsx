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
  // Accent only tints the top hairline now — no radial glow flood.
  const accentClasses = {
    blue: 'bg-[#3B82F6]/40',
    emerald: 'bg-emerald-500/40',
    amber: 'bg-amber-500/40',
    violet: 'bg-violet-500/40',
  }

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={cn('absolute inset-x-0 top-0 h-px', accentClasses[accent])} />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,transparent,rgba(7,10,18,0.6))]" />
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
        <div className="inline-flex rounded-md border border-[#3B82F6]/25 bg-[#3B82F6]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#60A5FA]">
          {eyebrow}
        </div>
        <div className="space-y-3">
          <h1 className="font-[family:var(--font-display)] text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-8 text-white/62 sm:text-lg">{description}</p>
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-3">
          {primaryAction ? (
            <Button asChild className="h-11 rounded-md bg-[#3B82F6] px-6 text-white hover:bg-[#2563EB]">
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button asChild variant="outline" className="h-11 rounded-md border-white/12 bg-white/5 px-6 text-white hover:bg-white/10">
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
        <Card key={metric.label} className="rounded-[1.5rem] border-white/8 bg-white/[0.04] p-6 shadow-none">
          <div className="text-sm text-white/48">{metric.label}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{metric.value}</div>
          <div className="mt-2 text-sm leading-6 text-white/58">{metric.detail}</div>
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
        <h2 className="font-[family:var(--font-display)] text-2xl font-semibold text-white">{title}</h2>
        <p className="max-w-3xl text-sm leading-7 text-white/58">{description}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title} className="rounded-[1.5rem] border-white/8 bg-[#0D1523] p-6 shadow-none">
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-white">{item.title}</div>
                <div className="mt-2 text-sm leading-7 text-white/58">{item.description}</div>
              </div>
              {item.href && item.actionLabel ? (
                <Link href={item.href} className="inline-flex items-center gap-2 text-sm font-medium text-[#60A5FA] transition hover:text-[#93BBFC]">
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
      <Card className="rounded-[1.75rem] border-white/8 bg-white/[0.04] p-7 shadow-none">
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-[family:var(--font-display)] text-2xl font-semibold text-white">{timelineTitle}</h2>
            <p className="text-sm leading-7 text-white/58">{timelineDescription}</p>
          </div>
          <div className="space-y-4">
            {timelineItems.map((item, index) => (
              <div key={`${item.title}-${index}`} className="flex gap-4 rounded-2xl border border-white/8 bg-[#0B1322]/85 px-4 py-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#3B82F6]/25 bg-[#3B82F6]/10 text-sm font-semibold text-[#60A5FA]">
                  {index + 1}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="text-sm leading-6 text-white/58">{item.description}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-[#60A5FA]/72">{item.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="rounded-[1.75rem] border-white/8 bg-white/[0.04] p-7 shadow-none">
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-[family:var(--font-display)] text-2xl font-semibold text-white">{sidebarTitle}</h2>
            <p className="text-sm leading-7 text-white/58">{sidebarDescription}</p>
          </div>
          <div className="space-y-3">
            {sidebarItems.map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/8 bg-[#0D1523] px-4 py-4">
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-2 text-sm leading-6 text-white/58">{item.description}</div>
                {item.href && item.actionLabel ? (
                  <Link href={item.href} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#60A5FA] transition hover:text-[#93BBFC]">
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
