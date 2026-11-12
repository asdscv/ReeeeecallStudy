import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import type { GameTheme } from '@reeeeecall/shared/lib/brain-games'
import { canvasBackground } from './brain-ui'
import { sfx } from './sfx'

/**
 * The game screen's stage: the game's deep gradient, two slow glows drifting behind it, white
 * type. Dark in light mode too — a game is its own place, and lit tiles read the same either way.
 */
export function GameCanvas({ theme, children, testId }: { theme: GameTheme; children: ReactNode; testId?: string }) {
  return (
    <main
      className="relative min-h-dvh overflow-clip text-white"
      style={{ background: canvasBackground(theme) }}
      // Audio may only start after a gesture; the first touch anywhere unlocks it.
      onPointerDownCapture={() => sfx.unlock()}
      onKeyDownCapture={() => sfx.unlock()}
      data-testid={testId}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="bfx-drift absolute -top-1/4 -left-1/4 w-[70vmax] h-[70vmax] rounded-full opacity-40 blur-3xl" style={{ background: `radial-gradient(circle, ${theme.glow} 0%, transparent 60%)` }} />
        <div className="bfx-drift absolute -bottom-1/3 -right-1/4 w-[60vmax] h-[60vmax] rounded-full opacity-25 blur-3xl" style={{ background: `radial-gradient(circle, ${theme.cardFrom} 0%, transparent 60%)`, animationDelay: '-9s' }} />
      </div>
      <div className="relative">{children}</div>
    </main>
  )
}

/** 3 · 2 · 1 · Go — a breath before the first trial, so it never starts under a moving hand. */
export function Countdown({ onDone, goLabel }: { onDone: () => void; goLabel: string }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(3)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    sfx.countdown(n)
    const t = setTimeout(() => (n > 0 ? setN(n - 1) : done.current()), n > 0 ? (reduced ? 450 : 650) : 450)
    return () => clearTimeout(t)
  }, [n, reduced])
  return (
    <div className="flex items-center justify-center min-h-[50vh]" role="status" aria-live="assertive" data-testid="brain-countdown">
      <span key={n} className="bfx-pop text-8xl font-black tabular-nums drop-shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        {n > 0 ? n : goLabel}
      </span>
    </div>
  )
}

/** A short confetti burst on a canvas — for a personal best and a finished session only. */
export function Confetti({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  // One burst per mount: the parent re-renders every frame while its score counts up, and a new
  // colours array each time must not restart the burst.
  const palette = useRef(colors)
  useEffect(() => {
    const colors = palette.current
    if (reduced) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = (canvas.width = window.innerWidth * dpr)
    const h = (canvas.height = window.innerHeight * dpr)
    const parts = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 15 - 6) * dpr,
      r: (Math.random() * 5 + 4) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }))
    let id = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = now - start
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.vy += 0.38 * dpr
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.globalAlpha = Math.max(0, 1 - t / 2600)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.c
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r)
        ctx.restore()
      }
      if (t < 2700) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full z-50" />
}
