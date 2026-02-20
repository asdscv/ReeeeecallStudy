import { useTranslation } from 'react-i18next'
import { TrendingUp, Calendar, Target, Layers } from 'lucide-react'
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
      className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg transition-shadow"
      initial={prefersReduced ? undefined : { opacity: 0, y: 40 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${gradient} text-white`}>
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-4xl font-extrabold text-gray-900 mb-3">
        {value}
        <span className="text-2xl">{suffix}</span>
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
      icon: TrendingUp,
      labelKey: 'statsSection.efficiency.label',
      labelFallback: 'Learning Efficiency',
      endValue: 200,
      suffix: '%',
      changeKey: 'statsSection.efficiency.change',
      changeFallback: '+150%',
      descKey: 'statsSection.efficiency.description',
      descFallback: 'Remember more with less time',
      gradient: 'from-blue-500 to-cyan-400',
      progressPercent: 100,
    },
    {
      icon: Calendar,
      labelKey: 'statsSection.interval.label',
      labelFallback: 'Review Interval',
      endValue: 15,
      suffix: t('statsSection.interval.unit', 'd'),
      changeKey: 'statsSection.interval.change',
      changeFallback: '+8d',
      descKey: 'statsSection.interval.description',
      descFallback: 'Review intervals grow naturally',
      gradient: 'from-purple-500 to-pink-400',
      progressPercent: 62,
    },
    {
      icon: Target,
      labelKey: 'statsSection.accuracy.label',
      labelFallback: 'Accuracy Rate',
      endValue: 87,
      suffix: '%',
      changeKey: 'statsSection.accuracy.change',
      changeFallback: '+23%',
      descKey: 'statsSection.accuracy.description',
      descFallback: 'High accuracy for long-term retention',
      gradient: 'from-green-500 to-emerald-400',
      progressPercent: 87,
    },
    {
      icon: Layers,
      labelKey: 'statsSection.daily.label',
      labelFallback: 'Daily Cards',
      endValue: 45,
      suffix: t('statsSection.daily.unit', ''),
      changeKey: 'statsSection.daily.change',
      changeFallback: '+30',
      descKey: 'statsSection.daily.description',
      descFallback: 'Efficient study throughput',
      gradient: 'from-orange-500 to-amber-400',
      progressPercent: 60,
    },
  ]

  return (
    <section className="py-16 sm:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            {t('statsSection.title', 'Proven Results')}
          </h2>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
            {t('statsSection.subtitle', 'Results achieved by ReeeeecallStudy users compared to traditional study methods')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
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
