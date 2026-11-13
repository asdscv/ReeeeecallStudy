import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { Pointer, RotateCcw } from 'lucide-react'
import { GAME_THEMES, buildDemo, maxColsFor, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { BrainBoard } from './BrainBoard'

const noop = () => {}

/**
 * How to play, shown rather than told: the real engine plays an easy round on the real board, and
 * a pointer makes each tap. It loops until the player starts; under reduced motion it holds each
 * frame longer and the pointer jumps instead of gliding.
 */
export function DemoPlayer({ gameId, width, centerOnly = false }: { gameId: BrainGameId; width: number; centerOnly?: boolean }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const theme = GAME_THEMES[gameId]
  // Inside the demo card's padding (16px each side) and border.
  const boardWidth = Math.min(width - 34, 300)
  const frames = useMemo(() => buildDemo(gameId, { maxCols: Math.min(4, maxColsFor(boardWidth)), centerOnly }), [gameId, boardWidth, centerOnly])
  const [i, setI] = useState(0)
  const [run, setRun] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number; press: boolean } | null>(null)
  // The demo's frames differ in height (Quick Eye's answers appear below its field): hold the
  // tallest seen so far, so the page under the demo never jumps.
  const minH = useRef(gameId === 'quickEye' ? 340 : 220)
  const frame = frames[Math.min(i, frames.length - 1)]

  useEffect(() => {
    if (!frame) return
    const hold = frame.holdMs * (reduced ? 1.4 : 1)
    // The last frame (the result) holds a little longer before the loop starts over.
    const t = setTimeout(() => setI((k) => (k + 1 >= frames.length ? 0 : k + 1)), i === frames.length - 1 ? hold + 900 : hold)
    return () => clearTimeout(t)
  }, [i, frame, frames.length, reduced, run])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (el.scrollHeight > minH.current) minH.current = el.scrollHeight
    el.style.minHeight = `${minH.current}px`
  }, [frame])

  // The pointer glides to this frame's tap, then presses just before the frame changes.
  useLayoutEffect(() => {
    if (!frame || frame.tap === undefined || !box.current) return
    const el = box.current.querySelector<HTMLElement>(`[data-tap="${frame.tap}"]`)
    if (!el) return
    const b = box.current.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPointer({ x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, press: false })
    const press = setTimeout(() => setPointer((p) => (p ? { ...p, press: true } : p)), frame.holdMs * 0.65)
    return () => clearTimeout(press)
  }, [frame])

  if (!frame) return null
  return (
    <div className="relative rounded-3xl p-4 bg-white/[0.06] border border-white/10">
      <div ref={box} className="relative flex items-center justify-center" style={{ pointerEvents: 'none' }} aria-hidden="true">
        <BrainBoard view={frame.view} onTap={noop} onExposure={noop} width={boardWidth} theme={theme} demo maxHeight={260} />
        {pointer && frame.tap !== undefined && (
          <span
            className="absolute z-10 text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]"
            style={{
              left: pointer.x,
              top: pointer.y,
              transform: `translate(-30%, -10%) scale(${pointer.press ? 0.82 : 1})`,
              transition: reduced ? 'none' : 'left 320ms cubic-bezier(.3,.7,.2,1), top 320ms cubic-bezier(.3,.7,.2,1), transform 120ms ease-out',
            }}
          >
            <Pointer className="w-9 h-9 fill-white/90 stroke-slate-900" strokeWidth={1.5} />
          </span>
        )}
      </div>
      {/* What the board is asking at this step, as the game would say it. */}
      <p key={frame.view.prompt.key} className="bfx-rise mt-3 text-center text-base font-semibold text-white/90 min-h-6" aria-hidden="true">
        {t(frame.view.prompt.key, frame.view.prompt.params)}
      </p>
      <button
        type="button"
        onClick={() => { setI(0); setRun((n) => n + 1) }}
        className="absolute top-2 right-2 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border-none text-white cursor-pointer"
        aria-label={t('intro.replay')}
        data-testid="brain-demo-replay"
      >
        <RotateCcw className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  )
}
