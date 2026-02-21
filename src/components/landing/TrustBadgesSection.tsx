import { useTranslation } from 'react-i18next'
import { Ban, Lock, Globe, Smartphone } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const BADGES = [
  {
    key: 'noAds',
    icon: Ban,
    label: 'No Ads',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-500',
    borderColor: 'border-rose-200/60',
    hoverGlow: 'hover:shadow-rose-100',
  },
  {
    key: 'privacy',
    icon: Lock,
    label: 'Privacy First',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-200/60',
    hoverGlow: 'hover:shadow-blue-100',
  },
  {
    key: 'languages',
    icon: Globe,
    label: '4 Languages',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-500',
    borderColor: 'border-violet-200/60',
    hoverGlow: 'hover:shadow-violet-100',
  },
  {
    key: 'allDevices',
    icon: Smartphone,
    label: 'All Devices',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-500',
    borderColor: 'border-emerald-200/60',
    hoverGlow: 'hover:shadow-emerald-100',
  },
] as const

export function TrustBadgesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1 } },
  }

  const item = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  }

  return (
    <section className="py-8 sm:py-10 px-4">
      <motion.div
        className="max-w-3xl mx-auto flex flex-wrap justify-center gap-3 sm:gap-4"
        variants={prefersReduced ? undefined : container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-40px' }}
      >
        {BADGES.map((badge) => (
          <motion.div
            key={badge.key}
            variants={prefersReduced ? undefined : item}
            whileHover={prefersReduced ? undefined : { scale: 1.06, y: -2 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={`group relative flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-sm border ${badge.borderColor} hover:shadow-lg ${badge.hoverGlow} transition-all duration-300 cursor-default overflow-hidden`}
          >
            {/* Shimmer overlay */}
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />

            <div className={`w-8 h-8 rounded-lg ${badge.iconBg} flex items-center justify-center shrink-0`}>
              <badge.icon className={`w-4 h-4 ${badge.iconColor}`} />
            </div>
            <span className="text-sm font-semibold text-gray-700">
              {t(`trustBadges.${badge.key}`, badge.label)}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
