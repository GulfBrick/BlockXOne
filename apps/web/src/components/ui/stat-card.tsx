'use client'

import React, { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

export interface StatCardProps {
  value: number | string
  label: string
  change?: {
    value: number
    isPositive: boolean
  }
  icon?: React.ReactNode
  isLoading?: boolean
  sparklineData?: number[]
  formatValue?: (value: number | string) => string
  trend?: 'up' | 'down' | 'stable'
  trendPeriod?: string
}

function StatCardSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 w-24 bg-bxo-surface-elevated rounded skeleton" />
      <div className="h-4 w-32 bg-bxo-surface-elevated rounded skeleton" />
    </div>
  )
}

function AnimatedNumber({ value, duration = 1000 }: { value: number | string; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    if (typeof value !== 'number') {
      setDisplayValue(0)
      return
    }

    const startTime = Date.now()
    const startValue = 0
    const endValue = value
    const difference = endValue - startValue

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const currentValue = Math.floor(startValue + difference * progress)
      setDisplayValue(currentValue)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration])

  return <>{displayValue.toLocaleString()}</>
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100
      const y = ((max - value) / range) * 100
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg className="w-full h-12" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="var(--bxo-accent-primary)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function StatCard({
  value,
  label,
  change,
  icon,
  isLoading = false,
  sparklineData,
  formatValue,
  trend,
  trendPeriod = 'vs last month',
}: StatCardProps) {
  const displayValue = formatValue ? formatValue(value) : value

  const isPositiveTrend = change?.isPositive ?? trend === 'up'
  const trendColor = isPositiveTrend ? 'text-bxo-success' : 'text-bxo-danger'
  const trendBgColor = isPositiveTrend ? 'bg-bxo-success/10' : 'bg-bxo-danger/10'
  const TrendIcon = isPositiveTrend ? TrendingUp : TrendingDown

  return (
    <div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 hover:border-bxo-accent-primary/30 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <p className="text-bxo-text-secondary text-sm font-medium mb-1">{label}</p>
          {isLoading ? (
            <StatCardSkeleton />
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <h3 className="text-3xl font-bold text-bxo-text-primary">
                  {typeof value === 'number' ? (
                    <AnimatedNumber value={value} />
                  ) : (
                    displayValue
                  )}
                </h3>
              </div>
            </>
          )}
        </div>

        {/* Icon */}
        {icon && (
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-bxo-accent-primary/10 flex items-center justify-center text-bxo-accent-primary">
            {icon}
          </div>
        )}
      </div>

      {/* Change Indicator */}
      {!isLoading && change && (
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${trendBgColor}`}>
          <TrendIcon className={`w-4 h-4 ${trendColor}`} />
          <span className={`text-sm font-semibold ${trendColor}`}>
            {isPositiveTrend ? '+' : '-'}
            {Math.abs(change.value)}%
          </span>
          <span className="text-xs text-bxo-text-secondary">{trendPeriod}</span>
        </div>
      )}

      {/* Sparkline */}
      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-4 pt-4 border-t border-bxo-border-subtle">
          <div className="text-xs text-bxo-text-secondary mb-2">7-day trend</div>
          <Sparkline data={sparklineData} />
        </div>
      )}
    </div>
  )
}
