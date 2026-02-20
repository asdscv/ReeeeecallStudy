import { useTranslation } from 'react-i18next'
import { Brain, Layers, BarChart3, Share2, Globe, Smartphone } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const FEATURE_ICONS = [
  { icon: Brain, color: 'bg-blue-100 text-blue-600', accent: 'border-t-blue-500', key: 'srs' },
  { icon: Layers, color: 'bg-purple-100 text-purple-600', accent: 'border-t-purple-500', key: 'modes' },
  { icon: BarChart3, color: 'bg-green-100 text-green-600', accent: 'border-t-green-500', key: 'stats' },
  { icon: Share2, color: 'bg-orange-100 text-orange-600', accent: 'border-t-orange-500', key: 'sharing' },
  { icon: Globe, color: 'bg-pink-100 text-pink-600', accent: 'border-t-pink-500', key: 'tts' },
  { icon: Smartphone, color: 'bg-indigo-100 text-indigo-600', accent: 'border-t-indigo-500', key: 'responsive' },
]

export function FeaturesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const features = FEATURE_ICONS.map(f => ({
    ...f,
    title: t(`features.${f.key}.title`),
    desc: t(`features.${f.key}.desc`),
  }))

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1 } },
  }

  const item = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  }

  return (
    <section id="features" className="py-12 sm:py-16 md:py-24 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8 sm:mb-12 md:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 mb-3 sm:mb-4">{t('featuresSection.title')}</h2>
          <p className="text-gray-500 text-sm sm:text-base md:text-lg max-w-2xl mx-auto">
            {t('featuresSection.subtitle')}
          </p>
        </div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6"
          variants={prefersReduced ? undefined : container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          {features.map((f) => (
            <motion.div
              key={f.key}
              variants={prefersReduced ? undefined : item}
              className={`bg-white rounded-xl border border-gray-200 border-t-4 ${f.accent} p-4 sm:p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300`}
            >
              <motion.div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center mb-3 sm:mb-4 ${f.color}`}
                whileHover={prefersReduced ? undefined : { rotate: 5, scale: 1.05 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <f.icon className="w-6 h-6" />
              </motion.div>
              <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
