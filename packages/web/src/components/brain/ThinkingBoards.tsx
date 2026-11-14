import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, KeyRound, Undo2 } from 'lucide-react'
import { MAZE_WALL, SET_COLORS, type CodeBreakView, type MakeNumberView, type MazeView, type SetCard, type SetMatchView } from '@reeeeecall/shared/lib/brain-games'
import { mazeDragCells, mazePoint, type MazePoint } from '@reeeeecall/shared/lib/brain-games/maze-drag'
import type { BoardProps } from './BrainBoard'
import { boardHeight } from './brain-ui'

type Props<V> = BoardProps & { view: V }
const buttonClass = 'rounded-xl border-2 border-white/25 bg-white/10 text-white font-bold disabled:opacity-40 disabled:cursor-default enabled:hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer'

function Tap({ index, onTap, disabled, demo, children, label, style, selected, testId }: {
  index: number; onTap: (index: number) => void; disabled?: boolean; demo?: boolean; children: ReactNode; label?: string; style?: CSSProperties; selected?: boolean; testId?: string
}) {
  return <button type="button" className={buttonClass} style={{ minHeight: demo ? 30 : 56, fontSize: demo ? 16 : typeof children === 'number' || (typeof children === 'string' && children.length <= 2) ? 28 : 18, opacity: demo ? 1 : undefined, ...style }}
    disabled={disabled || demo} tabIndex={demo ? -1 : undefined} aria-label={label} aria-pressed={selected}
    data-tap={index} data-testid={demo ? undefined : testId} onClick={() => onTap(index)}>{children}</button>
}

/** Shapes and fills are drawn independently of colour. Unique pattern IDs keep demo/play SVGs separate. */
function SetSymbol({ card, size }: { card: SetCard; size: number }) {
  const id = useId().replace(/:/g, '')
  const color = SET_COLORS[card.color]
  const fill = card.fill === 'solid' ? color : card.fill === 'outline' ? '#fff' : `url(#${id})`
  const attrs = { fill, stroke: color, strokeWidth: 2.4 }
  return <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
    <defs><pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="white" /><path d="M0 0V5" stroke={color} strokeWidth="2" /></pattern></defs>
    {card.shape === 'circle' ? <circle cx="14" cy="14" r="11" {...attrs} /> : card.shape === 'triangle' ? <path d="M14 2 L26 25 H2 Z" {...attrs} /> : card.shape === 'diamond' ? <path d="M14 1 L27 14 L14 27 L1 14 Z" {...attrs} /> : <rect x="3" y="3" width="22" height="22" rx="1" {...attrs} />}
  </svg>
}

export function SetMatchBoard({ view, onTap, width, demo }: Props<SetMatchView>) {
  const { t } = useTranslation('brain')
  const gap = demo ? 5 : 8
  const cellW = (width - (view.cols - 1) * gap) / view.cols
  const size = Math.min(demo ? 18 : 28, (cellW - 12) / 3)
  return <div style={{ width }} className="space-y-3" data-testid="brain-set-match">
    <p className="text-center text-white/85" style={{ fontSize: demo ? 12 : 16 }}>{view.vary.map((a) => t(`play.setAttribute.${a}`)).join(' · ')} · {t('play.setPicked', { count: view.picked })}</p>
    <div className="grid" style={{ gridTemplateColumns: `repeat(${view.cols}, 1fr)`, gap }}>
      {view.cards.map(({ card, tone }, i) => <Tap key={i} index={i} onTap={onTap} demo={demo} disabled={view.locked}
        selected={tone === 'lit'} testId={`brain-set-card-${i}`}
        label={[t('play.setCard', { count: card.count }), t(`play.setShape.${card.shape}`), t(`play.setColor.${card.color}`), t(`play.setFill.${card.fill}`)].join(', ')}
        style={{ minHeight: demo ? 45 : 64, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, background: '#fff', borderWidth: 4, borderColor: tone === 'lit' ? '#F0E442' : tone === 'correct' || tone === 'missed' ? '#56B4E9' : tone === 'wrong' ? '#D55E00' : 'transparent', boxShadow: tone === 'lit' ? '0 0 0 2px #111827' : undefined }}>
        {Array.from({ length: card.count }, (_, k) => <SetSymbol key={k} card={card} size={size} />)}
        {(tone === 'correct' || tone === 'missed') && <span className="text-slate-900 text-sm" aria-hidden="true">✓</span>}
        {tone === 'wrong' && <span className="text-slate-900 text-sm" aria-hidden="true">×</span>}
      </Tap>)}
    </div>
    {view.extra && <Tap index={view.extra.index} onTap={onTap} demo={demo} disabled={view.locked} style={{ width: '100%' }}>{t(view.extra.key)}</Tap>}
    {view.broken && view.broken.length > 0 && <p className="text-center text-white" role="status">{t('play.setBroken', { attributes: view.broken.map((a) => t(`play.setAttribute.${a}`)).join(' · ') })}</p>}
    {view.answer?.length === 0 && <p className="text-center text-white" role="status">{t('play.noneWas')}</p>}
  </div>
}

