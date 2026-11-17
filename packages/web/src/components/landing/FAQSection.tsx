import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

export function FAQSection() {
  const { t } = useTranslation('landing')
  return (
    <section id="faq" className="landing-section landing-width landing-faq" aria-labelledby="landing-faq-title">
      <div className="landing-section-heading"><p className="landing-eyebrow">{t('human.faqEyebrow')}</p><h2 id="landing-faq-title">{t('faq.title')}</h2><p>{t('human.faqNote')} <a href="mailto:admin@reklue.com">admin@reklue.com</a></p></div>
      <div>{[1, 2, 3, 4].map(i => <details key={i} className="landing-question"><summary>{t(`faq.q${i}`)}<Plus size={18} aria-hidden="true" /></summary><p>{t(`faq.a${i}`)}</p></details>)}</div>
    </section>
  )
}
