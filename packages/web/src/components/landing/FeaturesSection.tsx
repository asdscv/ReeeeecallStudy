import { useTranslation } from 'react-i18next'
import { Brain, Layers, BarChart3, Share2, Globe, Smartphone } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const FEATURES = [
  { icon: Brain, color: 'bg-blue-500/10 text-blue-600', key: 'srs' },
  { icon: Layers, color: 'bg-violet-500/10 text-violet-600', key: 'modes' },
  { icon: BarChart3, color: 'bg-emerald-500/10 text-emerald-600', key: 'stats' },
  { icon: Share2, color: 'bg-orange-500/10 text-orange-600', key: 'sharing' },
  { icon: Globe, color: 'bg-pink-500/10 text-pink-600', key: 'tts' },
  { icon: Smartphone, color: 'bg-indigo-500/10 text-indigo-600', key: 'responsive' },
]

export function FeaturesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08 } },
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  }

  return (
    <section id="features" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-3">{t('featuresSection.title')}</h2>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto">
            {t('featuresSection.subtitle')}
          </p>
        </div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
          variants={prefersReduced ? undefined : container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.key}
              variants={prefersReduced ? undefined : item}
              className="bg-card rounded-2xl border border-border p-5 sm:p-6 hover:border-border/80 hover:shadow-sm transition-all duration-300"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${f.color}`}>
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">{t(`features.${f.key}.title`)}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t(`features.${f.key}.desc`)}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