export function CodeBreakBoard({ view, onTap, width, demo }: Props<CodeBreakView>) {
  const { t } = useTranslation('brain')
  const [notesOpen, setNotesOpen] = useState(false)
  const history = useRef<HTMLDivElement>(null)
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight }, [view.guesses.length])
  const cols = Math.min(5, Math.max(3, Math.floor((width + 8) / 64)), view.keys.length)
  return <div style={{ width }} className={demo ? 'space-y-1' : 'space-y-2'} data-testid="brain-code-break">
    <p className="text-center text-white/85" style={{ fontSize: demo ? 12 : 16 }}>{t('play.codeGuesses', { used: view.guesses.length, total: view.maxGuesses })} · {t(view.repeats ? 'play.codeRepeats' : 'play.codeDistinct')}</p>
    <div ref={history} className="overflow-y-auto rounded-xl bg-black/20 p-2" style={{ maxHeight: demo ? 70 : 140, minHeight: demo ? 28 : 48 }} aria-label={t('play.codeHistory')} aria-live="polite" tabIndex={demo ? -1 : 0}>
      {view.guesses.length === 0 ? <p className="text-white/65 text-center">{t('play.codeFirstGuess')}</p> : view.guesses.map((g, i) => <div key={i} className="flex justify-between items-center gap-2 py-1 text-white">
        <span className="font-bold tracking-[0.2em]" style={{ fontSize: demo ? 16 : 26 }}>{g.digits.join('')}</span>
        <span style={{ fontSize: demo ? 11 : 16 }}>{t('play.codeFeedback', { strikes: g.strikes, balls: g.balls })}</span>
      </div>)}
    </div>
    <div className="flex justify-center gap-2" aria-label={t('play.codeEntry')}>
      {Array.from({ length: view.length }, (_, i) => <span key={i} className="flex items-center justify-center rounded-lg border-2 border-white/50 bg-white/10 font-bold text-white" style={{ width: demo ? 28 : 48, height: demo ? 30 : 52, fontSize: demo ? 18 : 30 }}>{view.entry[i] ?? '·'}</span>)}
    </div>
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {view.keys.map((k) => <Tap key={k.digit} {...k} disabled={k.disabled || view.locked} demo={demo} onTap={onTap}>{k.digit}</Tap>)}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Tap {...view.del} disabled={view.del.disabled || view.locked} demo={demo} onTap={onTap} label={t('play.erase')}><Undo2 className="inline h-5 w-5" /> {t('play.erase')}</Tap>
      <Tap {...view.submit} disabled={view.submit.disabled || view.locked} demo={demo} onTap={onTap}>{t('play.submit')}</Tap>
    </div>
    {!demo && <button type="button" className="text-base text-white underline min-h-11 w-full" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}>{t('play.codeNotes')}</button>}
    {notesOpen && <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{view.notes.map((n) => <Tap key={n.digit} {...n} demo={demo} onTap={onTap} selected={n.crossed} label={t('play.codeNote', { digit: n.digit })} style={{ textDecoration: n.crossed ? 'line-through' : undefined, opacity: n.crossed ? 0.5 : 1 }}>{n.digit}</Tap>)}</div>}
    {view.secret && <p className="text-center font-bold text-white" role="status">{t('play.codeAnswer', { code: view.secret.join('') })}</p>}
  </div>
}

