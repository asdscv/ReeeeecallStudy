import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Layers, Menu, Plus, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { LanguageSelector } from '../common/LanguageSelector'
import { AppDownload } from '../common/AppDownload'
import { AppPreviewSection } from './AppPreviewSection'
import { PricingSection } from './PricingSection'
import { PAYMENTS_ENABLED } from '../../stores/billing-store'
import { VOCAB_INDEX_PATH, isDeckLanguage, vocabLanguageIndexPath } from '@reklue/shared/lib/vocab-hubs'
import './product-landing.css'

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion()
  return <motion.div className={className} initial={reduced ? false : { y: 28 }} whileInView={{ y: 0 }} viewport={{ once: true, margin: '-30px' }} transition={{ duration: .7, delay, ease: [.22, 1, .36, 1] }}>{children}</motion.div>
}

function ProductNav() {
  const { t } = useTranslation('landing')
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  return <header className="rl-nav">
    <div className="rl-container rl-nav-row">
      <Link to="/landing" className="rl-wordmark" aria-label="Reklue"><img src="/favicon.png" width={26} height={26} alt="" />Reklue</Link>
      <nav className="rl-nav-links" aria-label={t('nav.menu')}>
        <a href="#experience">{t('premium.navExperience')}</a><a href="#features">{t('nav.features', 'Features')}</a><a href="#faq">{t('nav.faq', 'FAQ')}</a><Link to="/insight">{t('nav.blog', 'Insights')}</Link>
      </nav>
      <div className="rl-nav-actions">
        <div className="rl-nav-language"><LanguageSelector compact /></div>
        {user ? <Link to="/dashboard" className="rl-pill rl-pill-small">{t('nav.dashboard', 'Dashboard')}</Link> : <><Link to="/auth/login" className="rl-nav-login">{t('nav.login', 'Log in')}</Link><Link to="/auth/login" className="rl-pill rl-pill-small">{t('nav.start', 'Get Started')}</Link></>}
        <button type="button" className="rl-menu" aria-label={t('nav.menu')} aria-expanded={open} aria-controls="rl-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
    </div>
    {open && <nav id="rl-mobile-nav" className="rl-mobile-nav rl-container" aria-label={t('nav.menu')}><a href="#experience" onClick={() => setOpen(false)}>{t('premium.navExperience')}</a><a href="#features" onClick={() => setOpen(false)}>{t('nav.features', 'Features')}</a><a href="#faq" onClick={() => setOpen(false)}>{t('nav.faq', 'FAQ')}</a><Link to="/insight">{t('nav.blog', 'Insights')}</Link><LanguageSelector /></nav>}
  </header>
}

function ProductHero() {
  const { t } = useTranslation('landing')
  return <section className="rl-hero" aria-labelledby="rl-title">
    <div className="rl-hero-copy rl-container">
      <Reveal><p className="rl-kicker">Reklue</p><h1 id="rl-title">{t('premium.title1')}<br /><span>{t('premium.title2')}</span></h1><p className="rl-hero-description">{t('premium.heroText')}</p><div className="rl-hero-actions"><Link to="/auth/login" className="rl-pill">{t('hero.cta.start')}<ArrowRight size={16} aria-hidden="true" /></Link><a href="#experience" className="rl-link">{t('premium.tryCard')}<ChevronDown size={17} aria-hidden="true" /></a></div></Reveal>
    </div>
    <AppPreviewSection />
    <p className="rl-hero-caption">{t('premium.heroCaption')}</p>
  </section>
}

function FeatureStory() {
  const { t } = useTranslation('landing')
  return <section id="features" className="rl-features" aria-labelledby="rl-features-title">
    <div className="rl-container">
      <Reveal className="rl-section-heading"><p className="rl-eyebrow">{t('premium.featureEyebrow')}</p><h2 id="rl-features-title">{t('premium.featureTitle1')}<br /><span>{t('premium.featureTitle2')}</span></h2><p>{t('premium.featureIntro')}</p></Reveal>
      <div className="rl-feature-grid">
        <Reveal className="rl-feature-panel rl-review-panel">
          <div className="rl-panel-copy"><span className="rl-panel-label">{t('premium.reviewLabel')}</span><h3>{t('premium.reviewTitle')}</h3><p>{t('human.reviewText')}</p></div>
          <div className="rl-review-visual" aria-hidden="true">
            <div className="rl-mini-card rl-mini-card-back"><Layers size={24} /><span>curiosity</span></div><div className="rl-mini-card rl-mini-card-front"><div className="rl-mini-card-label">{t('premium.reviewExample')}</div><strong>serendipity</strong><div className="rl-rating-preview"><span>Again</span><span>Hard</span><span className="rl-rating-good">Good</span><span>Easy</span></div></div>
            <div className="rl-timeline"><i /><span /><i /><span /><i className="rl-timeline-active" /><span /><i /></div>
          </div>
        </Reveal>
        <Reveal className="rl-feature-panel rl-decks-panel" delay={.08}>
          <div className="rl-panel-copy"><span className="rl-panel-label">{t('premium.deckLabel')}</span><h3>{t('premium.deckTitle')}</h3><p>{t('premium.deckText')}</p></div>
          <div className="rl-deck-visual" aria-hidden="true">{['deckOne', 'deckTwo', 'deckThree'].map((k, i) => <div className={`rl-deck-tile rl-deck-tile-${i}`} key={k}><BookOpen size={21} /><span>{t(`premium.${k}`)}</span><ArrowUpRight size={17} /></div>)}</div>
        </Reveal>
        <Reveal className="rl-feature-panel rl-play-panel">
          <div className="rl-panel-copy"><span className="rl-panel-label">{t('premium.playLabel')}</span><h3>{t('premium.playTitle')}</h3><p>{t('premium.playText')}</p><Link to="/brain" className="rl-link">{t('premium.playLink')}<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
          <div className="rl-game-art" aria-hidden="true"><div className="rl-game-orbit rl-game-orbit-one" /><div className="rl-game-orbit rl-game-orbit-two" /><div className="rl-grid-frame"><div className="rl-game-grid">{Array.from({ length: 16 }, (_, i) => <span key={i} className={i === 6 || i === 9 ? 'rl-cell-active' : ''} />)}</div></div></div>
        </Reveal>
      </div>
      <Reveal className="rl-extra-note"><p>{t('premium.extraNote')}</p></Reveal>
    </div>
  </section>
}

