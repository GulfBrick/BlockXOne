'use client'

import React, { useState, ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Bell, Search, LogOut, Settings } from 'lucide-react'
import { BrandLockup } from '@/components/brand/brand-mark'
import { SidebarNav, type NavItem } from '../ui/sidebar-nav'

export interface DashboardLayoutProps {
  children: ReactNode
  navItems: NavItem[]
  userRole?: string
  currentPath?: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  userName?: string
  userAvatar?: string
  onLogout?: () => void
  notificationCount?: number
  onNotificationClick?: () => void
  showSearch?: boolean
  onSearch?: (query: string) => void
  footerItems?: Array<{ label: string; status: 'operational' | 'degraded' | 'down' }>
}

export function DashboardLayout({
  children,
  navItems,
  userRole = 'user',
  breadcrumbs,
  userName = 'User',
  userAvatar,
  onLogout,
  notificationCount = 0,
  onNotificationClick,
  showSearch = true,
  onSearch,
  footerItems,
}: DashboardLayoutProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  return (
    <div className="flex h-screen bg-bxo-bg-primary overflow-hidden">
      {/* Sidebar */}
      <div className="hidden lg:block w-64 bg-bxo-surface border-r border-bxo-border-subtle flex flex-col">
        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto">
          <SidebarNav
            items={navItems}
            userRole={userRole}
            logo={
              <Link
                href="/"
                aria-label="BlockXOne home"
                className="flex min-h-11 items-center rounded-lg transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
              >
                <BrandLockup compact markSize="sm" priority />
              </Link>
            }
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-bxo-surface border-b border-bxo-border-subtle h-16 flex items-center px-6 gap-4">
          {/* Search Bar */}
          {showSearch && (
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bxo-text-secondary" />
                <input
                  type="text"
                  placeholder="Search..."
                  onChange={(e) => onSearch?.(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-bxo-surface-elevated border border-bxo-border-subtle rounded-lg text-sm text-bxo-text-primary placeholder-bxo-text-tertiary focus:outline-none focus:ring-2 focus:ring-bxo-accent-primary"
                />
              </div>
            </div>
          )}

          <div className="flex-1" />

          {/* Notifications */}
          <button
            onClick={onNotificationClick}
            className="relative p-2 rounded-lg hover:bg-bxo-surface-elevated transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5 text-bxo-text-secondary" />
            {notificationCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-bxo-danger rounded-full animate-pulse" />
            )}
          </button>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bxo-surface-elevated transition-colors"
              aria-label="User menu"
            >
              {userAvatar ? (
                <div
                  aria-label={userName}
                  className="h-6 w-6 rounded-full bg-cover bg-center"
                  role="img"
                  style={{ backgroundImage: `url(${userAvatar})` }}
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bxo-accent-primary text-xs font-bold text-bxo-bg-primary">
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm text-bxo-text-primary hidden sm:inline">
                {userName}
              </span>
            </button>

            {/* Dropdown */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-bxo-surface border border-bxo-border-default rounded-lg shadow-lg z-40 animate-scale-in">
                <div className="px-4 py-3 border-b border-bxo-border-subtle">
                  <p className="text-sm font-semibold text-bxo-text-primary">{userName}</p>
                  <p className="text-xs text-bxo-text-secondary capitalize">{userRole}</p>
                </div>

                <nav className="p-2 space-y-1">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-bxo-text-secondary hover:bg-bxo-surface-elevated hover:text-bxo-text-primary transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                </nav>

                <button
                  onClick={() => {
                    onLogout?.()
                    setUserMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-bxo-danger hover:bg-bxo-danger/10 rounded-md transition-colors border-t border-bxo-border-subtle mt-2 pt-2"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto">
          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="px-6 py-4 border-b border-bxo-border-subtle bg-bxo-surface-elevated/50">
              <nav className="flex items-center gap-2 text-sm">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={`${crumb.label}-${idx}`}>
                    {idx > 0 && <ChevronRight className="w-4 h-4 text-bxo-text-tertiary" />}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="text-bxo-accent-primary hover:underline"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-bxo-text-primary">{crumb.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            </div>
          )}

          {/* Page Content */}
          <div className="p-6">{children}</div>
        </main>

        {/* Footer */}
        {footerItems && footerItems.length > 0 && (
          <footer className="border-t border-bxo-border-subtle bg-bxo-surface-elevated/50 px-6 py-4">
            <div className="flex items-center justify-end gap-6 text-xs">
              <span className="text-bxo-text-tertiary">System Status:</span>
              {footerItems.map((item, idx) => (
                <div key={`${item.label}-${idx}`} className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      item.status === 'operational'
                        ? 'bg-bxo-success'
                        : item.status === 'degraded'
                          ? 'bg-bxo-warning'
                          : 'bg-bxo-danger'
                    }`}
                  />
                  <span className="text-bxo-text-secondary capitalize">{item.label}</span>
                </div>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
