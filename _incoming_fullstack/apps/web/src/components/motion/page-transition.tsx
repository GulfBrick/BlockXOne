"use client"

import { AnimatePresence, motion } from "framer-motion"

export function PageTransition({ 
  children, 
  routeKey 
}: {
  children: React.ReactNode
  routeKey: string
}) {
  const variants = {
    initial: { opacity: 0, y: 12, filter: "blur(4px)" },
    in: { 
      opacity: 1, 
      y: 0, 
      filter: "blur(0px)",
      transition: { duration: 0.45, ease: [0.2, 0, 0, 1] } 
    },
    out: { 
      opacity: 0, 
      y: -8, 
      transition: { duration: 0.16, ease: [0.2, 0, 0, 1] } 
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div 
        key={routeKey} 
        initial="initial" 
        animate="in" 
        exit="out" 
        variants={variants}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
