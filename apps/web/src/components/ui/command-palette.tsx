'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Search, Clock, Zap } from 'lucide-react'

export interface CommandItem {
  id: string
  label: string
  description?: string
  category: 'page' | 'action' | 'setting'
  icon?: React.ReactNode
  shortcut?: string
  onSelect: () => void
}

export interface CommandPaletteProps {
  items: CommandItem[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: string
  recentLimit?: number
}

export function CommandPalette({
  items,
  open = false,
  onOpenChange,
  placeholder = 'Search pages, actions, and settings...',
  recentLimit = 5,
}: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(open)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Open with Cmd+K or Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
        onOpenChange?.(!isOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onOpenChange])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        onOpenChange?.(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onOpenChange])

  const filteredItems = query
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : items.filter((item) => recent.includes(item.id)).slice(0, recentLimit)

  const grouped = filteredItems.reduce(
    (acc, item) => {
      const category = item.category
      if (!acc[category]) acc[category] = []
      acc[category].push(item)
      return acc
    },
    {} as Record<string, CommandItem[]>
  )

  const categoryOrder = ['page', 'action', 'setting']
  const orderedGroups = categoryOrder.filter((cat) => grouped[cat])

  const handleSelect = (item: CommandItem) => {
    item.onSelect()
    setRecent((prev) => {
      const updated = [item.id, ...prev.filter((id) => id !== item.id)]
      return updated.slice(0, recentLimit)
    })
    setIsOpen(false)
    onOpenChange?.(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const allItems: CommandItem[] = []
    orderedGroups.forEach((cat) => {
      allItems.push(...(grouped[cat] || []))
    })

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % allItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const allItems: CommandItem[] = []
      orderedGroups.forEach((cat) => {
        allItems.push(...(grouped[cat] || []))
      })
      if (allItems[selectedIndex]) {
        handleSelect(allItems[selectedIndex])
      }
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true)
          onOpenChange?.(true)
        }}
        className="hidden lg:flex items-center gap-2 px-3 py-2 text-sm text-bxo-text-secondary bg-bxo-surface border border-bxo-border-subtle rounded-lg hover:border-bxo-accent-primary/50 transition-colors w-full max-w-xs mx-auto"
        aria-label="Open command palette"
      >
        <Search className="w-4 h-4" />
        <span>{placeholder}</span>
        <kbd className="ml-auto px-2 py-1 text-xs bg-bxo-surface-elevated rounded font-mono">
          ⌘K
        </kbd>
      </button>
    )
  }

  const allItems: CommandItem[] = []
  orderedGroups.forEach((cat) => {
    allItems.push(...(grouped[cat] || []))
  })

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-bxo-overlay-dark z-40"
        onClick={() => {
          setIsOpen(false)
          onOpenChange?.(false)
        }}
      />

      {/* Dialog */}
      <div
        ref={containerRef}
        className="fixed top-1/4 left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 animate-scale-in"
      >
        <div className="bg-bxo-surface border border-bxo-border-default rounded-xl shadow-xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-bxo-border-subtle">
            <Search className="w-5 h-5 text-bxo-text-secondary flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-bxo-text-primary placeholder-bxo-text-tertiary focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-bxo-text-secondary hover:text-bxo-text-primary"
              >
                ✕
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto">
            {allItems.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-bxo-text-secondary text-sm">No results found</p>
              </div>
            ) : !query ? (
              <div className="p-4 space-y-4">
                {/* Recent */}
                {recent.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-bxo-text-tertiary uppercase tracking-wider px-2 mb-2">
                      Recent
                    </h3>
                    <div className="space-y-1">
                      {recent
                        .slice(0, recentLimit)
                        .map((id) => {
                          const item = items.find((i) => i.id === id)
                          if (!item) return null
                          return (
                            <button
                              key={id}
                              onClick={() => handleSelect(item)}
                              className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bxo-surface-elevated transition-colors text-left"
                            >
                              <Clock className="w-4 h-4 text-bxo-text-tertiary flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-bxo-text-primary truncate">
                                  {item.label}
                                </p>
                              </div>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {orderedGroups.map((category) => (
                  <div key={category}>
                    <h3 className="text-xs font-semibold text-bxo-text-tertiary uppercase tracking-wider px-2 mb-2 capitalize">
                      {category}
                    </h3>
                    <div className="space-y-1">
                      {(grouped[category] || []).map((item) => {
                        const itemIndex = allItems.indexOf(item)
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleSelect(item)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left ${
                              selectedIndex === itemIndex
                                ? 'bg-bxo-accent-primary/20 border border-bxo-accent-primary/30'
                                : 'hover:bg-bxo-surface-elevated'
                            }`}
                          >
                            {item.icon ? (
                              <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
                            ) : (
                              <Zap className="w-4 h-4 text-bxo-text-tertiary flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-bxo-text-primary truncate">
                                {item.label}
                              </p>
                              {item.description && (
                                <p className="text-xs text-bxo-text-tertiary truncate">
                                  {item.description}
                                </p>
                              )}
                            </div>
                            {item.shortcut && (
                              <kbd className="text-xs text-bxo-text-tertiary ml-auto flex-shrink-0">
                                {item.shortcut}
                              </kbd>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-bxo-border-subtle bg-bxo-surface-elevated/50 text-xs text-bxo-text-tertiary">
            <span>↑↓ Navigate</span>
            <span className="text-bxo-border-subtle">•</span>
            <span>Enter Select</span>
            <span className="text-bxo-border-subtle">•</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </>
  )
}
