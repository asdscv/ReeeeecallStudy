import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

export function FinalCTASection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()

  return (
    <section id="cta" className="py-16 sm:py-20 md:py-28 px-4 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-brand/[0.06] rounded-full blur-[120px]" />
      </div>

      <ScrollReveal>
        <div className="max-w-2xl mx-auto text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-foreground tracking-tight mb-4 sm:mb-5">
            {t('cta.title')}
          </h2>
          <p className="text-muted-foreground text-base sm:text-lg mb-8 sm:mb-10 max-w-lg mx-auto leading-relaxed">
            {t('cta.subtitle')}
          </p>
          <motion.button
            onClick={() => navigate('/auth/login')}
            className="inline-flex items-center gap-2.5 px-8 sm:px-10 py-3.5 sm:py-4 bg-brand text-white text-base sm:text-lg font-semibold rounded-xl hover:brightness-110 transition shadow-lg shadow-blue-600/25 cursor-pointer"
            whileHover={prefersReduced ? undefined : { scale: 1.04, boxShadow: '0 20px 40px rgba(37,99,235,0.3)' }}
            whileTap={prefersReduced ? undefined : { scale: 0.98 }}
          >
            {t('cta.button')} <ArrowRight className="w-5 h-5" />
          </motion.button>
        </div>
      </ScrollReveal>
    </section>
  )
}
