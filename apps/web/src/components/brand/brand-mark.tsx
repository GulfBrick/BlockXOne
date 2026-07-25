import Image from 'next/image'

import { cn } from '@/lib/utils'

type BrandMarkSize = 'sm' | 'md' | 'lg' | 'hero'

const MARK_SIZES: Record<BrandMarkSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-12 w-12',
  lg: 'h-20 w-20',
  hero: 'h-56 w-56 sm:h-64 sm:w-64 lg:h-72 lg:w-72',
}

interface BrandMarkProps {
  alt?: string
  className?: string
  priority?: boolean
  size?: BrandMarkSize
}

export function BrandMark({
  alt = '',
  className,
  priority = false,
  size = 'md',
}: BrandMarkProps) {
  return (
    <span
      className={cn(
        'brand-mark relative inline-flex shrink-0 items-center justify-center overflow-hidden',
        MARK_SIZES[size],
        className
      )}
    >
      <Image
        src="/brand/blockxone-mark.png"
        alt={alt}
        fill
        sizes={size === 'hero' ? '(min-width: 1024px) 288px, (min-width: 640px) 256px, 224px' : '80px'}
        className="brand-mark-image scale-[1.06] object-contain"
        priority={priority}
      />
    </span>
  )
}

interface BrandLockupProps {
  className?: string
  compact?: boolean
  markSize?: Exclude<BrandMarkSize, 'hero'>
  priority?: boolean
  tagline?: string
}

export function BrandLockup({
  className,
  compact = false,
  markSize = 'md',
  priority = false,
  tagline,
}: BrandLockupProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-3', className)}>
      <BrandMark
        size={markSize}
        priority={priority}
        className={cn(!compact && markSize === 'md' && 'max-sm:h-9 max-sm:w-9')}
      />
      <span className="min-w-0">
        <span className="sr-only">BlockXOne</span>
        <span
          className={cn(
            'relative block',
            compact
              ? 'h-5 w-32'
              : 'h-5 w-32 sm:h-7 sm:w-48'
          )}
          aria-hidden="true"
        >
          <Image
            src="/brand/blockxone-wordmark.png"
            alt=""
            fill
            sizes={compact ? '128px' : '192px'}
            className="object-contain object-left"
            priority={priority}
          />
        </span>
        {tagline ? (
          <span className="mt-0.5 hidden text-xs text-bxo-text-tertiary sm:block">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  )
}
