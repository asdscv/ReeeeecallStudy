import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Monitor, LogOut, RefreshCw, Shield, Smartphone, Wifi } from 'lucide-react'
import { useSubscriptionStore } from '../../stores/subscription-store'
import { useAuthStore } from '../../stores/auth-store'

const ease = [0.16, 1, 0.3, 1] as const

function FloatingOrbs({ prefersReduced }: { prefersReduced: boolean | null }) {
  if (prefersReduced) return null
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Warm warning orbs */}
      <motion.div
        className="absolute top-1/4 -left-20 w-[300px] h-[300px] bg-warning/15 rounded-full blur-3xl"
        animate={{ y: [0, -30, 0], x: [0, 15, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-1/3 -right-10 w-[250px] h-[250px] bg-red-400/10 rounded-full blur-3xl"
        animate={{ y: [0, 20, 0], x: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-2/3 left-1/3 w-[350px] h-[350px] bg-orange-500/10 rounded-full blur-3xl"
        animate={{ y: [0, 25, 0], x: [0, -15, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

function GridPattern() {
  return (
    <div
      className="absolute inset-0 pointer-events-none opacity-[0.04]"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    />
  )
}

function DeviceIllustration({ prefersReduced }: { prefersReduced: boolean | null }) {
  return (
    <div className="relative w-48 h-48 mx-auto mb-6">
      {/* Central shield */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={prefersReduced ? {} : { scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ duration: 0.8, ease, delay: 0.3 }}
      >
        <div className="relative">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-500/20 to-red-500/20 backdrop-blur-xl border border-white/10 flex items-center justify-center">
            <Shield className="w-12 h-12 text-amber-400" />
          </div>
          {/* Pulse ring */}
          {!prefersReduced && (
            <motion.div
              className="absolute -inset-3 rounded-3xl border-2 border-amber-400/30"
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>
      </motion.div>

      {/* Orbiting device icons */}
      <motion.div
        className="absolute top-2 right-4"
        initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5, ease }}
      >
        <div className="w-10 h-10 rounded-xl bg-card/5 border border-white/10 flex items-center justify-center">
          <Monitor className="w-5 h-5 text-white/60" />
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-4 left-2"
        initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.5, ease }}
      >
        <div className="w-10 h-10 rounded-xl bg-card/5 border border-white/10 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-white/60" />
        </div>
      </motion.div>

      {/* Disconnected line */}
      {!prefersReduced && (
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-[2px]"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 1.0, duration: 0.4, ease }}
        >
          <div className="w-full h-full bg-gradient-to-r from-transparent via-red-400/50 to-transparent" />
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-400"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </motion.div>
      )}
    </div>
  )
}

export function SessionKickedOverlay() {
  const { t } = useTranslation('auth')
  const prefersReduced = useReducedMotion()
  const sessionValid = useSubscriptionStore((s) => s.sessionValid)
  const registerSession = useSubscriptionStore((s) => s.registerSession)
  const signOut = useAuthStore((s) => s.signOut)
  const user = useAuthStore((s) => s.user)
  const [reclaiming, setReclaiming] = useState(false)
  const [showContent, setShowContent] = useState(false)

  // Only show for logged-in users with invalid sessions
  const shouldShow = user && !sessionValid

  useEffect(() => {
    if (!shouldShow) {
      setShowContent(false)
      return
    }
    if (prefersReduced) {
      setShowContent(true)
      return
    }
    const timer = setTimeout(() => setShowContent(true), 300)
    return () => clearTimeout(timer)
  }, [shouldShow, prefersReduced])

  if (!shouldShow) return null

  const handleReclaim = async () => {
    setReclaiming(true)
    const result = await registerSession()
    if (result.allowed) {
      // Session reclaimed — overlay will auto-dismiss
    }
    setReclaiming(false)
  }

  const handleLogout = async () => {
    await signOut()
  }

  const d = prefersReduced ? 0 : 0.2 // base delay

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-red-950/80" />
      <GridPattern />
      <FloatingOrbs prefersReduced={prefersReduced} />

      {/* Content */}
      {showContent && (
        <motion.div
          className="relative z-10 w-full max-w-md mx-4"
          initial={prefersReduced ? {} : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: d }}
        >
          {/* Glass card */}
          <div className="relative bg-card/[0.07] backdrop-blur-xl border border-white/15 rounded-3xl shadow-2xl overflow-hidden">
            {/* Top gradient accent */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />

            <div className="relative px-8 py-10 sm:px-10 sm:py-12">
              {/* Device illustration */}
              <DeviceIllustration prefersReduced={prefersReduced} />

              {/* Status badge */}
              <motion.div
                className="flex justify-center mb-5"
                initial={prefersReduced ? {} : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: d + 0.4, duration: 0.4, ease }}
              >
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-amber-400/20 text-amber-300 text-xs font-medium">
                  <Wifi className="w-3 h-3" />
                  {t('sessionKicked.badge')}
                </span>
              </motion.div>

              {/* Headline */}
              <motion.h2
                className="text-center text-2xl sm:text-3xl font-bold mb-3 bg-gradient-to-r from-white via-amber-100 to-orange-200 bg-clip-text text-transparent"
                initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: d + 0.5, duration: 0.5, ease }}
              >
                {t('sessionKicked.headline')}
              </motion.h2>

              {/* Description */}
              <motion.p
                className="text-center text-white/60 text-sm sm:text-base mb-8 leading-relaxed"
                initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: d + 0.6, duration: 0.5, ease }}
              >
                {t('sessionKicked.description')}
              </motion.p>

              {/* Info cards */}
              <motion.div
                className="grid grid-cols-2 gap-3 mb-8"
                initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: d + 0.7, duration: 0.5, ease }}
              >
                <div className="bg-card/5 border border-white/10 rounded-xl p-3 text-center">
                  <Monitor className="w-5 h-5 text-amber-300/80 mx-auto mb-1.5" />
                  <p className="text-white/50 text-xs">{t('sessionKicked.info.otherDevice')}</p>
                </div>
                <div className="bg-card/5 border border-white/10 rounded-xl p-3 text-center">
                  <Shield className="w-5 h-5 text-amber-300/80 mx-auto mb-1.5" />
                  <p className="text-white/50 text-xs">{t('sessionKicked.info.security')}</p>
                </div>
              </motion.div>

              {/* Reclaim button */}
              <motion.button
                onClick={handleReclaim}
                disabled={reclaiming}
                className="relative w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white font-semibold text-base shadow-lg shadow-amber-500/25 overflow-hidden disabled:opacity-60 mb-3"
                initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={prefersReduced ? {} : { scale: 1.03 }}
                whileTap={prefersReduced ? {} : { scale: 0.98 }}
                transition={{ delay: d + 0.9, duration: 0.5, ease }}
              >
                {/* Shimmer */}
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_3s_infinite] pointer-events-none" />
                <span className="relative flex items-center justify-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${reclaiming ? 'animate-spin' : ''}`} />
                  {reclaiming ? t('sessionKicked.reclaiming') : t('sessionKicked.reclaimButton')}
                </span>
              </motion.button>

              {/* Logout button */}
              <motion.button
                onClick={handleLogout}
                className="w-full py-3 rounded-2xl bg-card/5 border border-white/15 text-white/70 font-medium text-sm hover:bg-card/10 transition-colors flex items-center justify-center gap-2"
                initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: d + 1.0, duration: 0.5, ease }}
              >
                <LogOut className="w-4 h-4" />
                {t('sessionKicked.logoutButton')}
              </motion.button>

              {/* Hint text */}
              <motion.p
                className="text-center text-white/30 text-xs mt-5"
                initial={prefersReduced ? {} : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: d + 1.2, duration: 0.5 }}
              >
                {t('sessionKicked.hint')}
              </motion.p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