export function MakeNumberBoard({ view, onTap, width, demo }: Props<MakeNumberView>) {
  const { t } = useTranslation('brain')
  const expression = view.expression.map((x) => x.kind === 'num' ? x.value : x.op).join(' ')
  const signs = view.expression.filter((x) => x.kind === 'op' && x.op !== '²')
  return <div style={{ width }} className="space-y-3" data-testid="brain-make-number">
    <p className="text-center text-white font-bold" style={{ fontSize: demo ? 18 : 30 }}>{t('play.makeTarget', { target: view.target })}</p>
    <p className="text-center text-white/85" style={{ fontSize: demo ? 12 : 16 }}>{t(view.order === 'fixed' ? 'play.makeFixed' : 'play.makeAny')} · {t('play.makeTries', { count: view.tries.left })}</p>
    <div className="flex flex-wrap justify-center items-center gap-2">
      {view.tiles.map((n, i) => <div key={n.index} className="flex items-center gap-2">
        <Tap {...n} onTap={onTap} demo={demo} style={{ minWidth: demo ? 28 : 56, background: '#fff', color: '#0F172A', opacity: n.used ? 0.45 : 1 }}>{n.value}</Tap>
        {view.order === 'fixed' && i < view.tiles.length - 1 && <span className="text-white font-bold" style={{ fontSize: demo ? 16 : 26 }}>{signs[i]?.kind === 'op' ? signs[i].op : '□'}</span>}
      </div>)}
    </div>
    <div className="rounded-xl bg-black/20 p-3 text-center text-white font-bold break-words" style={{ minHeight: demo ? 30 : 60, fontSize: demo ? 18 : 28 }} aria-live="polite" aria-label={t('play.makeExpression')}>
      {expression || '…'}{view.preview !== undefined && ` = ${view.preview}`}
    </div>
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, view.ops.length)}, 1fr)` }}>{view.ops.map((o) => <Tap key={o.op} {...o} label={o.op === '²' ? t('play.makeSquare') : o.op} onTap={onTap} demo={demo} disabled={o.disabled || view.locked}>{o.op}</Tap>)}</div>
    <div className="grid grid-cols-3 gap-2">
      <Tap {...view.undo} onTap={onTap} demo={demo}>{t('play.undo')}</Tap>
      <Tap {...view.clear} onTap={onTap} demo={demo}>{t('play.clear')}</Tap>
      <Tap {...view.submit} onTap={onTap} demo={demo}>{t('play.submit')}</Tap>
    </div>
    {view.lastValue !== undefined && <p className="text-center text-white" role="status">{t('play.makeValue', { value: view.lastValue })}</p>}
    {view.reveal && <p className="text-center text-white text-xl" role="status">{view.reveal.lines.join(' · ')}</p>}
  </div>
}

export function MazeBoard({ view, onTap, width, maxHeight, demo, paused }: Props<MazeView>) {
  const { t } = useTranslation('brain')
  const drag = useRef<{ pointer: number; point: MazePoint } | null>(null)
  const cell = Math.max(demo ? 20 : view.hidden ? 56 : 44, Math.floor(Math.min(width / view.cols, ((maxHeight ?? boardHeight()) - (demo ? 34 : 44)) / view.rows, demo ? 48 : 72)))
  const w = cell * view.cols, h = cell * view.rows
  const current = view.path[view.path.length - 1]
  const locked = view.locked || demo || paused
  const path = view.answer?.path ?? view.path
  const walls = view.answer?.walls ?? view.walls
  const point = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return mazePoint((e.clientX - r.left) / cell, (e.clientY - r.top) / cell, view.cols, view.rows)
  }
  return <div className="space-y-2 flex flex-col items-center" style={{ width }} data-testid="brain-maze">
    <p className="text-center text-white/85" style={{ fontSize: demo ? 12 : 16 }}>{t(view.phase === 'preview' ? 'play.mazeMemorise' : 'play.mazeDrag')}{view.budget && ` · ${t('play.mazeBumps', { count: view.budget.left })}`}</p>
    <div role="group" aria-label={t('games.mazeRun.name')} className="relative rounded-lg bg-slate-950 select-none" style={{ width: w, height: h, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (locked || e.button !== 0 || drag.current) return
        e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture?.(e.pointerId)
        const p = point(e, e.currentTarget); drag.current = { pointer: e.pointerId, point: p }
        onTap(Math.floor(p.y) * view.cols + Math.floor(p.x))
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (locked || !d || d.pointer !== e.pointerId) return
        const p = point(e, e.currentTarget)
        mazeDragCells(d.point, p, view.cols, view.rows).forEach(onTap); d.point = p
      }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      tabIndex={demo ? -1 : 0}
      onKeyDown={(e) => {
        if (locked) return
        const c = current % view.cols, r = Math.floor(current / view.cols)
        const next = e.key === 'ArrowLeft' && c > 0 ? current - 1 : e.key === 'ArrowRight' && c < view.cols - 1 ? current + 1 : e.key === 'ArrowUp' && r > 0 ? current - view.cols : e.key === 'ArrowDown' && r < view.rows - 1 ? current + view.cols : null
        if (next !== null) { e.preventDefault(); onTap(next) }
      }}>
      <svg className="absolute inset-0 pointer-events-none" width={w} height={h} aria-hidden="true">
        <polyline points={path.map((i) => `${(i % view.cols + 0.5) * cell},${(Math.floor(i / view.cols) + 0.5) * cell}`).join(' ')} fill="none" stroke={view.answer ? '#E69F00' : '#56B4E9'} strokeOpacity="0.75" strokeWidth={Math.max(5, cell * 0.16)} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${view.cols}, 1fr)` }}>
        {walls.map((wall, i) => {
          const key = view.keys.find((k) => k.cell === i)
          const mark = i === current ? '●' : i === view.start ? 'S' : ''
          const label = key ? t('play.mazeKey', { count: key.order }) : i === view.goal ? t('play.mazeGoal') : i === view.start ? t('play.mazeStart') : String(i + 1)
          const bump = view.bump?.cell === i ? view.bump.side : 0
          const side = (bit: number) => wall & bit ? '2px solid #F8FAFC' : bump & bit ? '4px solid #E69F00' : '1px solid #ffffff0d'
          return <button key={i} type="button" disabled={locked} className="relative flex items-center justify-center p-0 bg-transparent text-white focus-visible:bg-white/20 outline-offset-[-4px]"
            style={{ width: cell, height: cell, borderTop: side(MAZE_WALL.top), borderRight: side(MAZE_WALL.right), borderBottom: side(MAZE_WALL.bottom), borderLeft: side(MAZE_WALL.left), fontSize: demo ? 14 : 24 }}
            data-tap={i} data-testid={demo ? undefined : `brain-maze-cell-${i}`} aria-label={label} aria-current={i === current ? 'location' : undefined} tabIndex={demo ? -1 : 0}
            onClick={(e) => { if (e.detail === 0 && !locked) onTap(i) }}>
            {key && !key.taken ? <span className="flex items-center" style={{ color: '#E69F00' }}><KeyRound size={demo ? 12 : 18} />{key.order}</span> : i === view.goal ? <Flag size={demo ? 16 : 24} color={view.goalOpen ? '#F0E442' : '#94A3B8'} /> : mark}
          </button>
        })}
      </div>
    </div>
    {view.showBar && <div key={`${view.cols}-${view.rows}-${view.showBar.ms}`} className="h-2 w-full rounded-full bg-white/15 overflow-hidden"><div className="h-full bg-sky-300 origin-left" style={{ animation: `brain-maze-drain ${view.showBar.ms}ms linear both`, animationPlayState: paused ? 'paused' : 'running' }} /></div>}
  </div>
}
