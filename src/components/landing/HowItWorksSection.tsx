import { useTranslation } from 'react-i18next'
import { BookOpen, Brain, BarChart3 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const STEPS = [
  { step: '1', icon: BookOpen, key: 'step1' },
  { step: '2', icon: Brain, key: 'step2' },
  { step: '3', icon: BarChart3, key: 'step3' },
]

export function HowItWorksSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  return (
    <section id="how-it-works" className="py-12 sm:py-16 md:py-24 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 mb-8 sm:mb-12">{t('howItWorks.title')}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 md:gap-8 relative">
          {/* Connecting line (desktop only) */}
          <div className="hidden sm:block absolute top-8 left-[calc(16.67%+32px)] right-[calc(16.67%+32px)] h-0.5 bg-gray-200 z-0">
            <motion.div
              className="h-full bg-blue-400 origin-left"
              initial={prefersReduced ? undefined : { scaleX: 0 }}
              whileInView={prefersReduced ? undefined : { scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
            />
          </div>

          {STEPS.map((s, i) => (
            <motion.div
              key={s.step}
              className="flex flex-col items-center relative z-10"
              initial={prefersReduced ? undefined : { opacity: 0, y: 30 }}
              whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.2, ease: 'easeOut' }}
            >
              <div className="relative">
                <motion.div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-blue-600 text-white text-xl sm:text-2xl font-bold flex items-center justify-center mb-4 sm:mb-5 shadow-lg shadow-blue-600/25 relative z-10"
                  initial={prefersReduced ? undefined : { scale: 0.8 }}
                  whileInView={prefersReduced ? undefined : { scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.2 + 0.1, type: 'spring', stiffness: 200 }}
                >
                  {s.step}
                </motion.div>
                {/* Ring pulse */}
                {!prefersReduced && (
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-blue-400"
                    initial={{ scale: 1, opacity: 0.6 }}
                    whileInView={{ scale: 1.5, opacity: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: i * 0.2 + 0.2, ease: 'easeOut' }}
                  />
                )}
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{t(`howItWorks.${s.key}.title`)}</h3>
              <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line max-w-[200px]">{t(`howItWorks.${s.key}.desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
