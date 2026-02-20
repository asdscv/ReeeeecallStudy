import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function FooterSection() {
  const { t } = useTranslation('landing')

  return (
    <footer className="border-t border-gray-200 bg-gray-50 pb-20 sm:pb-0">
      <div className="max-w-6xl mx-auto px-4 py-10 sm:py-12">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-7 h-7" />
            <span className="font-bold text-gray-900">ReeeeecallStudy</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <Link to="/content" className="hover:text-gray-700 transition no-underline">{t('nav.blog', 'Insights')}</Link>
            <Link to="/docs/api" className="hover:text-gray-700 transition no-underline">{t('footer.apiDocs')}</Link>
          </div>
          <p className="text-sm text-gray-400">
            {t('footer.copyright')}
          </p>
        </div>
        <div className="mt-4 text-center sm:text-right">
          <a href="mailto:admin@reeeeecallstudy.xyz" className="text-sm text-gray-400 hover:text-gray-600 transition no-underline">
            admin@reeeeecallstudy.xyz
          </a>
        </div>
      </div>
    </footer>
  )
}
