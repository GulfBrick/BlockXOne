'use client'

import { useEffect, useRef } from 'react'

export function HexGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const s = 36
    const h = Math.sqrt(3) * s / 2
    const pts: { x: number; y: number }[] = []

    for (let y = 0; y < canvas.height + h; y += h) {
      for (let x = (Math.round(y / h) % 2 ? s : 0); x < canvas.width + s; x += 2 * s) {
        pts.push({ x, y })
      }
    }

    function draw(t: number) {
      if (!ctx || !canvas) return
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = 'rgba(0, 182, 255, 0.15)'
      ctx.lineWidth = 1

      pts.forEach(p => {
        const pulse = 0.5 + 0.5 * Math.sin(t / 600 + (p.x + p.y) * 0.002)
        ctx.beginPath()
        
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i + t / 4000
          const px = p.x + s * 0.9 * Math.cos(a)
          const py = p.y + s * 0.9 * Math.sin(a)
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
        }
        
        ctx.closePath()
        ctx.globalAlpha = 0.1 + 0.3 * pulse
        ctx.stroke()
      })

      requestAnimationFrame(draw)
    }

    requestAnimationFrame(draw)

    return () => window.removeEventListener('resize', resize)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.4 }}
    />
  )
}
