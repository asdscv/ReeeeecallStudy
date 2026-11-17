import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'

export function FinalCTASection() {
  const { t } = useTranslation('landing')
  return (
    <section className="landing-final" aria-labelledby="landing-final-title">
      <div className="landing-width landing-final-row"><div><p className="landing-eyebrow">Reklue</p><h2 id="landing-final-title">{t('human.finalTitle')}</h2><p>{t('human.finalText')}</p></div><Link to="/auth/login" className="landing-button">{t('hero.cta.start')}<ArrowRight size={17} aria-hidden="true" /></Link></div>
    </section>
  )
}
