"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export const AnimatedCard = ({ 
  children, 
  className 
}: { 
  children: React.ReactNode
  className?: string
}) => (
  <motion.div
    whileHover={{ 
      y: -2, 
      scale: 1.01, 
      boxShadow: "0 8px 32px rgba(0, 188, 212, 0.15)" 
    }}
    whileTap={{ scale: 0.985 }}
    transition={{ duration: 0.2, ease: "easeOut" }}
    className={cn(
      "rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6",
      className
    )}
  >
    {children}
  </motion.div>
)
