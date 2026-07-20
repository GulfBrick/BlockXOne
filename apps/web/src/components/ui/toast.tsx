'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  action?: {
    label: string
    onClick: () => void
  }
  duration?: number
  onClose?: () => void
}

interface ToastContextType {
  toasts: ToastMessage[]
  addToast: (
    title: string,
    options?: Partial<Omit<ToastMessage, 'id' | 'title'>>
  ) => string
  removeToast: (id: string) => void
  clearAll: () => void
}

const variantConfig = {
  success: {
    bg: 'bg-bxo-success/10',
    border: 'border-bxo-success/30',
    text: 'text-bxo-success',
    icon: CheckCircle2,
  },
  error: {
    bg: 'bg-bxo-danger/10',
    border: 'border-bxo-danger/30',
    text: 'text-bxo-danger',
    icon: AlertCircle,
  },
  warning: {
    bg: 'bg-bxo-warning/10',
    border: 'border-bxo-warning/30',
    text: 'text-bxo-warning',
    icon: AlertTriangle,
  },
  info: {
    bg: 'bg-bxo-info/10',
    border: 'border-bxo-info/30',
    text: 'text-bxo-info',
    icon: Info,
  },
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback(
    (title: string, options?: Partial<Omit<ToastMessage, 'id' | 'title'>>) => {
      const id = `toast-${Date.now()}-${Math.random()}`
      const duration = options?.duration ?? 5000

      const newToast: ToastMessage = {
        id,
        title,
        variant: 'info',
        ...options,
      }

      setToasts((prev) => {
        const updated = [...prev, newToast]
        // Keep only 3 visible toasts
        if (updated.length > 3) {
          return updated.slice(-3)
        }
        return updated
      })

      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => {
            const toast = prev.find((t) => t.id === id)
            toast?.onClose?.()
            return prev.filter((t) => t.id !== id)
          })
        }, duration)
      }

      return id
    },
    []
  )

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id)
      toast?.onClose?.()
      return prev.filter((t) => t.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    setToasts([])
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearAll }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

interface ToastContainerProps {
  toasts: ToastMessage[]
  onRemove: (id: string) => void
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-tooltip space-y-3 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

interface ToastProps {
  toast: ToastMessage
  onRemove: (id: string) => void
}

function Toast({ toast, onRemove }: ToastProps) {
  const config = variantConfig[toast.variant]
  const Icon = config.icon
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev - (100 / (toast.duration! / 100))
        if (newProgress <= 0) {
          onRemove(toast.id)
          return 0
        }
        return newProgress
      })
    }, 100)

    return () => clearInterval(interval)
  }, [toast.id, toast.duration, onRemove])

  return (
    <div
      className={`${config.bg} ${config.border} border rounded-lg p-4 shadow-lg animate-slide-up pointer-events-auto min-w-80 max-w-md`}
    >
      {/* Content */}
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.text} flex-shrink-0 mt-0.5`} />

        <div className="flex-1 min-w-0">
          <h4 className={`font-semibold text-sm ${config.text}`}>
            {toast.title}
          </h4>
          {toast.description && (
            <p className="text-sm text-bxo-text-secondary mt-1">
              {toast.description}
            </p>
          )}

          {/* Action Button */}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick()
                onRemove(toast.id)
              }}
              className={`text-xs font-semibold mt-2 ${config.text} hover:opacity-80 transition-opacity`}
            >
              {toast.action.label}
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={() => onRemove(toast.id)}
          className={`flex-shrink-0 ${config.text} opacity-60 hover:opacity-100 transition-opacity`}
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Progress Bar */}
      {toast.duration && toast.duration > 0 && (
        <div className="mt-3 h-1 bg-black/10 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-100 ${
              toast.variant === 'success'
                ? 'bg-bxo-success'
                : toast.variant === 'error'
                  ? 'bg-bxo-danger'
                  : toast.variant === 'warning'
                    ? 'bg-bxo-warning'
                    : 'bg-bxo-info'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

/* Convenience hook for common toast scenarios */
export function useToastShortcuts() {
  const { addToast } = useToast()

  return {
    success: (title: string, description?: string) =>
      addToast(title, { variant: 'success', description }),
    error: (title: string, description?: string) =>
      addToast(title, { variant: 'error', description }),
    warning: (title: string, description?: string) =>
      addToast(title, { variant: 'warning', description }),
    info: (title: string, description?: string) =>
      addToast(title, { variant: 'info', description }),
  }
}
