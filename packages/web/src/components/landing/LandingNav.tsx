import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { LanguageSelector } from '../common/LanguageSelector'

export function LandingNav() {
  const { t } = useTranslation('landing')
  const { user } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="landing-header">
      <div className="landing-width landing-header-row">
        <Link to="/landing" className="landing-logo" aria-label="Reklue"><img src="/favicon.png" alt="" width="32" height="32" /><span>Reklue<span className="landing-logo-dot">.</span></span></Link>
        <nav className="landing-desktop-nav" aria-label={t('nav.menu')}>
          <a href="#features">{t('nav.features', 'Features')}</a>
          <a href="#how-it-works">{t('nav.howItWorks', 'How It Works')}</a>
          <a href="#faq">{t('nav.faq', 'FAQ')}</a>
          <Link to="/insight">{t('nav.blog', 'Insights')}</Link>
        </nav>
        <div className="landing-header-actions">
          <div className="landing-language"><LanguageSelector /></div>
          <Link to={user ? '/dashboard' : '/auth/login'} className="landing-login">{user ? t('nav.dashboard', 'Dashboard') : t('nav.login', 'Log in')}</Link>
          {!user && <Link to="/auth/login" className="landing-button landing-header-start">{t('nav.start', 'Get Started')}</Link>}
          <button type="button" className="landing-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('nav.menu')} aria-expanded={menuOpen} aria-controls="landing-mobile-menu">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      {menuOpen && <nav id="landing-mobile-menu" className="landing-mobile-nav landing-width" aria-label={t('nav.menu')}>
        <a href="#features" onClick={() => setMenuOpen(false)}>{t('nav.features', 'Features')}</a>
        <a href="#how-it-works" onClick={() => setMenuOpen(false)}>{t('nav.howItWorks', 'How It Works')}</a>
        <a href="#faq" onClick={() => setMenuOpen(false)}>{t('nav.faq', 'FAQ')}</a>
        <Link to="/insight">{t('nav.blog', 'Insights')}</Link>
        <Link to="/auth/login">{t('nav.start', 'Get Started')}</Link>
        <LanguageSelector />
      </nav>}
    </header>
  )
}
