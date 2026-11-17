import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'

const WORDS = ['serendipity', 'curiosity', 'momentum']
const RATINGS = ['Again', 'Hard', 'Good', 'Easy']

export function AppPreviewSection() {
  const { t, i18n } = useTranslation('landing')
  const reduced = useReducedMotion()
  const [flipped, setFlipped] = useState(false)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [interaction, setInteraction] = useState(0)
  const playing = !paused && !reduced

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setFlipped(v => !v), 4200)
    return () => clearInterval(timer)
  }, [playing, index, interaction])

  useEffect(() => {
    if (!flipped || !playing) return
    const timers = RATINGS.map((_, n) => setTimeout(() => setHighlight(n), 650 + n * 340))
    return () => timers.forEach(clearTimeout)
  }, [flipped, playing, index])

  const advance = (delta: number) => {
    setIndex(v => (v + delta + WORDS.length) % WORDS.length)
    setFlipped(false)
    setHighlight(-1)
    setInteraction(v => v + 1)
  }
  const flip = () => {
    setFlipped(v => !v)
    setHighlight(-1)
    setInteraction(v => v + 1)
  }

  return <div className="rl-experience" id="experience">
    <div className="rl-scene" aria-label={t('premium.demoLabel')}>
      <div className="rl-scene-horizon" aria-hidden="true" />
      <div className="rl-side-card rl-side-left" aria-hidden="true"><span>Reklue</span><strong>curiosity</strong><i /></div>
      <div className="rl-side-card rl-side-right" aria-hidden="true"><span>Reklue</span><strong>momentum</strong><i /></div>
      <div className="rl-card-pedestal">
        <motion.button type="button" className="rl-flip-card" onClick={flip} aria-label={t(flipped ? 'premium.flipBack' : 'premium.flipAnswer')} animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: reduced ? 0 : .85, ease: [.25, .8, .25, 1] }}>
          <div className="rl-card-face rl-card-front" aria-hidden={flipped}>
            <div className="rl-card-face-top"><span>{t('premium.cardCategory')}</span><span>0{index + 1} / 03</span></div>
            <div className="rl-card-face-center"><p className="rl-card-prompt">{t('premium.cardPrompt')}</p><strong lang="en">{WORDS[index]}</strong></div>
            <div className="rl-card-face-bottom"><span>{t('premium.flipAnswer')}</span><RotateCcw size={15} aria-hidden="true" /></div>
          </div>
          <div className="rl-card-face rl-card-back" aria-hidden={!flipped}>
            <div className="rl-card-face-top"><span>{t('premium.answerLabel')}</span><span>0{index + 1} / 03</span></div>
            <div className="rl-card-face-center"><strong className="rl-card-meaning" lang={i18n.language}>{t(`premium.meaning${index + 1}`)}</strong><p lang="en">{WORDS[index]}</p></div>
            <div className="rl-card-face-bottom"><span>{t('premium.flipBack')}</span><RotateCcw size={15} aria-hidden="true" /></div>
          </div>
        </motion.button>
      </div>
    </div>
    <div className="rl-demo-controls">
      <div className="rl-demo-ratings" aria-label={t('premium.ratingLabel')}>{RATINGS.map((label, n) => <button key={label} type="button" disabled={!flipped} className={`rl-rate rl-rate-${n} ${flipped && highlight === n ? 'rl-rate-highlight' : ''}`} onClick={() => advance(1)}>{label}</button>)}</div>
      <div className="rl-demo-bottom"><p>{t('premium.demoNote')}</p><div className="rl-carousel-controls"><button type="button" onClick={() => advance(-1)} aria-label={t('premium.previousCard')}><ChevronLeft size={18} /></button><span className="rl-carousel-dots" aria-hidden="true">{WORDS.map((w, n) => <i key={w} className={n === index ? 'rl-dot-active' : ''} />)}</span><button type="button" onClick={() => advance(1)} aria-label={t('premium.nextCard')}><ChevronRight size={18} /></button><span className="rl-controls-divider" /><button type="button" disabled={!!reduced} onClick={() => setPaused(v => !v)} aria-pressed={paused || !!reduced} aria-label={t(playing ? 'premium.pause' : 'premium.play')}>{playing ? <Pause size={15} /> : <Play size={15} />}</button></div></div>
    </div>
  </div>
}