function ProductHowTo() {
  const { t } = useTranslation('landing')
  return <section id="how-it-works" className="rl-how" aria-labelledby="rl-how-title"><div className="rl-container">
    <Reveal className="rl-how-heading"><p className="rl-eyebrow">{t('premium.howEyebrow')}</p><h2 id="rl-how-title">{t('premium.howTitle')}</h2></Reveal>
    <ol className="rl-steps">{['step1', 'step2', 'step3'].map((key, i) => <li key={key}><Reveal delay={i * .07}><span className="rl-step-number">0{i + 1}</span><h3>{t(`howItWorks.${key}.title`)}</h3><p>{t(`howItWorks.${key}.desc`)}</p></Reveal></li>)}</ol>
  </div></section>
}

function ProductFAQ() {
  const { t } = useTranslation('landing')
  return <section id="faq" className="rl-faq" aria-labelledby="rl-faq-title"><div className="rl-container rl-faq-layout"><Reveal><p className="rl-eyebrow">{t('premium.faqEyebrow')}</p><h2 id="rl-faq-title">{t('faq.title')}</h2><a href="mailto:admin@reklue.com" className="rl-contact">{t('premium.contact')}<ArrowUpRight size={15} aria-hidden="true" /></a></Reveal><div className="rl-questions">{[1, 2, 3, 4].map(n => <details key={n}><summary>{t(`faq.q${n}`)}<Plus size={20} aria-hidden="true" /></summary><p>{t(`faq.a${n}`)}</p></details>)}</div></div></section>
}

function ProductFinal() {
  const { t } = useTranslation('landing')
  return <section className="rl-final" aria-labelledby="rl-final-title"><div className="rl-container"><Reveal><div className="rl-final-icon" aria-hidden="true"><span /><span /><span /></div><p className="rl-kicker">Reklue</p><h2 id="rl-final-title">{t('premium.finalTitle1')}<br /><span>{t('premium.finalTitle2')}</span></h2><p>{t('premium.finalText')}</p><Link to="/auth/login" className="rl-pill">{t('hero.cta.start')}<ArrowRight size={16} aria-hidden="true" /></Link><small>{t('premium.freeNote')}</small></Reveal></div></section>
}

function ProductFooter() {
  const { t, i18n } = useTranslation('landing')
  const lang = i18n.language.slice(0, 2)
  const vocabularyPath = isDeckLanguage(lang) ? vocabLanguageIndexPath(lang) : VOCAB_INDEX_PATH
  return <footer className="rl-footer"><div className="rl-container"><div className="rl-footer-top"><div><Link to="/landing" className="rl-wordmark"><img src="/favicon.png" width={25} height={25} alt="" />Reklue</Link><p>{t('premium.footerText')}</p><LanguageSelector direction="up" /></div><AppDownload showQr /></div><nav className="rl-footer-links" aria-label={t('footer.resources')}><Link to="/insight">{t('footer.blog', 'Insights')}</Link><Link to={vocabularyPath}>{t('footer.vocabulary', 'Vocabulary lists')}</Link><Link to="/brain">{t('premium.playLabel')}</Link><a href="mailto:admin@reklue.com">{t('footer.help', 'Help')}</a><a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer">{t('footer.terms')}</a><a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</a><a href="/refund-policy.html" target="_blank" rel="noopener noreferrer">{t('footer.refund')}</a></nav><div className="rl-footer-bottom"><small>{t('footer.copyright')}</small><a href="mailto:admin@reklue.com">admin@reklue.com</a></div></div></footer>
}

export function ProductLanding() {
  return <div className="rl-product"><ProductNav /><main id="landing-main"><ProductHero /><FeatureStory /><ProductHowTo />{PAYMENTS_ENABLED && <div className="rl-pricing"><PricingSection /></div>}<ProductFAQ /><ProductFinal /></main><ProductFooter /></div>
}
