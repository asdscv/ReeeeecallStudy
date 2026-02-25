import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ScrollReveal } from './ScrollReveal'
import { LanguageSelector } from '../common/LanguageSelector'

export function FooterSection() {
  const { t } = useTranslation('landing')

  return (
    <footer className="border-t border-gray-200 bg-gray-50 pb-20 sm:pb-0">
      <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
        <ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-6">
            {/* Brand column */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <img src="/favicon.png" alt="" className="w-8 h-8" />
                <span className="font-bold text-gray-900 text-lg">ReeeeecallStudy</span>
              </div>
              <p className="text-sm text-gray-500 mb-4 max-w-xs">
                {t('footer.tagline', 'Smart flashcard learning platform with spaced repetition')}
              </p>

              {/* Language switcher */}
              <LanguageSelector direction="up" />
            </div>

            {/* Product column */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">
                {t('footer.product', 'Product')}
              </h4>
              <ul className="space-y-2 list-none p-0 m-0">
                <li>
                  <a href="/landing#features" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.features', 'Features')}
                  </a>
                </li>
                <li>
                  <a href="/landing#stats" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.results', 'Results')}
                  </a>
                </li>
                <li>
                  <a href="/landing#how-it-works" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.howItWorks', 'How It Works')}
                  </a>
                </li>
                <li>
                  <a href="/landing#faq" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.faq', 'FAQ')}
                  </a>
                </li>
              </ul>
            </div>

            {/* Resources column */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">
                {t('footer.resources', 'Resources')}
              </h4>
              <ul className="space-y-2 list-none p-0 m-0">
                <li>
                  <Link to="/insight" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.blog', 'Insights')}
                  </Link>
                </li>
                <li>
                  <Link to="/docs/api" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.apiDocs', 'API Docs')}
                  </Link>
                </li>
                <li>
                  <a href="mailto:admin@reeeeecallstudy.xyz" className="text-sm text-gray-500 hover:text-gray-700 transition no-underline">
                    {t('footer.help', 'Help')}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-8 pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-gray-400">
              {t('footer.copyright', '© 2026 ReeeeecallStudy. All rights reserved.')}
            </p>
            <a
              href="mailto:admin@reeeeecallstudy.xyz"
              className="text-sm text-gray-400 hover:text-gray-600 transition no-underline"
            >
              admin@reeeeecallstudy.xyz
            </a>
          </div>
        </ScrollReveal>
      </div>
    </footer>
  )
}
