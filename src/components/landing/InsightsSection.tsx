import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { useContentStore } from '../../stores/content-store'
import { ScrollReveal } from './ScrollReveal'

export function InsightsSection() {
  const { t } = useTranslation('landing')
  const { items: contentItems, listLoading: contentLoading } = useContentStore()

  if (contentLoading || contentItems.length === 0) return null

  return (
    <section className="py-16 sm:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
              {t('nav.blog', 'Insights')}
            </h2>
          </div>
        </ScrollReveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {contentItems.slice(0, 3).map((item, i) => (
            <ScrollReveal key={item.id} delay={i * 0.1}>
              <Link
                to={`/insight/${item.slug}`}
                className="group block rounded-2xl overflow-hidden no-underline transition-transform duration-300 hover:scale-[0.98] h-[280px]"
              >
                {item.thumbnail_url ? (
                  <div className="relative w-full h-full">
                    <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-5">
                      <h3 className="text-xl font-bold text-white leading-snug">{item.title}</h3>
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full h-full bg-gradient-to-br from-blue-600 to-blue-800">
                    <div className="absolute bottom-0 left-0 right-0 p-5">
                      <h3 className="text-xl font-bold text-white leading-snug">{item.title}</h3>
                    </div>
                  </div>
                )}
              </Link>
            </ScrollReveal>
          ))}
        </div>
        <ScrollReveal delay={0.3}>
          <div className="text-center mt-8">
            <Link
              to="/insight"
              className="inline-flex items-center gap-2 text-blue-600 font-semibold hover:text-blue-800 transition no-underline"
            >
              {t('nav.blog', 'Insights')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
