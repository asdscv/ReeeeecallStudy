import { useTranslation } from 'react-i18next'
import { Brain, Share2, Globe, Smartphone, Upload } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { SUPPORTED_LOCALES } from '../../lib/locale-utils'

const BADGES = [
  { key: 'srs', icon: Brain },
  { key: 'sharing', icon: Share2 },
  { key: 'languages', icon: Globe },
  { key: 'allDevices', icon: Smartphone },
  { key: 'import', icon: Upload },
] as const

export function TrustBadgesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  return (
    <section className="py-6 sm:py-8">
      <motion.div
        className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-10 px-4"
        initial={prefersReduced ? undefined : { opacity: 0 }}
        whileInView={prefersReduced ? undefined : { opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        {BADGES.map((badge, i) => (
          <motion.div
            key={badge.key}
            className="flex items-center gap-2 text-muted-foreground"
            initial={prefersReduced ? undefined : { opacity: 0, y: 10 }}
            whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
          >
            <badge.icon className="w-4 h-4 text-content-tertiary" />
            <span className="text-sm font-medium">
              {t(`trustBadges.${badge.key}`, { count: SUPPORTED_LOCALES.length })}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
