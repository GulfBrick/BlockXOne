'use client'

import React, { useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Menu, X } from 'lucide-react'

export interface NavItem {
  label: string
  href?: string
  icon?: React.ReactNode
  children?: NavItem[]
  requiredRole?: string | string[]
  badge?: string | number
  action?: () => void
}

export interface SidebarNavProps {
  items: NavItem[]
  userRole?: string
  onItemClick?: (item: NavItem) => void
  collapsible?: boolean
  defaultCollapsed?: boolean
  logo?: React.ReactNode
}

export function SidebarNav({
  items,
  userRole = 'user',
  onItemClick,
  logo,
}: SidebarNavProps) {
  const pathname = usePathname()
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  const hasAccess = useCallback(
    (item: NavItem) => {
      if (!item.requiredRole) return true
      const requiredRoles = Array.isArray(item.requiredRole)
        ? item.requiredRole
        : [item.requiredRole]
      return requiredRoles.includes(userRole)
    },
    [userRole]
  )

  const toggleExpanded = (label: string, e: React.MouseEvent) => {
    e.preventDefault()
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(label)) {
      newExpanded.delete(label)
    } else {
      newExpanded.add(label)
    }
    setExpandedItems(newExpanded)
  }

  const isActive = (href?: string) => {
    if (!href) return false
    return pathname === href || pathname.startsWith(href + '/')
  }

  const renderNavItem = (item: NavItem, depth = 0) => {
    if (!hasAccess(item)) return null

    const isExpanded = expandedItems.has(item.label)
    const hasChildren = item.children && item.children.length > 0
    const active = isActive(item.href)
    const indent = depth * 16

    return (
      <div key={item.label}>
        {item.href ? (
          <Link
            href={item.href}
            onClick={() => {
              onItemClick?.(item)
              setIsMobileOpen(false)
            }}
            className={`group relative flex min-h-11 items-center gap-3 rounded-md px-4 py-2 transition-all ${
              active
                ? 'bg-bxo-accent-primary/10 text-bxo-accent-primary border-l-2 border-bxo-accent-primary'
                : 'text-bxo-text-secondary hover:bg-bxo-surface-elevated'
            }`}
            style={{ marginLeft: `${indent}px` }}
          >
            {item.icon && <span className="flex-shrink-0 w-5 h-5">{item.icon}</span>}
            <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
            {item.badge && (
              <span className="flex-shrink-0 px-2 py-1 text-xs font-semibold bg-bxo-accent-primary text-white rounded-md">
                {item.badge}
              </span>
            )}
          </Link>
        ) : (
          <button
            onClick={(e) => {
              toggleExpanded(item.label, e)
              item.action?.()
            }}
            className={`group flex min-h-11 w-full items-center gap-3 rounded-md px-4 py-2 text-left transition-all ${
              isExpanded
                ? 'bg-bxo-surface-elevated text-bxo-accent-primary'
                : 'text-bxo-text-secondary hover:bg-bxo-surface-elevated'
            }`}
            style={{ marginLeft: `${indent}px` }}
          >
            {item.icon && <span className="flex-shrink-0 w-5 h-5">{item.icon}</span>}
            <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
            {hasChildren && (
              <ChevronRight
                className={`flex-shrink-0 w-4 h-4 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
            )}
          </button>
        )}

        {/* Submenu */}
        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {item.children?.map((child) => renderNavItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="fixed left-4 top-4 z-40 flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-bxo-border-subtle bg-bxo-surface text-bxo-text-primary lg:hidden"
        aria-label={isMobileOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isMobileOpen}
        aria-controls="investor-sidebar-navigation"
        type="button"
      >
        {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Backdrop */}
      {isMobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <nav
        id="investor-sidebar-navigation"
        className={`fixed lg:static top-0 left-0 h-[100dvh] lg:h-auto w-64 lg:w-auto bg-bxo-surface border-r border-bxo-border-subtle overflow-y-auto transition-transform duration-300 z-40 lg:z-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        {logo && (
          <div className="p-4 border-b border-bxo-border-subtle sticky top-0 bg-bxo-surface">
            {logo}
          </div>
        )}

        {/* Navigation Items */}
        <div className="p-4 space-y-1">{items.map((item) => renderNavItem(item))}</div>
      </nav>
    </>
  )
}

/* Example usage hook for common navigation structure */
export function useDefaultNavigation(userRole: string = 'user') {
  return [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: <ChevronRight className="w-4 h-4" />,
    },
    {
      label: 'Funds',
      icon: <ChevronRight className="w-4 h-4" />,
      children: [
        { label: 'Active Funds', href: '/funds/active' },
        { label: 'Closed Funds', href: '/funds/closed' },
      ],
    },
    ...(userRole === 'admin'
      ? [
          {
            label: 'Administration',
            icon: <ChevronRight className="w-4 h-4" />,
            children: [
              { label: 'Users', href: '/admin/users' },
              { label: 'Roles', href: '/admin/roles' },
              { label: 'Features', href: '/admin/features' },
            ],
            requiredRole: 'admin',
          },
        ]
      : []),
    {
      label: 'Settings',
      href: '/settings',
      icon: <ChevronRight className="w-4 h-4" />,
    },
  ] as NavItem[]
}
