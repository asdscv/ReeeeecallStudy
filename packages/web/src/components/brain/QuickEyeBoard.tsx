import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { ArrowUp, Check } from 'lucide-react'
import { focusIfKeyboard } from './brain-ui'
import { CenterShape, CenterShapeIcon, Star, Triangle } from './QeShapes'
import {
  CANVAS_TONES,
  QE_FIELD_TINT,
  QE_INK,
  QE_REVEAL_ART,
  QE_WARM,
  QUICK_EYE_BOX_RADIUS,
  quickEyeBox,
  quickEyeGeometry,
  quickEyeInkFraction,
  quickEyeMaskCells,
  quickEyeMaskMean,
  quickEyeMaskTones,
  randomSeed,
  slotPosition,
  type QuickEyeView,
} from '@reeeeecall/shared/lib/brain-games'

/**
 * Quick Eye on the web.
 *
 * The exposure is counted in display frames with requestAnimationFrame and applied by writing the
 * stimulus layer's opacity directly — never by a React re-render, whose timing is not a frame's,
 * and never with setTimeout. The stimulus is drawn before the trial starts and only its opacity
 * changes, so nothing is laid out or decoded at the moment it appears. What was really on screen
 * (from the frame timestamps) goes back to the engine, which voids the trial if it is off.
 *
 * The measuring frame follows the protocol's display (quick-eye-art.ts): a mid-grey field in the
 * stage group's hue, one light ink for every shape, the centre box in the field's tone with an ink
 * border, and a backward mask laid only on the field whose mean luminance matches the frame it
 * covers. After the answer a separate reveal layer — never the stimulus layer — fades the scene
 * back in: the target circled, a wrong pick dimmed, the centre glowing when it was right.
 */

/** The field's corner radius (rounded-3xl); the mask is clipped to it. */
const FIELD_RADIUS = 24
/** Mask cell, px — corners rounded 30%, so the cover reads as fog, never as a grid. */
const MASK_CELL = 14
const DIR_STEP = Math.PI / 4
/** Taps this close to the box, or this far past the outer ring, pick no direction (a slip, not an answer). */
const BOX_CLEAR = 8
const RING_REACH = 28
/** The reveal's dimmed pick: the frame's dark ink. */
const DIM = '#1C1A17'

/** A point at radius `r`, angle `a` (clockwise from 12 o'clock) around (c, c). */
function polar(c: number, r: number, a: number): string {
  return `${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`
}

/** Direction `d`'s slice of the field — 45° wide, from radius r0 to r1 — as an SVG path. */
function sectorPath(c: number, r0: number, r1: number, d: number): string {
  const a0 = (d - 0.5) * DIR_STEP
  const a1 = (d + 0.5) * DIR_STEP
  return `M${polar(c, r0, a0)} L${polar(c, r1, a0)} A${r1},${r1} 0 0 1 ${polar(c, r1, a1)} L${polar(c, r0, a1)} A${r0},${r0} 0 0 0 ${polar(c, r0, a0)} Z`
}

/** The arc at radius `r` from direction `from` to its neighbour `to` — the near miss's "right next to it". */
function arcPath(c: number, r: number, from: number, to: number): string {
  const clockwise = (to - from + 8) % 8 === 1
  return `M${polar(c, r, from * DIR_STEP)} A${r},${r} 0 0 ${clockwise ? 1 : 0} ${polar(c, r, to * DIR_STEP)}`
}

