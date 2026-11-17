import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSelector } from '../common/LanguageSelector'
import { AppDownload } from '../common/AppDownload'
import { VOCAB_INDEX_PATH, isDeckLanguage, vocabLanguageIndexPath } from '@reklue/shared/lib/vocab-hubs'

// The public landing has its own footer; content and service pages keep FooterSection.
export function LandingFooter() {
  const { t, i18n } = useTranslation('landing')
  const lang = i18n.language.slice(0, 2)
  const vocabularyPath = isDeckLanguage(lang) ? vocabLanguageIndexPath(lang) : VOCAB_INDEX_PATH
  return (
    <footer className="landing-footer">
      <div className="landing-width">
        <div className="landing-footer-top"><div><Link to="/landing" className="landing-logo"><img src="/favicon.png" alt="" width="28" height="28" />Reklue.</Link><p>{t('human.footerNote')}</p><LanguageSelector direction="up" /></div><AppDownload showQr /></div>
        <nav className="landing-footer-links" aria-label={t('footer.resources')}>
          <Link to="/insight">{t('footer.blog', 'Insights')}</Link><Link to={vocabularyPath}>{t('footer.vocabulary', 'Vocabulary lists')}</Link><a href="mailto:admin@reklue.com">{t('footer.help', 'Help')}</a>
          <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer">{t('footer.terms')}</a><a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</a><a href="/refund-policy.html" target="_blank" rel="noopener noreferrer">{t('footer.refund')}</a>
        </nav>
        <div className="landing-footer-bottom"><small>{t('footer.copyright')}</small><a href="mailto:admin@reklue.com">admin@reklue.com</a></div>
      </div>
    </footer>
  )
}
