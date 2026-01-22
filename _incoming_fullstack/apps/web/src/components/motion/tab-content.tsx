"use client"

import { motion, AnimatePresence } from "framer-motion"

export function TabContent({ 
  activeKey,
  children 
}: { 
  activeKey: string | number
  children: React.ReactNode
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeKey}
        initial={{ opacity: 0, x: 8 }}
        animate={{ 
          opacity: 1, 
          x: 0, 
          transition: { duration: 0.2 } 
        }}
        exit={{ 
          opacity: 0, 
          x: -8, 
          transition: { duration: 0.14 } 
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
