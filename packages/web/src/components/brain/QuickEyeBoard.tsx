import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { quickEyeBox, quickEyeGeometry, slotPosition, type QuickEyeView } from '@reeeeecall/shared/lib/brain-games'

/**
 * Quick Eye on the web.
 *
 * The exposure is counted in display frames with requestAnimationFrame and applied by writing the
 * stimulus layer's opacity directly — never by a React re-render, whose timing is not a frame's,
 * and never with setTimeout. The stimulus is drawn before the trial starts and only its opacity
 * changes, so nothing is laid out or decoded at the moment it appears. What was really on screen
 * (from the frame timestamps) goes back to the engine, which voids the trial if it is off.
 */
const DIR_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

export function Shape({ id, size, className }: { id: string; size: number; className?: string }) {
  const radius = id === 'circle' ? '50%' : `${Number(id.split(':')[1] ?? 0)}%`
  return <span className={`inline-block bg-foreground ${className ?? ''}`} style={{ width: size, height: size, borderRadius: radius }} aria-hidden="true" />
}

/** Median of recent frame intervals, measured continuously so a refresh-rate change is followed. */
function useFrameInterval() {
  const ref = useRef(1000 / 60)
  useEffect(() => {
    const deltas: number[] = []
    let last = 0
    let id = requestAnimationFrame(function tick(ts) {
      if (last) {
        deltas.push(ts - last)
        if (deltas.length > 20) deltas.shift()
        const sorted = deltas.slice().sort((a, b) => a - b)
        ref.current = sorted[sorted.length >> 1]
      }
      last = ts
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [])
  return ref
}

export function QuickEyeBoard({
  view,
  onTap,
  onExposure,
  width,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
}) {
  const { t } = useTranslation('brain')
  const frameMs = useFrameInterval()
  const stimRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  // The page around the field (header, chances, prompt, the answer row below) takes ~400px; the
  // field gets what is left, so the answers stay above the fold.
  const size = Math.max(280, Math.min(width, 520, window.innerHeight - 400))
  const { boxW, boxH, shape } = quickEyeBox(size, view.center.length === 2)
  const half = size / 2
  // Ring radii and one stimulus size for every ring, laid out so nothing overlaps the box or a
  // neighbouring ring (shared with the app — see quick-eye-geometry.ts).
  const geo = useMemo(() => quickEyeGeometry(size, boxW, boxH, view.ringSlots), [size, boxW, boxH, view.ringSlots])
  const R = geo.R
  const stim = geo.stim
  const place = (ring: number, slot: number) => {
    const p = slotPosition(geo.radii[ring], slot, view.ringSlots[ring])
    return { x: half + p.x, y: half + p.y }
  }

  // The mask: random grey squares between ~40% and ~60% luminance — low contrast, no regular
  // pattern (striped or checked masks can trigger pattern sensitivity even at matched luminance).
  useEffect(() => {
    const canvas = maskRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const cell = 14
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const g = Math.round(102 + Math.random() * 51)
        ctx.fillStyle = `rgb(${g},${g},${g})`
        ctx.fillRect(x, y, cell, cell)
      }
    }
  }, [size, view.center, view.target])

  // The exposure itself.
  useEffect(() => {
    if (view.phase !== 'stimulus') return
    const stim = stimRef.current
    const mask = maskRef.current
    if (!stim || !mask) return
    let start = 0
    let id = requestAnimationFrame(function tick(ts) {
      const frame = frameMs.current
      if (!start) {
        start = ts
        stim.style.opacity = '1'
      } else if (Math.round((ts - start) / frame) >= Math.max(1, Math.round(view.exposureMs / frame))) {
        // Frames counted exactly as the engine checks them (round(ms / frame)) — a "half a frame
        // early" threshold disagreed with that rounding at 90Hz and voided half the 50ms trials.
        stim.style.opacity = '0'
        mask.style.opacity = '1'
        onExposure(ts - start, frame)
        return
      }
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
    // One exposure per stimulus phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase])

  // The frame loop writes these opacities directly; whenever the phase that owns them is over, put
  // them back (a voided trial jumps from the stimulus straight to 'done' and React would not).
  useEffect(() => {
    if (view.phase !== 'stimulus' && stimRef.current) stimRef.current.style.opacity = '0'
    if (view.phase !== 'mask' && maskRef.current) maskRef.current.style.opacity = '0'
  }, [view.phase])

  // A voided trial reaches 'done' without an answer: there is nothing to reveal.
  const done = view.phase === 'done' && view.pickedCenter !== undefined
  const answering = view.phase === 'answerCenter' || view.phase === 'answerLocation' || done

  // Keyboard: focus follows the question (the buttons it was on unmount between phases), and
  // 1-2 answer the centre, 1-8 the direction (clockwise from up, as drawn).
  const answersRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view.phase === 'answerCenter') answersRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true })
    if (view.phase === 'answerLocation') document.querySelector<HTMLButtonElement>('[data-testid="brain-qe-dir-0"]')?.focus({ preventScroll: true })
    if (view.phase !== 'answerCenter' && view.phase !== 'answerLocation') return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1) return
      if (view.phase === 'answerCenter' && n <= 2) onTap(n - 1)
      if (view.phase === 'answerLocation' && n <= 8) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.phase, onTap])

  return (
    <div className="mx-auto flex flex-col items-center gap-5 select-none">
      <div className="relative" style={{ width: size, height: size }} data-testid="brain-qe-field">
        {/* The centre box, always there: it is what the eyes rest on between trials. */}
        <div
          className="absolute rounded-xl border-2 border-foreground/80 bg-muted"
          style={{ width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }}
        />
        {/* Stimulus layer — drawn now, shown only by the frame loop above. */}
        <div ref={stimRef} className="absolute inset-0" style={{ opacity: 0 }} aria-hidden="true">
          <div className="absolute flex items-center justify-center gap-2" style={{ width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }}>
            {view.center.map((id, i) => (
              <Shape key={i} id={id} size={shape} />
            ))}
          </div>
          {view.distractors.map((d, i) => {
            const p = place(d.ring, d.slot)
            const s = stim
            return (
              <span key={i} className="absolute text-foreground leading-none" style={{ left: p.x - s / 2, top: p.y - s / 2, fontSize: s, width: s, height: s, textAlign: 'center' }}>▲</span>
            )
          })}
          {view.target && (() => {
            const p = place(view.target.ring, view.target.slot)
            const s = stim
            return <span className="absolute text-foreground leading-none" style={{ left: p.x - s / 2, top: p.y - s / 2, fontSize: s, width: s, height: s, textAlign: 'center' }}>★</span>
          })()}
        </div>
        <canvas
          ref={maskRef}
          width={size}
          height={size}
          className="absolute inset-0 rounded-xl"
          style={{ opacity: view.phase === 'mask' ? 1 : 0, pointerEvents: 'none' }}
          aria-hidden="true"
        />
        {/* Where was the star: eight big targets around the field. */}
        {view.asksLocation && (view.phase === 'answerLocation' || done) &&
          DIR_ARROWS.map((arrow, d) => {
            const angle = (d / 8) * 2 * Math.PI
            const r = R - 4
            const x = half + r * Math.sin(angle)
            const y = half - r * Math.cos(angle)
            let tone = 'bg-card border-2 border-brand text-brand-active hover:bg-brand/10'
            if (done && d === view.correctDirection) tone = 'bg-success border-2 border-success text-success-foreground'
            else if (done && d === view.pickedDirection) tone = 'bg-destructive border-2 border-destructive text-destructive-foreground'
            else if (done) tone = 'bg-card border-2 border-border text-muted-foreground'
            return (
              <button
                key={d}
                type="button"
                disabled={done}
                aria-label={t(`quickEye.dir.${d}`)}
                onPointerDown={(e) => { e.preventDefault(); if (!done) onTap(d) }}
                onClick={(e) => { if (e.detail === 0 && !done) onTap(d) }}
                className={`absolute rounded-full flex items-center justify-center text-2xl font-bold cursor-pointer disabled:cursor-default ${tone}`}
                style={{ width: 56, height: 56, left: x - 28, top: y - 28 }}
                data-testid={`brain-qe-dir-${d}`}
              >
                {arrow}
              </button>
            )
          })}
      </div>

      {/* What was in the centre: two large answers, drawn as the shapes themselves. */}
      {answering && (view.phase === 'answerCenter' || done) && (
        <div ref={answersRef} className="flex gap-4" role="group">
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            let tone = 'bg-card border-2 border-border hover:border-brand'
            if (done && i === view.correctCenter) tone = 'bg-success/15 border-2 border-success'
            else if (done && i === view.pickedCenter) tone = 'bg-destructive/15 border-2 border-destructive'
            const label = isShape ? t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square') : t(`quickEye.${opt}`)
            return (
              <button
                key={i}
                type="button"
                disabled={view.phase !== 'answerCenter'}
                aria-label={label}
                onPointerDown={(e) => { e.preventDefault(); if (view.phase === 'answerCenter') onTap(i) }}
                onClick={(e) => { if (e.detail === 0 && view.phase === 'answerCenter') onTap(i) }}
                className={`min-w-24 min-h-24 px-4 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer disabled:cursor-default ${tone}`}
                data-testid={`brain-qe-center-${i}`}
              >
                {isShape ? <Shape id={opt} size={56} /> : <span className="text-xl font-semibold text-foreground">{label}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
