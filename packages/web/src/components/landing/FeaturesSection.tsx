import { useTranslation } from 'react-i18next'

export function FeaturesSection() {
  const { t } = useTranslation('landing')
  return (
    <section id="features" className="landing-section landing-width landing-features" aria-labelledby="landing-features-title">
      <div className="landing-section-heading">
        <p className="landing-eyebrow">{t('human.featuresEyebrow')}</p>
        <h2 id="landing-features-title">{t('human.featuresTitle')}</h2>
        <p>{t('human.featuresIntro')}</p>
      </div>
      <div className="landing-feature-list">
        {['review', 'cards', 'pace'].map((key, i) => <article className="landing-feature" key={key}>
          <span className="landing-index" aria-hidden="true">0{i + 1}</span>
          <div><h3>{t(`human.${key}Title`)}</h3><p>{t(`human.${key}Text`)}</p></div>
        </article>)}
        <p className="landing-feature-extra">{t('human.extra')}</p>
      </div>
    </section>
  )
}
