"use client"

import { motion, AnimatePresence } from "framer-motion"

interface AnimatedListProps<T> {
  items: T[]
  render: (item: T, index: number) => React.ReactNode
  keyExtractor?: (item: T) => string
}

export function AnimatedList<T extends { id?: string }>({ 
  items, 
  render,
  keyExtractor = (item) => item.id || String(item)
}: AnimatedListProps<T>) {
  return (
    <ul role="list" className="space-y-3">
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.li
            key={keyExtractor(item)}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ 
              opacity: 1, 
              y: 0, 
              transition: { 
                duration: 0.2, 
                ease: "easeOut",
                delay: index * 0.03
              } 
            }}
            exit={{ 
              opacity: 0, 
              y: -8, 
              transition: { duration: 0.14, ease: "easeIn" } 
            }}
          >
            {render(item, index)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
