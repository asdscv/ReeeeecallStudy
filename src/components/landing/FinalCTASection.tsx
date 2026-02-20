import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Lock } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

export function FinalCTASection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()

  return (
    <section id="cta" className="py-16 sm:py-24 px-4">
      <ScrollReveal>
        <div className="max-w-4xl mx-auto relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 px-6 sm:px-12 py-14 sm:py-20 text-center">
          {/* Floating decorative circles */}
          {!prefersReduced && (
            <>
              <motion.div
                className="absolute -top-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"
                animate={{ y: [0, -20, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.div
                className="absolute -bottom-10 -right-10 w-56 h-56 bg-white/5 rounded-full blur-2xl"
                animate={{ y: [0, 20, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
              />
            </>
          )}

          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              {t('cta.title')}
            </h2>
            <p className="text-blue-100 text-base sm:text-lg mb-8 max-w-xl mx-auto">
              {t('cta.subtitle')}
            </p>
            <motion.button
              onClick={() => navigate('/auth/login')}
              className="inline-flex items-center gap-2 px-10 py-4 bg-white text-blue-700 text-lg font-semibold rounded-xl hover:bg-blue-50 transition shadow-lg cursor-pointer"
              whileHover={prefersReduced ? undefined : { scale: 1.05 }}
              whileTap={prefersReduced ? undefined : { scale: 0.98 }}
            >
              {t('cta.button')} <ArrowRight className="w-5 h-5" />
            </motion.button>
            <p className="mt-5 text-sm text-blue-200 flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              {t('cta.guarantee', 'Free forever. No credit card required.')}
            </p>
          </div>
        </div>
      </ScrollReveal>
    </section>
  )
}
