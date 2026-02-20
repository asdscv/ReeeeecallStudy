import { useTranslation } from 'react-i18next'
import { Shield, Ban, Lock, Globe, Smartphone } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const BADGES = [
  { key: 'free', icon: Shield, label: 'Free Forever' },
  { key: 'noAds', icon: Ban, label: 'No Ads' },
  { key: 'privacy', icon: Lock, label: 'Privacy First' },
  { key: 'languages', icon: Globe, label: '4 Languages' },
  { key: 'allDevices', icon: Smartphone, label: 'All Devices' },
] as const

export function TrustBadgesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08 } },
  }

  const item = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
  }

  return (
    <section className="py-6 sm:py-8 px-4">
      <motion.div
        className="max-w-4xl mx-auto flex flex-wrap justify-center gap-3 sm:gap-4 md:gap-6"
        variants={prefersReduced ? undefined : container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-40px' }}
      >
        {BADGES.map((badge) => (
          <motion.div
            key={badge.key}
            variants={prefersReduced ? undefined : item}
            whileHover={prefersReduced ? undefined : { scale: 1.05 }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full text-sm text-gray-600 border border-gray-200 hover:shadow-md transition-shadow cursor-default"
          >
            <badge.icon className="w-4 h-4 text-gray-500" />
            <span className="font-medium">{t(`trustBadges.${badge.key}`, badge.label)}</span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
