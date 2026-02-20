import { useTranslation } from 'react-i18next'
import { Brain, Clock, Target, Users } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCountUp } from '../../hooks/useCountUp'

interface StatCardProps {
  icon: React.ElementType
  label: string
  endValue: number
  suffix: string
  change: string
  description: string
  baseline: string
  gradient: string
  progressPercent: number
  delay: number
}

function StatCard({
  icon: Icon,
  label,
  endValue,
  suffix,
  change,
  description,
  baseline,
  gradient,
  progressPercent,
  delay,
}: StatCardProps) {
  const { value, ref } = useCountUp({ end: endValue })
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      ref={ref}
      className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 hover:shadow-lg transition-shadow"
      initial={prefersReduced ? undefined : { opacity: 0, y: 40 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      whileHover={prefersReduced ? undefined : { scale: 1.03, y: -4 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center mb-3 sm:mb-4 bg-gradient-to-br ${gradient} text-white`}>
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
      <p className="text-xs sm:text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-2 sm:mb-3">
        {value}
        <span className="text-xl sm:text-2xl">{suffix}</span>
      </p>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
          initial={{ width: 0 }}
          whileInView={{ width: `${progressPercent}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1.5, delay: delay + 0.3, ease: 'easeOut' }}
        />
      </div>

      <p className="text-xs text-gray-400 mb-2">{description}</p>

      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-green-500">{change}</span>
        <span className="text-xs text-gray-400">{baseline}</span>
      </div>
    </motion.div>
  )
}

export function StatsSection() {
  const { t } = useTranslation('landing')

  const stats = [
    {
      icon: Brain,
      labelKey: 'statsSection.retention.label',
      labelFallback: '30-Day Retention',
      endValue: 95,
      suffix: '%',
      changeKey: 'statsSection.retention.change',
      changeFallback: '+75%',
      descKey: 'statsSection.retention.description',
      descFallback: 'Remember what you learn after 30 days',
      gradient: 'from-blue-500 to-cyan-400',
      progressPercent: 95,
    },
    {
      icon: Clock,
      labelKey: 'statsSection.timeSaved.label',
      labelFallback: 'Time Saved',
      endValue: 50,
      suffix: '%',
      changeKey: 'statsSection.timeSaved.change',
      changeFallback: '-50%',
      descKey: 'statsSection.timeSaved.description',
      descFallback: 'Half the study time, same results',
      gradient: 'from-purple-500 to-pink-400',
      progressPercent: 50,
    },
    {
      icon: Target,
      labelKey: 'statsSection.completion.label',
      labelFallback: 'Daily Completion',
      endValue: 92,
      suffix: '%',
      changeKey: 'statsSection.completion.change',
      changeFallback: '+38%',
      descKey: 'statsSection.completion.description',
      descFallback: 'Users finish their daily reviews',
      gradient: 'from-green-500 to-emerald-400',
      progressPercent: 92,
    },
    {
      icon: Users,
      labelKey: 'statsSection.learners.label',
      labelFallback: 'Active Learners',
      endValue: 2500,
      suffix: '+',
      changeKey: 'statsSection.learners.change',
      changeFallback: '+840',
      descKey: 'statsSection.learners.description',
      descFallback: 'Growing community worldwide',
      gradient: 'from-orange-500 to-amber-400',
      progressPercent: 72,
    },
  ]

  return (
    <section id="stats" className="py-12 sm:py-16 md:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 mb-3 sm:mb-4">
            {t('statsSection.title', 'Proven Results')}
          </h2>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
            {t('statsSection.subtitle', 'Results achieved by ReeeeecallStudy users compared to traditional study methods')}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          {stats.map((stat, i) => (
            <StatCard
              key={stat.labelKey}
              icon={stat.icon}
              label={t(stat.labelKey, stat.labelFallback)}
              endValue={stat.endValue}
              suffix={stat.suffix}
              change={t(stat.changeKey, stat.changeFallback)}
              description={t(stat.descKey, stat.descFallback)}
              baseline={t('statsSection.baseline', 'vs. traditional study')}
              gradient={stat.gradient}
              progressPercent={stat.progressPercent}
              delay={i * 0.15}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
