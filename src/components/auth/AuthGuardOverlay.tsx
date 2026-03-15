import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Brain, BarChart3, Infinity } from 'lucide-react'

const FLIP_INTERVAL = 3000
const RATING_BUTTONS = ['Again', 'Hard', 'Good', 'Easy']
const RATING_COLORS = [
  'bg-red-500/80 text-white',
  'bg-orange-500/80 text-white',
  'bg-green-500/80 text-white',
  'bg-blue-500/80 text-white',
]

function MockBrowserPreview({ prefersReduced }: { prefersReduced: boolean | null }) {
  const { t } = useTranslation('landing')
  const [isFlipped, setIsFlipped] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  useEffect(() => {
    if (prefersReduced) return
    const interval = setInterval(() => setIsFlipped((prev) => !prev), FLIP_INTERVAL)
    return () => clearInterval(interval)
  }, [prefersReduced])

  useEffect(() => {
    if (!isFlipped || prefersReduced) {
      setHighlightIdx(-1)
      return
    }
    let idx = 0
    const sweep = setInterval(() => {
      setHighlightIdx(idx)
      idx++
      if (idx >= RATING_BUTTONS.length) clearInterval(sweep)
    }, 300)
    return () => clearInterval(sweep)
  }, [isFlipped, prefersReduced])

  return (
    <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/20">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-800/80 border-b border-gray-700/50">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="ml-3 flex-1 max-w-xs">
          <div className="px-3 py-1.5 bg-gray-700/60 rounded-lg text-xs text-gray-300 font-mono flex items-center gap-2">
            <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-gray-400">reeeeecallstudy.xyz</span>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="relative p-6 sm:p-10 flex flex-col items-center">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Flashcard with flip */}
        <div className="w-full max-w-[280px] sm:max-w-sm h-40 sm:h-48 [perspective:1000px] mb-4 sm:mb-6 relative">
          <motion.div
            className="relative w-full h-full [transform-style:preserve-3d]"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <div className="absolute inset-0 [backface-visibility:hidden] bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 rounded-xl flex items-center justify-center p-6 shadow-lg shadow-blue-600/20">
              <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.15)_0%,transparent_60%)]" />
              <p className="text-2xl sm:text-3xl font-bold text-white relative">
                {t('preview.mockFront', 'Hello')}
              </p>
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-gradient-to-br from-cyan-400 via-cyan-500 to-blue-600 rounded-xl flex flex-col items-center justify-center p-4 sm:p-6 shadow-lg shadow-cyan-600/20">
              <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.15)_0%,transparent_60%)]" />
              <p className="text-2xl sm:text-3xl font-bold text-white relative">
                {t('preview.mockBack', 'Bonjour')}
              </p>
              <p className="text-xs sm:text-sm text-white/70 mt-1.5 relative">
                {t('preview.mockMeaning', 'Hello (French)')}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Rating buttons */}
        <div className="flex gap-1.5 sm:gap-3 relative">
          {RATING_BUTTONS.map((label, i) => (
            <motion.div
              key={label}
              className={`px-2.5 sm:px-5 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-300 ${
                highlightIdx === i
                  ? `${RATING_COLORS[i]} shadow-lg`
                  : 'bg-gray-700/60 text-gray-400 border border-gray-600/30'
              }`}
              animate={highlightIdx === i ? { scale: 1.08 } : { scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              {label}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: Brain, key: 'srs' },
  { icon: BarChart3, key: 'stats' },
  { icon: Infinity, key: 'unlimited' },
] as const

export function AuthGuardOverlay() {
  const { t } = useTranslation('auth')
  const location = useLocation()
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()
  const currentPath = location.pathname + location.search

  const handleSignup = () => {
    navigate(`/auth/login?mode=signup&redirect=${encodeURIComponent(currentPath)}`)
  }

  const handleLogin = () => {
    navigate(`/auth/login?redirect=${encodeURIComponent(currentPath)}`)
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950">
      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Floating orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-blue-500/15 rounded-full blur-3xl"
          animate={prefersReduced ? undefined : { y: [0, -30, 0], x: [0, 15, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 right-1/4 w-[250px] h-[250px] bg-cyan-400/10 rounded-full blur-3xl"
          animate={prefersReduced ? undefined : { y: [0, 25, 0], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/3 w-[350px] h-[350px] bg-purple-500/10 rounded-full blur-3xl"
          animate={prefersReduced ? undefined : { y: [0, -20, 0], x: [0, 10, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Particle stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-white/30 rounded-full"
            style={{
              top: `${15 + i * 14}%`,
              left: `${10 + ((i * 17) % 80)}%`,
            }}
            animate={prefersReduced ? undefined : {
              y: [0, -10, 0],
              opacity: [0.2, 0.4, 0.2],
            }}
            transition={{
              duration: 4 + i,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.5,
            }}
          />
        ))}
      </div>

      {/* Main layout */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-6xl flex items-center gap-12 lg:gap-16">
          {/* Mock browser preview — desktop left side, mobile background */}
          <div className="hidden lg:block flex-1 max-w-lg">
            <motion.div
              className="relative"
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 0.4, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              style={{ filter: 'blur(4px)', pointerEvents: 'none' }}
            >
              <MockBrowserPreview prefersReduced={!!prefersReduced} />
            </motion.div>
          </div>

          {/* Mobile background mock — behind CTA card */}
          <div className="lg:hidden absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              className="w-[90%] max-w-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.15 }}
              transition={{ duration: 0.8 }}
              style={{ filter: 'blur(6px)' }}
            >
              <MockBrowserPreview prefersReduced={!!prefersReduced} />
            </motion.div>
          </div>

          {/* CTA Glass Card */}
          <motion.div
            className="flex-1 max-w-md mx-auto lg:mx-0 relative z-20"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-8 sm:p-10 relative overflow-hidden">
              {/* Inner gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-3xl" />

              <div className="relative flex flex-col items-center text-center">
                {/* Logo with glow */}
                <motion.div
                  className="mb-3"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: 0.4, type: 'spring', stiffness: 200, damping: 15 }}
                >
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-blue-500/30 blur-xl scale-150" />
                    <img
                      src="/favicon.png"
                      alt="Reeeeecall"
                      className="w-12 h-12 relative"
                    />
                  </div>
                </motion.div>

                {/* Logo text */}
                <motion.img
                  src="/logo-text.png"
                  alt="Reeeeecall Study"
                  className="h-6 mb-6 brightness-0 invert"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.45 }}
                />

                {/* Headline */}
                <motion.h1
                  className="text-3xl sm:text-4xl font-extrabold mb-3 bg-gradient-to-r from-white via-blue-200 to-cyan-200 bg-clip-text text-transparent"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.5 }}
                >
                  {t('authGuard.headline')}
                </motion.h1>

                {/* Subtext */}
                <motion.p
                  className="text-blue-200/80 text-sm sm:text-base mb-8 leading-relaxed"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.6 }}
                >
                  {t('authGuard.subtext')}
                </motion.p>

                {/* Feature highlights */}
                <div className="flex gap-3 mb-8 w-full">
                  {FEATURES.map((feat, i) => (
                    <motion.div
                      key={feat.key}
                      className="flex-1 bg-white/5 backdrop-blur border border-white/10 rounded-xl p-3 sm:p-4 flex flex-col items-center gap-2"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.8 + i * 0.1 }}
                    >
                      <feat.icon className="w-5 h-5 text-blue-300" />
                      <span className="text-xs sm:text-sm text-white/80 font-medium">
                        {t(`authGuard.features.${feat.key}`)}
                      </span>
                    </motion.div>
                  ))}
                </div>

                {/* CTA Button with shimmer */}
                <motion.button
                  onClick={handleSignup}
                  className="w-full relative rounded-xl py-4 text-lg font-bold text-white bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 shadow-lg shadow-blue-500/25 overflow-hidden group"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 1.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {/* Shimmer effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 animate-[shimmer_3s_infinite]" />
                  <span className="relative">
                    {t('authGuard.ctaButton')}
                  </span>
                </motion.button>

                {/* Secondary button */}
                <motion.button
                  onClick={handleLogin}
                  className="w-full mt-3 rounded-xl py-3 text-sm font-medium text-white/80 bg-white/5 border border-white/20 hover:bg-white/10 transition-colors"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 1.3 }}
                >
                  {t('authGuard.loginButton')}
                </motion.button>

                {/* Trust badges */}
                <motion.div
                  className="mt-5 flex items-center gap-3 text-emerald-400/70 text-xs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 1.3 }}
                >
                  <span>{t('authGuard.badges.free')}</span>
                  <span className="w-1 h-1 rounded-full bg-emerald-400/40" />
                  <span>{t('authGuard.badges.noCard')}</span>
                  <span className="w-1 h-1 rounded-full bg-emerald-400/40" />
                  <span>{t('authGuard.badges.instant')}</span>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Shimmer keyframe — injected via style tag */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          50%, 100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
