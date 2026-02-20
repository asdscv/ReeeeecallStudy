import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { ScrollReveal } from './ScrollReveal'

export function BenefitsSection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()

  const benefits = Array.from({ length: 8 }, (_, i) => t(`benefits.${i}`))

  return (
    <section id="benefits" className="py-16 sm:py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {t('benefitsSection.title')}
            </h2>
            <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
              {t('benefitsSection.subtitle')}
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {benefits.map((b, i) => (
            <ScrollReveal key={i} delay={i * 0.06}>
              <div className="flex items-start gap-3 p-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <span className="text-gray-700 text-sm sm:text-base">{b}</span>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.4}>
          <div className="text-center">
            <button
              onClick={() => navigate('/auth/login')}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              {t('benefitsSection.cta')} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
