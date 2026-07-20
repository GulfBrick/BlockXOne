'use client'

import React, { useState } from 'react'
import { Maximize2, Calendar } from 'lucide-react'

export type TimeRange = '1d' | '7d' | '30d' | '90d' | 'all'

export interface ChartCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  isLoading?: boolean
  timeRange?: TimeRange
  onTimeRangeChange?: (range: TimeRange) => void
  onExpand?: () => void
  expandable?: boolean
  fullWidth?: boolean
  showTimeRangeSelector?: boolean
  height?: 'sm' | 'md' | 'lg'
}

const timeRangeLabels: Record<TimeRange, string> = {
  '1d': '1 Day',
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All Time',
}

const heightClasses = {
  sm: 'h-64',
  md: 'h-80',
  lg: 'h-96',
}

function ChartSkeleton() {
  return (
    <div className="w-full h-full space-y-4 p-6">
      <div className="h-6 w-32 bg-bxo-surface-elevated rounded skeleton" />
      <div className="h-full bg-bxo-surface-elevated rounded skeleton" />
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  children,
  isLoading = false,
  timeRange = '30d',
  onTimeRangeChange,
  onExpand,
  expandable = true,
  fullWidth = true,
  showTimeRangeSelector = true,
  height = 'md',
}: ChartCardProps) {
  const [selectedRange, setSelectedRange] = useState<TimeRange>(timeRange)

  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range)
    onTimeRangeChange?.(range)
  }

  return (
    <div
      className={`bg-bxo-surface border border-bxo-border-subtle rounded-lg overflow-hidden flex flex-col ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-bxo-border-subtle flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-bxo-text-primary">{title}</h3>
          {subtitle && (
            <p className="text-sm text-bxo-text-secondary mt-1">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Time Range Selector */}
          {showTimeRangeSelector && (
            <div className="flex items-center gap-1 bg-bxo-surface-elevated rounded-lg p-1">
              {Object.entries(timeRangeLabels).map(([range, label]) => (
                <button
                  key={range}
                  onClick={() => handleRangeChange(range as TimeRange)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    selectedRange === range
                      ? 'bg-bxo-accent-primary text-white'
                      : 'text-bxo-text-secondary hover:text-bxo-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Expand Button */}
          {expandable && (
            <button
              onClick={onExpand}
              className="p-2 rounded-lg hover:bg-bxo-surface-elevated transition-colors text-bxo-text-secondary hover:text-bxo-text-primary"
              aria-label="Expand chart"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chart Container */}
      <div className={`flex-1 ${heightClasses[height]} relative overflow-hidden`}>
        {isLoading ? (
          <ChartSkeleton />
        ) : (
          <div className="w-full h-full p-6 text-bxo-text-primary">
            {children}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-bxo-border-subtle bg-bxo-surface-elevated/50 flex items-center justify-between text-xs text-bxo-text-secondary">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  )
}

/* Example chart integration with Recharts */
export interface SimpleChartProps {
  data: Array<Record<string, number | string>>
  dataKey: string
  xAxisKey: string
}

export function SimpleLineChart({ data, dataKey, xAxisKey }: SimpleChartProps) {
  void xAxisKey
  if (!data || data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-bxo-text-secondary">No data available</p>
      </div>
    )
  }

  const numericValues = data.map((d) => {
    const value = d[dataKey]
    return typeof value === 'number' ? value : Number(value || 0)
  })

  const maxValue = Math.max(...numericValues)
  const minValue = Math.min(...numericValues)
  const range = maxValue - minValue || 1

  return (
    <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((y) => (
        <line
          key={`grid-${y}`}
          x1="0"
          y1={y}
          x2="100"
          y2={y}
          stroke="var(--bxo-border-subtle)"
          strokeWidth="0.5"
          opacity="0.5"
        />
      ))}

      {/* Data line */}
      <polyline
        points={data
          .map((d, i) => {
            const x = (i / (data.length - 1)) * 100
            const value = typeof d[dataKey] === 'number' ? d[dataKey] : Number(d[dataKey] || 0)
            const y = ((maxValue - value) / range) * 100
            return `${x},${y}`
          })
          .join(' ')}
        fill="none"
        stroke="var(--bxo-accent-primary)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />

      {/* Area fill */}
      <defs>
        <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--bxo-accent-primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--bxo-accent-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,100 ${data
          .map((d, i) => {
            const x = (i / (data.length - 1)) * 100
            const value = typeof d[dataKey] === 'number' ? d[dataKey] : Number(d[dataKey] || 0)
            const y = ((maxValue - value) / range) * 100
            return `${x},${y}`
          })
          .join(' ')} 100,100`}
        fill="url(#chartGradient)"
      />
    </svg>
  )
}
