import { useTranslation } from 'react-i18next'
import { BookOpen, Brain, BarChart3 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const STEPS = [
  {
    step: '01',
    icon: BookOpen,
    key: 'step1',
    gradient: 'from-blue-500 to-cyan-400',
    iconBg: 'bg-blue-500/10 text-blue-600',
  },
  {
    step: '02',
    icon: Brain,
    key: 'step2',
    gradient: 'from-violet-500 to-purple-400',
    iconBg: 'bg-violet-500/10 text-violet-600',
  },
  {
    step: '03',
    icon: BarChart3,
    key: 'step3',
    gradient: 'from-emerald-500 to-teal-400',
    iconBg: 'bg-emerald-500/10 text-emerald-600',
  },
]

export function HowItWorksSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  return (
    <section id="how-it-works" className="py-12 sm:py-16 md:py-24 px-4 bg-muted">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground mb-3 sm:mb-4">
            {t('howItWorks.title')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 relative">
          {/* Connecting line (desktop only) */}
          <div className="hidden sm:block absolute top-14 left-[calc(16.67%+40px)] right-[calc(16.67%+40px)] h-px z-0">
            <div className="h-full bg-border" />
            <motion.div
              className="h-full bg-brand/40 absolute top-0 left-0 right-0 origin-left"
              initial={prefersReduced ? undefined : { scaleX: 0 }}
              whileInView={prefersReduced ? undefined : { scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, delay: 0.3, ease: 'easeOut' }}
            />
          </div>

          {STEPS.map((s, i) => (
            <motion.div
              key={s.step}
              className="relative z-10"
              initial={prefersReduced ? undefined : { opacity: 0, y: 30 }}
              whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="bg-card rounded-2xl border border-border p-6 sm:p-8 h-full hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                {/* Step number + icon row */}
                <div className="flex items-center gap-3 mb-5">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                    {s.step}
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.iconBg}`}>
                    <s.icon className="w-5 h-5" />
                  </div>
                </div>

                <h3 className="text-lg font-bold text-foreground mb-2">
                  {t(`howItWorks.${s.key}.title`)}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t(`howItWorks.${s.key}.desc`)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
