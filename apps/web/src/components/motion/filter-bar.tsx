"use client"

import { motion } from "framer-motion"

const chipVariants = { 
  initial: { y: 6, opacity: 0 }, 
  animate: { y: 0, opacity: 1, transition: { duration: 0.2 } } 
}

export function FilterBar({ 
  filters,
  onFilterClick
}: { 
  filters: string[]
  onFilterClick?: (filter: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter, i) => (
        <motion.button 
          key={filter} 
          variants={chipVariants} 
          initial="initial" 
          animate="animate" 
          transition={{ delay: i * 0.04 }}
          onClick={() => onFilterClick?.(filter)}
          className="rounded-full border border-white/10 px-3 py-1.5 bg-white/5 hover:bg-white/10 transition-colors duration-200 text-sm hover-elevate press-compress focus-ring"
        >
          {filter}
        </motion.button>
      ))}
    </div>
  )
}
