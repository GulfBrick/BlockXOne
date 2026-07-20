"use client"

import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

export function Modal({
  open,
  children,
  onClose,
  className
}: {
  open: boolean
  children: React.ReactNode
  onClose: () => void
  className?: string
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div 
          className="fixed inset-0 z-50 grid place-items-center"
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={onClose} 
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              transition: { duration: 0.2, ease: "easeOut" } 
            }}
            exit={{ 
              opacity: 0, 
              scale: 0.98, 
              transition: { duration: 0.12 } 
            }}
            className={cn(
              "relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900 p-6",
              className
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
