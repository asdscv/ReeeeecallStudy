import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function DocsFooter() {
  const { t } = useTranslation(['api-docs', 'landing'])
  return (
    <footer className="border-t border-border bg-background mt-12 sm:mt-16">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-7 h-7" />
            <span className="font-bold text-foreground">ReeeeecallStudy</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition no-underline">{t('footer.home')}</Link>
            <Link to="/auth/login" className="hover:text-foreground transition no-underline">{t('footer.login')}</Link>
          </div>
          <p className="text-sm text-content-tertiary">
            {t('landing:footer.copyright')}
          </p>
        </div>
      </div>
    </footer>
  )
}
