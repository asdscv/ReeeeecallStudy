import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Share2, Globe, Smartphone, Upload } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SUPPORTED_LOCALES } from '../../lib/locale-utils'

const BADGES = [
  {
    key: 'srs',
    icon: Brain,
    label: 'Smart SRS',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-200/60',
    hoverGlow: 'hover:shadow-blue-100',
  },
  {
    key: 'sharing',
    icon: Share2,
    label: 'Deck Sharing',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-500',
    borderColor: 'border-violet-200/60',
    hoverGlow: 'hover:shadow-violet-100',
  },
  {
    key: 'languages',
    icon: Globe,
    label: `${SUPPORTED_LOCALES.length} Languages`,
    iconBg: 'bg-cyan-100',
    iconColor: 'text-cyan-500',
    borderColor: 'border-cyan-200/60',
    hoverGlow: 'hover:shadow-cyan-100',
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
  {
    key: 'import',
    icon: Upload,
    label: 'CSV & API Import',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-500',
    borderColor: 'border-orange-200/60',
    hoverGlow: 'hover:shadow-orange-100',
  },
] as const

const ROTATE_INTERVAL = 2500

export function TrustBadgesSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()
  const [activeIdx, setActiveIdx] = useState(0)

  // Auto-rotate for mobile ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % BADGES.length)
    }, ROTATE_INTERVAL)
    return () => clearInterval(timer)
  }, [])

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1 } },
  }

  const item = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  }

  const activeBadge = BADGES[activeIdx]

  return (
    <section className="py-8 sm:py-10">
      {/* Mobile: single rotating badge */}
      <div className="md:hidden flex justify-center px-4">
        <div className="relative h-11 flex items-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeBadge.key}
              initial={prefersReduced ? undefined : { opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={prefersReduced ? undefined : { opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-sm border ${activeBadge.borderColor} shadow-sm`}
            >
              <div className={`w-7 h-7 rounded-lg ${activeBadge.iconBg} flex items-center justify-center shrink-0`}>
                <activeBadge.icon className={`w-3.5 h-3.5 ${activeBadge.iconColor}`} />
              </div>
              <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                {t(`trustBadges.${activeBadge.key}`, { count: SUPPORTED_LOCALES.length, defaultValue: activeBadge.label })}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Dot indicators */}
        <div className="absolute mt-14 flex gap-1.5 justify-center w-full pointer-events-none">
          {BADGES.map((badge, i) => (
            <div
              key={badge.key}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                i === activeIdx ? 'bg-gray-500 w-3' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Desktop: centered single row */}
      <motion.div
        className="hidden md:flex max-w-5xl mx-auto justify-center gap-4 px-4"
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
            className={`group relative flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-sm border ${badge.borderColor} hover:shadow-lg ${badge.hoverGlow} transition-all duration-300 cursor-default overflow-hidden shrink-0`}
          >
            {/* Shimmer overlay */}
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />

            <div className={`w-8 h-8 rounded-lg ${badge.iconBg} flex items-center justify-center shrink-0`}>
              <badge.icon className={`w-4 h-4 ${badge.iconColor}`} />
            </div>
            <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
              {t(`trustBadges.${badge.key}`, { count: SUPPORTED_LOCALES.length, defaultValue: badge.label })}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
