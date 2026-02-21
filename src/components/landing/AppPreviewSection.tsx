import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

const FLIP_INTERVAL = 3000

const RATING_BUTTONS = ['Again', 'Hard', 'Good', 'Easy']
const RATING_COLORS = [
  'bg-red-500/80 text-white',
  'bg-orange-500/80 text-white',
  'bg-green-500/80 text-white',
  'bg-blue-500/80 text-white',
]

function FloatingCard({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const prefersReduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
    >
      <motion.div
        animate={prefersReduced ? undefined : { y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function AppPreviewSection() {
  const { t } = useTranslation('landing')
  const [isFlipped, setIsFlipped] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    if (prefersReduced) return
    const interval = setInterval(() => {
      setIsFlipped((prev) => !prev)
    }, FLIP_INTERVAL)
    return () => clearInterval(interval)
  }, [prefersReduced])

  // Sweep highlight across rating buttons after card flips to back
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
    <section className="px-4 pb-12 sm:pb-16 md:pb-24 relative">
      {/* Background glow effects — clamped to avoid mobile overflow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(600px,90vw)] h-[min(400px,60vw)] bg-gradient-to-r from-blue-400/20 via-cyan-300/15 to-violet-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-[min(300px,50vw)] h-[min(300px,50vw)] bg-blue-400/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[min(250px,40vw)] h-[min(250px,40vw)] bg-violet-400/10 rounded-full blur-3xl animate-pulse [animation-delay:1.5s]" />
      </div>

      <ScrollReveal>
        <div className="max-w-4xl mx-auto relative">
          {/* Floating stat cards - desktop only */}
          <div className="hidden lg:block">
            <FloatingCard
              className="absolute -left-16 top-12 z-10"
              delay={0.3}
            >
              <div className="bg-white/90 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg shadow-blue-500/10 border border-blue-100/60">
                <div className="text-xs text-gray-500 mb-0.5">{t('preview.mockStreak', 'Streak: 7 days')}</div>
                <div className="text-lg font-bold text-blue-600">🔥 7</div>
              </div>
            </FloatingCard>

            <FloatingCard
              className="absolute -right-12 top-20 z-10"
              delay={0.5}
            >
              <div className="bg-white/90 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg shadow-emerald-500/10 border border-emerald-100/60">
                <div className="text-xs text-gray-500 mb-0.5">{t('preview.mockCards', '12/30 cards')}</div>
                <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: '40%' }}
                    transition={{ duration: 1.2, delay: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </FloatingCard>

            <FloatingCard
              className="absolute -left-8 bottom-16 z-10"
              delay={0.7}
            >
              <div className="bg-white/90 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg shadow-violet-500/10 border border-violet-100/60">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs font-medium text-gray-600">SRS Active</span>
                </div>
              </div>
            </FloatingCard>
          </div>

          {/* Main browser window */}
          <motion.div
            className="relative"
            whileHover={prefersReduced ? undefined : { y: -4 }}
            transition={{ type: 'spring', stiffness: 200, damping: 30 }}
          >
            {/* Animated gradient border glow */}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-blue-500/40 via-cyan-400/40 to-violet-500/40 blur-sm opacity-60" />
            <div className="absolute -inset-[2px] rounded-2xl bg-gradient-to-r from-blue-500/20 via-cyan-400/20 to-violet-500/20 blur-md" />

            <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/20">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-800/80 border-b border-gray-700/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/80 hover:bg-red-400 transition-colors" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 transition-colors" />
                  <div className="w-3 h-3 rounded-full bg-green-400/80 hover:bg-green-400 transition-colors" />
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

              {/* Content area with subtle grid pattern */}
              <div className="relative p-6 sm:p-10 flex flex-col items-center">
                {/* Subtle grid pattern overlay */}
                <div
                  className="absolute inset-0 opacity-[0.03]"
                  style={{
                    backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                  }}
                />

                {/* Tagline */}
                <motion.div
                  className="mb-4 sm:mb-6 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <span className="text-xs font-medium text-blue-400">
                    {t('preview.tagline', 'Smart Flashcard Learning Platform')}
                  </span>
                </motion.div>

                {/* Flashcard with flip */}
                <div className="w-full max-w-[280px] sm:max-w-sm h-40 sm:h-48 [perspective:1000px] mb-4 sm:mb-6 relative">
                  {/* Card reflection/shadow */}
                  <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-8 bg-blue-500/10 blur-xl rounded-full" />

                  <motion.div
                    className="relative w-full h-full [transform-style:preserve-3d]"
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                  >
                    {/* Front */}
                    <div className="absolute inset-0 [backface-visibility:hidden] bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 rounded-xl flex items-center justify-center p-6 shadow-lg shadow-blue-600/20">
                      <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.15)_0%,transparent_60%)]" />
                      <p className="text-2xl sm:text-3xl font-bold text-white relative">
                        {t('preview.mockFront', 'Hello')}
                      </p>
                    </div>
                    {/* Back */}
                    <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-gradient-to-br from-cyan-400 via-cyan-500 to-blue-600 rounded-xl flex flex-col items-center justify-center p-4 sm:p-6 shadow-lg shadow-cyan-600/20">
                      <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.15)_0%,transparent_60%)]" />
                      <p className="text-2xl sm:text-3xl font-bold text-white relative">
                        {t('preview.mockBack', 'Bonjour')}
                      </p>
                      <p className="text-xs sm:text-sm text-white/70 mt-1.5 relative">
                        {t('preview.mockMeaning', 'Hello (French)')}
                      </p>
                      <p className="text-[10px] sm:text-xs text-white/50 mt-1 relative italic">
                        {t('preview.mockExample', '"Bonjour, comment allez-vous?"')}
                      </p>
                    </div>
                  </motion.div>
                </div>

                {/* Rating buttons */}
                <div className="flex gap-1.5 sm:gap-3 mb-5 relative">
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

                {/* Status bar */}
                <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400/60" />
                    {t('preview.mockCards', '12/30 cards')}
                  </span>
                  <span className="w-px h-3 bg-gray-700" />
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400/60" />
                    {t('preview.mockStreak', 'Streak: 7 days')}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </ScrollReveal>
    </section>
  )
}
