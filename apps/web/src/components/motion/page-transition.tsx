"use client"

import { AnimatePresence, motion, type Variants } from "framer-motion"

export function PageTransition({ 
  children, 
  routeKey 
}: {
  children: React.ReactNode
  routeKey: string
}) {
  const ease: [number, number, number, number] = [0.2, 0, 0, 1]

  const variants: Variants = {
    initial: { opacity: 1, y: 0, filter: "blur(0px)" },
    in: { 
      opacity: 1, 
      y: 0, 
      filter: "blur(0px)",
      transition: { duration: 0.45, ease } 
    },
    out: { 
      opacity: 0, 
      y: -8, 
      transition: { duration: 0.16, ease } 
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
