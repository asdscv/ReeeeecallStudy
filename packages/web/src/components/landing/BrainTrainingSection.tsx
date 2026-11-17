import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { schulte } from '@reklue/shared/lib/brain-games/games/schulte'
import { createRng } from '@reklue/shared/lib/brain-games/rng'
import { DEFAULT_CONTEXT } from '@reklue/shared/lib/brain-games/types'
import { useAuthStore } from '../../stores/auth-store'
import './brain-training-section.css'

const makeBoard = (seed: number) => schulte.create(1.01, createRng(seed), {
  ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 3,
})

/** A local preview of the real number-search board. No scores or account data are saved. */
export function BrainTrainingSection() {
  const { t } = useTranslation(['landing', 'brain'])
  const user = useAuthStore(state => state.user)
  const destination = (path: string) => user ? path : `/auth/login?redirect=${encodeURIComponent(path)}`
  const [seed, setSeed] = useState(5)
  const [board, setBoard] = useState(() => makeBoard(5))
  const [missed, setMissed] = useState<number | null>(null)
  const complete = board.found === board.values.length
  const found = new Set(board.sequence.slice(0, board.found))

  useEffect(() => {
    if (window.location.hash !== '#brain-training') return
    const frame = requestAnimationFrame(() => document.getElementById('brain-training')?.scrollIntoView())
    return () => cancelAnimationFrame(frame)
  }, [])

  const tap = (index: number) => {
    if (complete || found.has(index)) return
    if (board.sequence[board.found] !== index) { setMissed(index); return }
    setMissed(null)
    setBoard(schulte.tap(board, index))
  }
  const reset = () => {
    const nextSeed = seed + 1
    setSeed(nextSeed); setBoard(makeBoard(nextSeed)); setMissed(null)
  }

  return <section id="brain-training" className="rl-brain" aria-labelledby="rl-brain-title">
    <div className="rl-container">
      <div className="rl-brain-layout">
        <div className="rl-brain-copy">
          <p className="rl-eyebrow">{t('brainLanding.eyebrow')}</p>
          <h2 id="rl-brain-title">{t('brainLanding.title')}</h2>
          <p className="rl-brain-intro">{t('brainLanding.intro')}</p>
          <Link to={destination('/brain')} className="rl-brain-cta">{t('brainLanding.cta')}<ArrowRight size={18} aria-hidden="true" /></Link>
          <p className="rl-brain-access">{t('brainLanding.access')}</p>
        </div>
          <div className="rl-brain-more">
            {(['memoryGrid', 'codeBreak'] as const).map((id, i) => <Link key={id} to={destination(`/brain/play/${id}`)}>
              <div className={`rl-brain-small-art rl-brain-art-${i}`} aria-hidden="true">
                {i === 0 ? <span className="rl-brain-pattern">{Array.from({ length: 9 }, (_, n) => <i key={n} className={n === 0 || n === 4 || n === 5 ? 'is-on' : ''} />)}</span> : <span className="rl-brain-code">4<span>2</span></span>}
              </div>
              <div><span className="rl-brain-category">{t(i === 0 ? 'brainLanding.memory' : 'brainLanding.reasoning')}</span><h3>{t(`games.${id}.name`, { ns: 'brain' })}</h3><p>{t(`games.${id}.desc`, { ns: 'brain' })}</p></div>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>)}
          </div>
        <div className="rl-brain-demo">
          <div className="rl-brain-demo-header"><div><span>{t('brainLanding.search')}</span><h3>{t('games.schulte.name', { ns: 'brain' })}</h3></div><span className="rl-brain-demo-label">{t('brainLanding.preview')}</span></div>
          <p className="rl-brain-instruction">{t('brainLanding.instruction')}</p>
          <div className="rl-brain-grid" role="group" aria-label={t('brainLanding.board')}>
            {board.values.map((number, index) => <button key={index} type="button" disabled={found.has(index) || complete} className={`${found.has(index) ? 'is-found' : ''} ${missed === index ? 'is-missed' : ''}`} onClick={() => tap(index)}>{number}</button>)}
          </div>
          <div className="rl-brain-progress" aria-hidden="true">{board.values.map((_, i) => <i key={i} className={i < board.found ? 'is-done' : ''} />)}</div>
          <div className="rl-brain-demo-status"><p role="status" aria-live="polite">{complete ? t('brainLanding.complete') : t(missed !== null ? 'brainLanding.wrong' : 'brainLanding.next', { number: board.values[board.sequence[board.found]] })}</p><button type="button" className="rl-brain-reset" onClick={reset} aria-label={t('brainLanding.reset')}><RotateCcw size={17} aria-hidden="true" /></button></div>
          <Link to={destination('/brain/play/schulte')} className="rl-brain-play-link">{t('brainLanding.play')}<ArrowRight size={17} aria-hidden="true" /></Link>
          <p className="rl-brain-preview-note">{t('brainLanding.note')}</p>
        </div>
      </div>
    </div>
  </section>
}
