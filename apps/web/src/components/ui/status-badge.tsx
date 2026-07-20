'use client'

import React from 'react'
import { CheckCircle2, AlertCircle, XCircle, Info, Clock } from 'lucide-react'

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'pending' | 'neutral'

export interface StatusBadgeProps {
  variant: StatusVariant
  label: string
  showDot?: boolean
  animated?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const variantConfig = {
  success: {
    bg: 'bg-bxo-success/10',
    text: 'text-bxo-success',
    border: 'border-bxo-success/30',
    icon: CheckCircle2,
  },
  warning: {
    bg: 'bg-bxo-warning/10',
    text: 'text-bxo-warning',
    border: 'border-bxo-warning/30',
    icon: AlertCircle,
  },
  error: {
    bg: 'bg-bxo-danger/10',
    text: 'text-bxo-danger',
    border: 'border-bxo-danger/30',
    icon: XCircle,
  },
  info: {
    bg: 'bg-bxo-info/10',
    text: 'text-bxo-info',
    border: 'border-bxo-info/30',
    icon: Info,
  },
  pending: {
    bg: 'bg-bxo-accent-primary/10',
    text: 'text-bxo-accent-primary',
    border: 'border-bxo-accent-primary/30',
    icon: Clock,
    animated: true,
  },
  neutral: {
    bg: 'bg-bxo-surface-elevated',
    text: 'text-bxo-text-secondary',
    border: 'border-bxo-border-subtle',
    icon: Info,
  },
}

const sizeConfig = {
  sm: {
    container: 'px-2 py-1 gap-1.5',
    text: 'text-xs',
    icon: 'w-3 h-3',
    dot: 'w-1.5 h-1.5',
  },
  md: {
    container: 'px-3 py-1.5 gap-2',
    text: 'text-sm',
    icon: 'w-4 h-4',
    dot: 'w-2 h-2',
  },
  lg: {
    container: 'px-4 py-2 gap-2',
    text: 'text-base',
    icon: 'w-5 h-5',
    dot: 'w-2.5 h-2.5',
  },
}

export function StatusBadge({
  variant,
  label,
  showDot = true,
  animated = variant === 'pending',
  size = 'md',
}: StatusBadgeProps) {
  const config = variantConfig[variant]
  const sizeClass = sizeConfig[size]

  return (
    <div
      className={`inline-flex items-center ${sizeClass.container} rounded-full border ${config.bg} ${config.border} font-medium ${config.text}`}
    >
      {showDot && (
        <div
          className={`flex-shrink-0 rounded-full ${sizeClass.dot} ${
            animated && variant === 'pending' ? 'animate-pulse-subtle' : ''
          }`}
          style={{
            backgroundColor:
              variant === 'success'
                ? 'var(--bxo-success)'
                : variant === 'warning'
                  ? 'var(--bxo-warning)'
                  : variant === 'error'
                    ? 'var(--bxo-danger)'
                    : variant === 'info'
                      ? 'var(--bxo-info)'
                      : variant === 'pending'
                        ? 'var(--bxo-accent-primary)'
                        : 'var(--bxo-text-tertiary)',
          }}
        />
      )}

      <span className={`${sizeClass.text} whitespace-nowrap`}>{label}</span>

      {animated && variant === 'pending' && (
        <div className={`flex-shrink-0 ${sizeClass.icon} animate-spin`}>
          <Clock className={`w-full h-full`} />
        </div>
      )}
    </div>
  )
}

export function StatusBadgeGroup({ badges }: { badges: StatusBadgeProps[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {badges.map((badge, idx) => (
        <StatusBadge key={idx} {...badge} />
      ))}
    </div>
  )
}
