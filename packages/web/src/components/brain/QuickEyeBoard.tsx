import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { focusIfKeyboard } from './brain-ui'
import { CANVAS_TONES, quickEyeBox, quickEyeGeometry, slotPosition, type GameTheme, type QuickEyeView } from '@reeeeecall/shared/lib/brain-games'

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

export function Shape({ id, size, color = '#FFFFFF' }: { id: string; size: number; color?: string }) {
  const radius = id === 'circle' ? '50%' : `${Number(id.split(':')[1] ?? 0)}%`
  return <span className="inline-block" style={{ width: size, height: size, borderRadius: radius, background: color }} aria-hidden="true" />
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
  theme,
  demo,
  maxSize,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
  theme: GameTheme
  /** The how-to-play board: the flash is drawn still, nothing is timed, nothing takes input. */
  demo?: boolean
  maxSize?: number
}) {
  const { t } = useTranslation('brain')
  const frameMs = useFrameInterval()
  const stimRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  // The page around the field (header, chances, prompt, the answer row below) takes ~400px; the
  // field gets what is left, so the answers stay above the fold.
  const size = demo ? Math.min(width, maxSize ?? 260) : Math.max(280, Math.min(width, 520, maxSize ?? window.innerHeight - 420))
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
    if (view.phase !== 'stimulus' || demo) return
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
    if (stimRef.current) stimRef.current.style.opacity = demo && view.phase === 'stimulus' ? '1' : view.phase === 'stimulus' ? stimRef.current.style.opacity : '0'
    if (maskRef.current) maskRef.current.style.opacity = view.phase === 'mask' ? (demo ? '1' : maskRef.current.style.opacity) : '0'
  }, [view.phase, demo])

  // A voided trial reaches 'done' without an answer: there is nothing to reveal.
  const done = view.phase === 'done' && view.pickedCenter !== undefined
  const answering = view.phase === 'answerCenter' || view.phase === 'answerLocation' || done

  // Keyboard: focus follows the question (the buttons it was on unmount between phases), and
  // 1-2 answer the centre, 1-8 the direction (clockwise from up, as drawn).
  const answersRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (demo) return
    if (view.phase === 'answerCenter') focusIfKeyboard(answersRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])'))
    if (view.phase === 'answerLocation') focusIfKeyboard(document.querySelector<HTMLButtonElement>('[data-testid="brain-qe-dir-0"]'))
    if (view.phase !== 'answerCenter' && view.phase !== 'answerLocation') return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1) return
      if (view.phase === 'answerCenter' && n <= 2) onTap(n - 1)
      if (view.phase === 'answerLocation' && n <= 8) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.phase, onTap, demo])

  const glass = { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}` }
  const dirSize = demo ? 34 : 56

  return (
    <div className={`mx-auto flex flex-col items-center select-none ${demo ? 'gap-3' : 'gap-5'}`}>
      <div className="relative rounded-3xl" style={{ width: size, height: size, background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 70%)' }} data-testid={demo ? undefined : 'brain-qe-field'}>
        {/* Faint ring guides: where things can appear, without hinting where they will. */}
        <svg className="absolute inset-0 pointer-events-none" width={size} height={size} aria-hidden="true">
          {geo.radii.map((r, i) => (
            <circle key={i} cx={half} cy={half} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="2 6" />
          ))}
        </svg>
        {/* The centre box, always there: it is what the eyes rest on between trials. */}
        <div
          className={`absolute rounded-xl ${view.phase === 'fixation' ? 'bfx-glow' : ''}`}
          style={{ width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2, border: '2px solid rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', ['--bfx-glow' as string]: theme.glow }}
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
              <span key={i} className="absolute text-white leading-none" style={{ left: p.x - s / 2, top: p.y - s / 2, fontSize: s, width: s, height: s, textAlign: 'center' }}>▲</span>
            )
          })}
          {view.target && (() => {
            const p = place(view.target.ring, view.target.slot)
            const s = stim
            return <span className="absolute text-white leading-none" style={{ left: p.x - s / 2, top: p.y - s / 2, fontSize: s, width: s, height: s, textAlign: 'center' }}>★</span>
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
            const r = R - (demo ? 2 : 4)
            const x = half + r * Math.sin(angle)
            const y = half - r * Math.cos(angle)
            let style: CSSProperties = { ...glass, color: '#fff', borderColor: theme.accent }
            let anim = 'bfx-rise'
            if (done && d === view.correctDirection) { style = { background: CANVAS_TONES.correct, border: `2px solid ${CANVAS_TONES.correct}`, color: '#fff' }; anim = 'bfx-pop' }
            else if (done && d === view.pickedDirection) { style = { background: CANVAS_TONES.wrong, border: `2px solid ${CANVAS_TONES.wrong}`, color: '#fff' }; anim = 'bfx-shake' }
            else if (done) style = { ...glass, color: 'rgba(255,255,255,0.4)' }
            return (
              <button
                key={d}
                type="button"
                disabled={done || demo}
                tabIndex={demo ? -1 : undefined}
                aria-hidden={demo || undefined}
                aria-label={demo ? undefined : t(`quickEye.dir.${d}`)}
                onPointerDown={(e) => { e.preventDefault(); if (!done && !demo) onTap(d) }}
                onClick={(e) => { if (e.detail === 0 && !done && !demo) onTap(d) }}
                className={`absolute rounded-full flex items-center justify-center font-bold ${demo ? 'text-base' : 'text-2xl'} ${done || demo ? 'cursor-default' : 'cursor-pointer hover:bg-white/20 active:scale-90 transition-transform'} ${anim}`}
                style={{ ...style, width: dirSize, height: dirSize, left: x - dirSize / 2, top: y - dirSize / 2 }}
                data-testid={demo ? undefined : `brain-qe-dir-${d}`}
                data-tap={d}
              >
                {arrow}
              </button>
            )
          })}
      </div>

      {/* What was in the centre: two large answers, drawn as the shapes themselves. */}
      {answering && (view.phase === 'answerCenter' || done) && (
        <div ref={answersRef} className={`flex ${demo ? 'gap-2' : 'gap-4'}`} role={demo ? undefined : 'group'}>
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            let style: CSSProperties = glass
            let anim = 'bfx-rise'
            if (done && i === view.correctCenter) { style = { background: 'rgba(34,197,94,0.25)', border: `2px solid ${CANVAS_TONES.correct}`, boxShadow: '0 0 24px rgba(34,197,94,0.45)' }; anim = 'bfx-pop' }
            else if (done && i === view.pickedCenter) { style = { background: 'rgba(239,68,68,0.25)', border: `2px solid ${CANVAS_TONES.wrong}` }; anim = 'bfx-shake' }
            const label = isShape ? t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square') : t(`quickEye.${opt}`)
            return (
              <button
                key={i}
                type="button"
                disabled={view.phase !== 'answerCenter' || demo}
                tabIndex={demo ? -1 : undefined}
                aria-hidden={demo || undefined}
                aria-label={demo ? undefined : label}
                onPointerDown={(e) => { e.preventDefault(); if (view.phase === 'answerCenter' && !demo) onTap(i) }}
                onClick={(e) => { if (e.detail === 0 && view.phase === 'answerCenter' && !demo) onTap(i) }}
                className={`${demo ? 'min-w-14 min-h-14 px-2' : 'min-w-24 min-h-24 px-4'} rounded-2xl flex flex-col items-center justify-center gap-2 ${view.phase === 'answerCenter' && !demo ? 'cursor-pointer hover:bg-white/20 active:scale-95 transition-transform' : 'cursor-default'} ${anim}`}
                style={style}
                data-testid={demo ? undefined : `brain-qe-center-${i}`}
                data-tap={i}
              >
                {isShape ? <Shape id={opt} size={demo ? 30 : 56} /> : <span className={`${demo ? 'text-sm' : 'text-xl'} font-semibold text-white`}>{label}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
