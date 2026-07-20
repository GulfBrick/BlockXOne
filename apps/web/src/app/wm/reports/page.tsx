'use client'

import { motion } from 'framer-motion'
import { AnimatedCard } from '@/components/motion/animated-card'
import { Button } from '@/components/ui/button'

const REPORTS = [
  { id: '1', name: 'Monthly Performance Report', period: 'October 2025', generated: '2025-10-15', size: '2.4 MB' },
  { id: '2', name: 'Investor Statement', period: 'Q3 2025', generated: '2025-09-30', size: '1.8 MB' },
  { id: '3', name: 'Tax Document Summary', period: 'YTD 2025', generated: '2025-10-01', size: '856 KB' },
]

export default function WMReportsPage() {
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      
      <div className="container relative mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">Reports</h1>
              <p className="text-muted-foreground">Generate and download fund reports</p>
            </div>
            <Button className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Generate Report
            </Button>
          </div>

          <div className="space-y-4">
            {REPORTS.map((report, index) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <AnimatedCard>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">{report.name}</h3>
                        <p className="text-sm text-muted-foreground">{report.period}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Generated</div>
                        <div className="font-semibold">{report.generated}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Size</div>
                        <div className="font-semibold">{report.size}</div>
                      </div>
                    </div>

                    <Button variant="outline" className="glass-surface hover-elevate press-compress">
                      Download
                    </Button>
                  </div>
                </AnimatedCard>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
