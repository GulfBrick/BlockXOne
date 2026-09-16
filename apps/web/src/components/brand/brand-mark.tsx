import Image from 'next/image'

import { cn } from '@/lib/utils'

type BrandMarkSize = 'sm' | 'md' | 'lg' | 'hero'

const MARK_SIZES: Record<BrandMarkSize, string> = {
  sm: 'h-12 w-12',
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
        className="brand-mark-image object-contain"
        priority={priority}
      />
    </span>
  )
}

interface BrandLockupProps {
  className?: string
  compact?: boolean
  presentation?: 'default' | 'navigation'
  markSize?: Exclude<BrandMarkSize, 'hero'>
  priority?: boolean
  tagline?: string
}

export function BrandLockup({
  className,
  compact = false,
  presentation = 'default',
  markSize = 'md',
  priority = false,
  tagline,
}: BrandLockupProps) {
  if (compact) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <BrandMark size={markSize} priority={priority} />
        <span className="sr-only">BlockXOne</span>
      </span>
    )
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center', className)}>
      <span className="sm:hidden">
        <BrandMark size={markSize} priority={priority} />
        <span className="sr-only">BlockXOne</span>
      </span>
      <span className="hidden min-w-0 sm:block">
        <span
          className={cn(
            'relative block',
            presentation === 'navigation' ? 'h-12 w-[236px]' : 'h-[106px] w-[300px]'
          )}
          aria-hidden="true"
        >
          <Image
            src="/brand/blockxone-lockup-horizontal.png"
            alt=""
            fill
            sizes="300px"
            className="object-contain"
            priority={priority}
          />
        </span>
        {tagline ? (
          <span className="mt-0.5 block text-xs text-bxo-text-tertiary">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  )
}
