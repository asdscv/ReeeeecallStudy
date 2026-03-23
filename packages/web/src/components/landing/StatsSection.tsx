import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { useCountUp } from '../../hooks/useCountUp'

interface StatProps {
  endValue: number
  suffix: string
  label: string
  description: string
  delay: number
}

function Stat({ endValue, suffix, label, description, delay }: StatProps) {
  const { value, ref } = useCountUp({ end: endValue })
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      ref={ref}
      className="text-center"
      initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground">
        {value}
        <span className="text-2xl sm:text-3xl md:text-4xl text-muted-foreground font-bold">{suffix}</span>
      </p>
      <p className="text-sm sm:text-base font-semibold text-foreground mt-2">{label}</p>
      <p className="text-xs sm:text-sm text-muted-foreground mt-1">{description}</p>
    </motion.div>
  )
}

export function StatsSection() {
  const { t } = useTranslation('landing')

  const stats = [
    {
      endValue: 95,
      suffix: '%',
      labelKey: 'statsSection.retention.label',
      labelFallback: '30-Day Retention',
      descKey: 'statsSection.retention.description',
      descFallback: 'Remember what you learn after 30 days',
    },
    {
      endValue: 50,
      suffix: '%',
      labelKey: 'statsSection.timeSaved.label',
      labelFallback: 'Time Saved',
      descKey: 'statsSection.timeSaved.description',
      descFallback: 'Half the study time, same results',
    },
    {
      endValue: 92,
      suffix: '%',
      labelKey: 'statsSection.completion.label',
      labelFallback: 'Daily Completion',
      descKey: 'statsSection.completion.description',
      descFallback: 'Users finish their daily reviews',
    },
    {
      endValue: 2500,
      suffix: '+',
      labelKey: 'statsSection.learners.label',
      labelFallback: 'Active Learners',
      descKey: 'statsSection.learners.description',
      descFallback: 'Growing community worldwide',
    },
  ]

  return (
    <section id="stats" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-3">
            {t('statsSection.title', 'Proven Results')}
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto">
            {t('statsSection.subtitle', 'Backed by science — see what spaced repetition delivers')}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10 md:gap-12">
          {stats.map((stat, i) => (
            <Stat
              key={stat.labelKey}
              endValue={stat.endValue}
              suffix={stat.suffix}
              label={t(stat.labelKey, stat.labelFallback)}
              description={t(stat.descKey, stat.descFallback)}
              delay={i * 0.1}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
