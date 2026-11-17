import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, RotateCcw } from 'lucide-react'

export function HeroSection() {
  const { t } = useTranslation('landing')
  const [revealed, setRevealed] = useState(false)

  return (
    <section className="landing-hero landing-width" aria-labelledby="landing-title">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow">{t('human.eyebrow')}</p>
        <h1 id="landing-title">{t('human.title1')}<br /><span>{t('human.title2')}</span></h1>
        <p className="landing-intro">{t('human.intro')}</p>
        <div className="landing-actions">
          <Link to="/auth/login" className="landing-button">{t('hero.cta.start')} <ArrowRight size={17} aria-hidden="true" /></Link>
          <a href="#how-it-works" className="landing-text-link">{t('human.seeHow')} <span aria-hidden="true">↓</span></a>
        </div>
        <p className="landing-small-note">{t('human.heroNote')}</p>
      </div>
      <figure className="landing-example">
        <figcaption>{t('human.demoLabel')}</figcaption>
        <div className="landing-card-stack">
          <div className="landing-study-card">
            <div className="landing-card-top"><span>{t('human.demoSubject')}</span><span>{t(revealed ? 'human.back' : 'human.front')}</span></div>
            <div className="landing-card-content" aria-live="polite" aria-atomic="true" id="landing-card-answer">
              <p className={revealed ? 'landing-card-answer' : 'landing-card-word'} lang={revealed ? undefined : 'en'}>{revealed ? t('human.demoAnswer') : 'hesitate'}</p>
              <p className="landing-card-example" lang={revealed ? 'en' : undefined}>{revealed ? 'Don’t hesitate to ask.' : t('human.demoPrompt')}</p>
            </div>
            <button type="button" className="landing-card-toggle" aria-controls="landing-card-answer" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
              {revealed ? <RotateCcw size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
              {t(revealed ? 'human.tryAgain' : 'human.showAnswer')}
            </button>
          </div>
        </div>
        <p className="landing-example-note">{t('human.demoNote')}</p>
      </figure>
    </section>
  )
}
