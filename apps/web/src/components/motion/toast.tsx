"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export function Toast({ 
  children, 
  className 
}: { 
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div 
      initial={{ y: 16, opacity: 0 }} 
      animate={{ 
        y: 0, 
        opacity: 1, 
        transition: { duration: 0.18 } 
      }} 
      exit={{ 
        y: 16, 
        opacity: 0, 
        transition: { duration: 0.12 } 
      }}
      className={cn(
        "rounded-xl border border-white/10 bg-neutral-900 p-4 shadow-xl",
        className
      )}
    >
      {children}
    </motion.div>
  )
}
