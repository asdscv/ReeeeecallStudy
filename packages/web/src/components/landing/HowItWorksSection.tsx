import { useTranslation } from 'react-i18next'

export function HowItWorksSection() {
  const { t } = useTranslation('landing')
  return (
    <section id="how-it-works" className="landing-how" aria-labelledby="landing-how-title">
      <div className="landing-width landing-section">
        <p className="landing-eyebrow">{t('human.howEyebrow')}</p>
        <h2 id="landing-how-title">{t('howItWorks.title')}</h2>
        <ol className="landing-steps">
          {['step1', 'step2', 'step3'].map((key, i) => <li key={key}>
            <span className="landing-step-number" aria-hidden="true">0{i + 1}</span>
            <h3>{t(`howItWorks.${key}.title`)}</h3>
            <p>{t(`howItWorks.${key}.desc`)}</p>
          </li>)}
        </ol>
        <aside className="landing-pause-note"><h3>{t('human.pauseTitle')}</h3><p>{t('human.pauseText')}</p></aside>
      </div>
    </section>
  )
}