/** Adds a rounded rectangle to the canvas path (arcTo: roundRect is not in every browser yet). */
function addRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** The centre shapes' x: one in the middle, or two side by side 8px apart (same/different). */
function centreXs(count: number, mid: number, shape: number): number[] {
  return count === 2 ? [mid - shape / 2 - 4, mid + shape / 2 + 4] : [mid]
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
  demo,
  maxSize,
  ready,
  onSkip,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
  /** The how-to-play board: the flash is drawn still, nothing is timed, nothing takes input. */
  demo?: boolean
  maxSize?: number
  /** The fixation is running (not held under a card, a stage-up or a pause): the ready ring closes in on the box. */
  ready?: boolean
  /** The reveal is up: on to the next trial now (the round takes it from 500ms after the answer). */
  onSkip?: () => void
}) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const frameMs = useFrameInterval()
  const stimRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const revealRef = useRef<HTMLDivElement>(null)
  const [dpr] = useState(() => Math.min(2, window.devicePixelRatio || 1))
  // The page around the field (header with its gauge, the leg bar, prompt, the answer row below)
  // takes ~440px; the field gets what is left, so the answers stay above the fold.
  const size = demo ? Math.min(width, maxSize ?? 260) : Math.max(280, Math.min(width, 520, maxSize ?? window.innerHeight - 440))
  const { boxW, boxH, shape } = quickEyeBox(size, view.center.length === 2)
  const half = size / 2
  const { center, target, distractors, ringSlots } = view
  // Ring radii and one stimulus size for every ring, laid out so nothing overlaps the box or a
  // neighbouring ring (shared with the app — see quick-eye-geometry.ts).
  const geo = useMemo(() => quickEyeGeometry(size, boxW, boxH, ringSlots), [size, boxW, boxH, ringSlots])
  const R = geo.R
  const stim = geo.stim
  const tint = QE_FIELD_TINT[view.place]
  const at = (ring: number, slot: number) => {
    const p = slotPosition(geo.radii[ring], slot, ringSlots[ring])
    return { x: half + p.x, y: half + p.y }
  }
  // Direction slices start clear of the box and reach just past the outer ring.
  const sectorIn = Math.max(boxW, boxH) / 2 + BOX_CLEAR
  const sectorOut = R + RING_REACH

  // The stimulus, drawn once per trial: React leaves this subtree alone when the phase changes, so
  // the frame that shows it does no layout work.
  const stimArt = useMemo(() => {
    const pos = (ring: number, slot: number) => {
      const p = slotPosition(geo.radii[ring], slot, ringSlots[ring])
      return { x: half + p.x, y: half + p.y }
    }
    const xs = centreXs(center.length, half, shape)
    return (
      <svg width={size} height={size} className="absolute inset-0" aria-hidden="true">
        {center.map((id, i) => (
          <CenterShape key={i} id={id} x={xs[i]} y={half} d={shape} />
        ))}
        {distractors.map((d, i) => {
          const p = pos(d.ring, d.slot)
          return <Triangle key={i} x={p.x} y={p.y} r={geo.stim / 2} />
        })}
        {target && (() => {
          const p = pos(target.ring, target.slot)
          return <Star x={p.x} y={p.y} r={geo.stim / 2} />
        })()}
      </svg>
    )
  }, [size, half, shape, geo, ringSlots, center, distractors, target])

  // The mask: the stimulus frame's mean tone (field plus ink), under rounded cells of six tones at
  // Michelson 0.40 in equal shares, in a fresh random order every trial — clipped to the field, so
  // the field's brightness does not jump when it comes on and no afterimage of the flash survives.
  useEffect(() => {
    const canvas = maskRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const fieldArea = size * size - (4 - Math.PI) * FIELD_RADIUS * FIELD_RADIUS
    const ink = quickEyeInkFraction({ center, target, distractors }, { stim, boxW, boxH, shape }, fieldArea)
    const tones = quickEyeMaskTones(ink, tint)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    addRoundedRect(ctx, 0, 0, size, size, FIELD_RADIUS)
    ctx.clip()
    ctx.fillStyle = quickEyeMaskMean(ink, tint)
    ctx.fillRect(0, 0, size, size)
    // One path per tone: six fills rather than one per cell.
    const byTone = new Map<string, { x: number; y: number }[]>()
    for (const c of quickEyeMaskCells(randomSeed(), Math.ceil(size / MASK_CELL), tones)) {
      const list = byTone.get(c.tone) ?? []
      list.push(c)
      byTone.set(c.tone, list)
    }
    for (const [tone, cells] of byTone) {
      ctx.fillStyle = tone
      ctx.beginPath()
      for (const c of cells) addRoundedRect(ctx, c.x * MASK_CELL, c.y * MASK_CELL, MASK_CELL, MASK_CELL, MASK_CELL * 0.3)
      ctx.fill()
    }
    ctx.restore()
  }, [size, dpr, tint, stim, boxW, boxH, shape, center, target, distractors])

  // The exposure itself.
  useEffect(() => {
    if (view.phase !== 'stimulus' || demo) return
    const stim = stimRef.current
    const mask = maskRef.current
    if (!stim || !mask) return
    // Nothing may ease the flash in or out: the frame count is the exposure.
    stim.style.transition = 'none'
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

  // The ready ring: as the fixation starts running it closes in on the box (1.4× → 1×, fading in to
  // 0.6 over 350ms) and rests on the border for the last 150ms. Opacity only under reduced motion.
  // Gone before the flash — it ends on the box border, so nothing visible changes then.
  const ringOn = (ready ?? (demo === true && view.phase === 'fixation')) && view.phase === 'fixation'
  useLayoutEffect(() => {
    const ring = ringRef.current
    if (!ring) return
    if (!ringOn) {
      ring.style.opacity = '0'
      return
    }
    if (typeof ring.animate !== 'function') {
      ring.style.opacity = '0.6'
      return
    }
    const frames = reduced ? [{ opacity: 0 }, { opacity: 0.6 }] : [{ opacity: 0, transform: 'scale(1.4)' }, { opacity: 0.6, transform: 'scale(1)' }]
    const anim = ring.animate(frames, { duration: 350, easing: 'ease-out', fill: 'forwards' })
    return () => anim.cancel()
  }, [ringOn, reduced])

  // A voided trial reaches 'done' without an answer: there is nothing to reveal.
  const revealing = view.phase === 'done' && !view.void && view.pickedCenter !== undefined
  const locating = view.phase === 'answerLocation'
  const previewDirs = view.phase === 'answerCenter'

  // The reveal fades in (250ms; at once under reduced motion). The stimulus layer is never reused.
  useLayoutEffect(() => {
    const el = revealRef.current
    if (!revealing || !el || reduced || typeof el.animate !== 'function') return
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' })
    return () => anim.cancel()
  }, [revealing, reduced])

  // Keyboard: focus follows the question (the buttons it was on unmount between phases); 1-2
  // answer the centre, 1-8 the direction (clockwise from up, as drawn); Space / Enter move on from
  // the reveal.
  const answersRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (demo) return
    if (view.phase === 'answerCenter') focusIfKeyboard(answersRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])'))
    if (view.phase === 'answerLocation') focusIfKeyboard(fieldRef.current?.querySelector<HTMLButtonElement>('[data-testid="brain-qe-dir-0"]'))
    if (view.phase !== 'answerCenter' && view.phase !== 'answerLocation' && !revealing) return
    const onKey = (e: KeyboardEvent) => {
      if (revealing) {
        if (e.key !== ' ' && e.key !== 'Enter') return
        // A focused control (the header's stop button) keeps its own Enter.
        if (e.target instanceof HTMLElement && e.target.closest('button:not([disabled]), a[href], input, textarea, select')) return
        e.preventDefault()
        onSkip?.()
        return
      }
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1) return
      if (view.phase === 'answerCenter' && n <= 2) onTap(n - 1)
      if (view.phase === 'answerLocation' && n <= 8) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.phase, revealing, onTap, onSkip, demo])

  // Where was the star: the whole field answers, in eight 45° slices around the box — the arrow
  // buttons and keys 1-8 too. The box itself and the corners past the outer ring do not.
  const [hover, setHover] = useState<number | null>(null)
  const dirAt = (e: ReactPointerEvent<HTMLDivElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - box.left - half
    const dy = e.clientY - box.top - half
    const dist = Math.hypot(dx, dy)
    if (dist < sectorIn || dist > sectorOut) return null
    return ((Math.round(Math.atan2(dx, -dy) / DIR_STEP) % 8) + 8) % 8
  }
  const onFieldDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (demo || !locating || (e.target as HTMLElement).closest('button')) return
    const d = dirAt(e)
    if (d === null) return
    e.preventDefault()
    onTap(d)
  }
  const onFieldMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (demo || !locating || e.pointerType !== 'mouse') return
    const d = dirAt(e)
    if (d !== hover) setHover(d)
  }

  const glass = { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}` }
  const dirSize = demo ? 34 : 56
  const xs = centreXs(center.length, half, shape)
  const boxLeft = half - boxW / 2
  const boxTop = half - boxH / 2

  // The reveal: what was right, and what was picked.
  const art = QE_REVEAL_ART[view.place]
  const centreOk = revealing && view.pickedCenter === view.correctCenter
  const correctDir = view.correctDirection
  const pickedDir = view.pickedDirection
  const locOk = correctDir !== undefined && pickedDir === correctDir
  const optionLabel = (opt: string) => (opt === 'same' || opt === 'different' ? t(`quickEye.${opt}`) : t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square'))
  const rightOption = view.correctCenter !== undefined ? view.centerOptions[view.correctCenter] : undefined
  const revealLabel = !revealing || rightOption === undefined
    ? undefined
    : correctDir !== undefined
      ? t('quickEye.revealA11y', { center: optionLabel(rightOption), dir: t(`quickEye.dir.${correctDir}`) })
      : optionLabel(rightOption)
  const targetAt = target ? at(target.ring, target.slot) : null
  // «It was here»: beside a missed star — outward from the inner ring (the box is on its other side),
  // inward from the others (the field's edge is) — and kept on the field.
  const hereAt = targetAt && target && !locOk
    ? (() => {
        const dx = targetAt.x - half
        const dy = targetAt.y - half
        const len = Math.hypot(dx, dy) || 1
        const off = (target.ring === 0 ? 1 : -1) * (stim / 2 + 16)
        return { x: Math.max(48, Math.min(size - 48, targetAt.x + (dx / len) * off)), y: Math.max(16, Math.min(size - 16, targetAt.y + (dy / len) * off)) }
      })()
    : null

  return (
    <div
      className={`mx-auto flex flex-col items-center select-none ${demo ? 'gap-3' : 'gap-5'}`}
      // The reveal moves on with a tap anywhere on the board (the round ignores it for 500ms).
      onPointerDown={revealing && !demo ? () => onSkip?.() : undefined}
    >
      <div
        ref={fieldRef}
        className="relative overflow-hidden"
        style={{ width: size, height: size, borderRadius: FIELD_RADIUS, background: tint, cursor: !demo && (locating || revealing) ? 'pointer' : undefined, touchAction: 'manipulation' }}
        onPointerDown={onFieldDown}
        onPointerMove={onFieldMove}
        onPointerLeave={() => setHover(null)}
        data-testid={demo ? undefined : 'brain-qe-field'}
      >
        {/* Faint ring guides: where things can appear, without hinting where they will. */}
        <svg className="absolute inset-0 pointer-events-none" width={size} height={size} aria-hidden="true">
          {geo.radii.map((r, i) => (
            <circle key={i} cx={half} cy={half} r={r} fill="none" stroke={QE_INK} strokeOpacity={0.12} strokeWidth={1} strokeDasharray="2 6" />
          ))}
          {/* A mouse over the field shows the slice a click would pick. */}
          {locating && hover !== null && <path d={sectorPath(half, sectorIn, sectorOut, hover)} fill={QE_INK} fillOpacity={0.14} />}
        </svg>
        {/* The centre box, always there: it is what the eyes rest on between trials. */}
        <div
          className="absolute pointer-events-none"
          style={{ width: boxW, height: boxH, left: boxLeft, top: boxTop, borderRadius: QUICK_EYE_BOX_RADIUS, border: `2px solid ${QE_INK}`, background: tint }}
        />
        <div
          ref={ringRef}
          className="absolute pointer-events-none"
          style={{ width: boxW, height: boxH, left: boxLeft, top: boxTop, borderRadius: QUICK_EYE_BOX_RADIUS, border: `2px solid ${QE_INK}`, opacity: 0 }}
          aria-hidden="true"
        />
        {/* Stimulus layer — drawn now, shown only by the frame loop above. */}
        <div ref={stimRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0, transition: 'none' }} aria-hidden="true">
          {stimArt}
        </div>
        <canvas
          ref={maskRef}
          width={Math.round(size * dpr)}
          height={Math.round(size * dpr)}
          className="absolute inset-0"
          style={{ width: size, height: size, borderRadius: FIELD_RADIUS, opacity: view.phase === 'mask' ? 1 : 0, pointerEvents: 'none' }}
          aria-hidden="true"
        />
        {/* The reveal layer: only after an answer, never on a voided trial. */}
        {revealing && (
          <div ref={revealRef} className="absolute inset-0 pointer-events-none" role="img" aria-label={revealLabel} data-testid={demo ? undefined : 'brain-qe-reveal'}>
            <svg width={size} height={size} className="absolute inset-0" aria-hidden="true">
              {correctDir !== undefined && <path d={sectorPath(half, sectorIn, sectorOut, correctDir)} fill={QE_WARM} fillOpacity={locOk ? 0.18 : 0.1} />}
              {pickedDir !== undefined && !locOk && <path d={sectorPath(half, sectorIn, sectorOut, pickedDir)} fill={DIM} fillOpacity={0.24} />}
              {view.nearMiss && correctDir !== undefined && pickedDir !== undefined && target && (
                <path d={arcPath(half, geo.radii[target.ring], pickedDir, correctDir)} fill="none" stroke={QE_WARM} strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" />
              )}
              <g opacity={0.85}>
                {distractors.map((d, i) => {
                  const p = at(d.ring, d.slot)
                  return <Triangle key={i} x={p.x} y={p.y} r={stim / 2} fill={art.triangle ?? QE_INK} />
                })}
              </g>
              {targetAt && (
                <>
                  <g className={locOk ? 'bfx-pop' : undefined} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
                    <Star x={targetAt.x} y={targetAt.y} r={stim / 2} fill={art.star ?? QE_INK} />
                  </g>
                  <circle cx={targetAt.x} cy={targetAt.y} r={stim * 0.85} fill="none" stroke={locOk ? QE_WARM : QE_INK} strokeWidth={2.5} />
                </>
              )}
              {centreOk && (
                <rect x={boxLeft + 1} y={boxTop + 1} width={boxW - 2} height={boxH - 2} rx={QUICK_EYE_BOX_RADIUS - 1} fill="none" stroke={QE_WARM} strokeWidth={2} />
              )}
            </svg>
            {/* What was in the centre, warm-lit when it was answered right. */}
            <svg
              width={boxW}
              height={boxH}
              className="absolute"
              style={{ left: boxLeft, top: boxTop, filter: centreOk ? `drop-shadow(0 0 18px ${QE_WARM})` : undefined }}
              aria-hidden="true"
            >
              {center.map((id, i) => (
                <CenterShape key={i} id={id} x={xs[i] - boxLeft} y={boxH / 2} d={shape} />
              ))}
            </svg>
            {hereAt && (
              <span
                className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full font-semibold ${demo ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[13px]'}`}
                style={{ left: hereAt.x, top: hereAt.y, background: 'rgba(28,26,23,0.8)', color: QE_INK }}
                aria-hidden="true"
              >
                {t('quickEye.wasHere')}
              </span>
            )}
          </div>
        )}
        {/* Where was the star: eight arrows around the field — shown faintly (and inert) while the
            centre is being answered, so the second question is no surprise. */}
        {view.asksLocation && (previewDirs || locating) &&
          Array.from({ length: 8 }, (_, d) => {
            const angle = d * DIR_STEP
            const r = R - (demo ? 2 : 4)
            const x = half + r * Math.sin(angle)
            const y = half - r * Math.cos(angle)
            const inert = previewDirs || demo
            const style: CSSProperties = {
              width: dirSize,
              height: dirSize,
              left: x - dirSize / 2,
              top: y - dirSize / 2,
              background: 'rgba(28,26,23,0.55)',
              border: `1.5px solid ${QE_INK}`,
              color: QE_INK,
              opacity: previewDirs ? 0.4 : 1,
              pointerEvents: inert ? 'none' : undefined,
              transition: 'opacity 150ms ease-out',
            }
            return (
              <button
                key={d}
                type="button"
                disabled={inert}
                tabIndex={inert ? -1 : undefined}
                aria-hidden={inert || undefined}
                aria-label={inert ? undefined : t(`quickEye.dir.${d}`)}
                onPointerDown={(e) => { e.preventDefault(); if (!inert) onTap(d) }}
                onClick={(e) => { if (e.detail === 0 && !inert) onTap(d) }}
                className={`absolute rounded-full flex items-center justify-center ${inert ? 'cursor-default' : 'cursor-pointer hover:brightness-125 active:scale-90 transition-transform'}`}
                style={style}
                data-testid={locating && !demo ? `brain-qe-dir-${d}` : undefined}
                // Only the live arrows: the demo's pointer must find the centre answers while these are a preview.
                data-tap={locating ? d : undefined}
              >
                <ArrowUp className={demo ? 'w-4 h-4' : 'w-7 h-7'} strokeWidth={2.5} style={{ transform: `rotate(${d * 45}deg)` }} aria-hidden="true" />
              </button>
            )
          })}
      </div>

      {/* What was in the centre: two large answers, drawn as the shapes themselves. */}
      {(view.phase === 'answerCenter' || revealing) && (
        <div ref={answersRef} className={`flex ${demo ? 'gap-2' : 'gap-4'}`} role={demo ? undefined : 'group'}>
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            const right = revealing && i === view.correctCenter
            let style: CSSProperties = glass
            let anim = 'bfx-rise'
            if (right) {
              style = { background: 'rgba(242,196,107,0.16)', border: `2px solid ${QE_WARM}`, boxShadow: '0 0 18px rgba(242,196,107,0.55)' }
              anim = view.pickedCenter === i ? 'bfx-pop' : ''
            } else if (revealing) {
              // No red: a wrong pick only dims.
              style = { ...glass, opacity: i === view.pickedCenter ? 0.45 : 0.3 }
              anim = ''
            }
            const label = optionLabel(opt)
            const live = view.phase === 'answerCenter' && !demo
            return (
              <button
                key={i}
                type="button"
                disabled={!live}
                tabIndex={demo ? -1 : undefined}
                aria-hidden={demo || undefined}
                aria-label={demo ? undefined : label}
                onPointerDown={(e) => { e.preventDefault(); if (live) onTap(i) }}
                onClick={(e) => { if (e.detail === 0 && live) onTap(i) }}
                className={`relative ${demo ? 'min-w-14 min-h-14 px-2' : 'min-w-24 min-h-24 px-4'} rounded-2xl flex flex-col items-center justify-center gap-2 ${live ? 'cursor-pointer hover:bg-white/20 active:scale-95 transition-transform' : 'cursor-default'} ${anim}`}
                style={{ ...style, pointerEvents: revealing ? 'none' : undefined }}
                data-testid={demo ? undefined : `brain-qe-center-${i}`}
                data-tap={i}
              >
                {isShape ? <CenterShapeIcon id={opt} size={demo ? 30 : 56} /> : <span className={`${demo ? 'text-sm' : 'text-xl'} font-semibold text-white`}>{label}</span>}
                {right && (
                  <span className="absolute -top-2 -right-2 flex items-center justify-center w-6 h-6 rounded-full" style={{ background: QE_WARM, color: DIM }} aria-hidden="true">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
