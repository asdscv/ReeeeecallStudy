import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Brain, BarChart3, Infinity as InfinityIcon } from 'lucide-react'

/**
 * MockBrowserPreview — AppPreviewSection(랜딩)에서 복사 후 AuthGuard용으로 수정
 *
 * 랜딩(AppPreviewSection)과의 차이점:
 * - 첫 flip이 0.75초 후 즉시 실행 (랜딩은 3초 interval만 사용)
 * - 카드 디자인 업그레이드: Q/A 배지, rounded-2xl, 예문, glow reflection
 * - 진행률 바 추가 (12/30 cards, 40%)
 * - 브라우저 크롬: animated border glow, 초록 자물쇠, darker 배경
 * - 버튼: 선택 시 y:-2 lift 효과, 색상별 shadow, emerald(Good)
 * - FloatingCard/stat 카드 제거 (오버레이에서는 불필요)
 * - ScrollReveal/whileHover 제거 (blur 처리 후 인터랙션 없음)
 */
const FIRST_FLIP_DELAY = 750  // Show front briefly, then flip
const FLIP_INTERVAL = 3000
const RATING_BUTTONS = ['Again', 'Hard', 'Good', 'Easy']
const RATING_COLORS = [
  'bg-destructive text-white shadow-red-500/40',
  'bg-orange-500 text-white shadow-orange-500/40',
  'bg-emerald-500 text-white shadow-emerald-500/40',
  'bg-brand text-white shadow-blue-500/40',
]

function MockBrowserPreview({ prefersReduced }: { prefersReduced: boolean | null }) {
  const { t } = useTranslation('landing')
  const [isFlipped, setIsFlipped] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [flipCount, setFlipCount] = useState(0)

  // First flip: quick (800ms), then regular interval
  useEffect(() => {
    if (prefersReduced) return
    const firstTimer = setTimeout(() => {
      setIsFlipped(true)
      setFlipCount(1)
    }, FIRST_FLIP_DELAY)
    return () => clearTimeout(firstTimer)
  }, [prefersReduced])

  useEffect(() => {
    if (prefersReduced || flipCount === 0) return
    const interval = setInterval(() => {
      setIsFlipped((prev) => !prev)
      setFlipCount((c) => c + 1)
    }, FLIP_INTERVAL)
    return () => clearInterval(interval)
  }, [prefersReduced, flipCount])

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
    }, 250)
    return () => clearInterval(sweep)
  }, [isFlipped, prefersReduced])

  return (
    <div className="relative bg-gray-950 rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/30 border border-white/5">
      {/* Animated border glow */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-blue-500/30 via-cyan-400/30 to-violet-500/30 blur-sm opacity-60 -z-10" />

      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-foreground/90 border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-warning/80" />
          <div className="w-3 h-3 rounded-full bg-success/80" />
        </div>
        <div className="ml-3 flex-1 max-w-xs">
          <div className="px-3 py-1.5 bg-card/5 rounded-lg text-xs text-content-tertiary font-mono flex items-center gap-2 border border-white/5">
            <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-content-tertiary">reeeeecallstudy.xyz</span>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="relative p-6 sm:p-10 flex flex-col items-center bg-gradient-to-b from-gray-900 to-gray-950">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(59,130,246,0.5) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Tagline pill */}
        <motion.div
          className="mb-5 px-4 py-1.5 rounded-full bg-brand/10 border border-brand/20"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <span className="text-xs font-medium text-brand/70 tracking-wide">
            {t('preview.tagline', 'Smart Flashcard Learning Platform')}
          </span>
        </motion.div>

        {/* Flashcard with flip */}
        <div className="w-full max-w-[280px] sm:max-w-sm h-44 sm:h-52 [perspective:1200px] mb-5 sm:mb-6 relative">
          {/* Card glow reflection */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-12 bg-brand/15 blur-2xl rounded-full" />

          <motion.div
            className="relative w-full h-full [transform-style:preserve-3d]"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Front */}
            <div className="absolute inset-0 [backface-visibility:hidden] bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 rounded-2xl flex flex-col items-center justify-center p-6 shadow-xl shadow-blue-600/25 border border-white/10">
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.2)_0%,transparent_50%)]" />
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-card/10 text-[10px] text-white/50 font-medium">
                Q
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white relative">
                {t('preview.mockFront', 'Hello')}
              </p>
              <p className="text-xs text-white/40 mt-2 relative">
                Tap to reveal
              </p>
            </div>
            {/* Back */}
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-600 rounded-2xl flex flex-col items-center justify-center p-4 sm:p-6 shadow-xl shadow-cyan-600/25 border border-white/10">
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.2)_0%,transparent_50%)]" />
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-card/10 text-[10px] text-white/50 font-medium">
                A
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white relative">
                {t('preview.mockBack', 'Bonjour')}
              </p>
              <p className="text-sm text-white/70 mt-2 relative font-medium">
                {t('preview.mockMeaning', 'Hello (French)')}
              </p>
              <p className="text-xs text-white/40 mt-1 relative italic">
                {t('preview.mockExample', '"Bonjour, comment allez-vous?"')}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Rating buttons */}
        <div className="flex gap-2 sm:gap-3 relative">
          {RATING_BUTTONS.map((label, i) => (
            <motion.div
              key={label}
              className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 ${
                highlightIdx === i
                  ? `${RATING_COLORS[i]} shadow-lg scale-105`
                  : 'bg-card/5 text-muted-foreground border border-white/10'
              }`}
              animate={highlightIdx === i ? { scale: 1.1, y: -2 } : { scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              {label}
            </motion.div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mt-5 w-full max-w-[280px] sm:max-w-sm">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
            <span>{t('preview.mockCards', '12/30 cards')}</span>
            <span className="text-brand/70/70">40%</span>
          </div>
          <div className="w-full h-1.5 bg-card/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: '40%' }}
              transition={{ duration: 1.5, delay: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: Brain, key: 'srs' },
  { icon: BarChart3, key: 'stats' },
  { icon: InfinityIcon, key: 'unlimited' },
] as const

// Delay (seconds) before the mock preview blurs and CTA appears
const REVEAL_DELAY = 2

export function AuthGuardOverlay() {
  const { t } = useTranslation('auth')
  const location = useLocation()
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()
  const currentPath = location.pathname + location.search

  const d = prefersReduced ? 0 : REVEAL_DELAY

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
          className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-brand/15 rounded-full blur-3xl"
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
            className="absolute w-1 h-1 bg-card/30 rounded-full"
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

          {/* Mock browser preview — starts clear, then blurs when CTA appears */}
          {/* Desktop: left side */}
          <div className="hidden lg:block flex-1 max-w-lg">
            <motion.div
              className="relative pointer-events-none"
              initial={{ opacity: 1, filter: 'blur(0px)' }}
              animate={{ opacity: 0.4, filter: 'blur(4px)' }}
              transition={{ duration: 0.8, delay: d, ease: 'easeInOut' }}
            >
              <MockBrowserPreview prefersReduced={!!prefersReduced} />
            </motion.div>
          </div>

          {/* Mobile: centered background */}
          <div className="lg:hidden absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              className="w-[90%] max-w-md"
              initial={{ opacity: 0.8, filter: 'blur(0px)' }}
              animate={{ opacity: 0.15, filter: 'blur(6px)' }}
              transition={{ duration: 0.8, delay: d, ease: 'easeInOut' }}
            >
              <MockBrowserPreview prefersReduced={!!prefersReduced} />
            </motion.div>
          </div>

          {/* CTA Glass Card — fades in after mock blurs */}
          <motion.div
            className="flex-1 max-w-md mx-auto lg:mx-0 relative z-20"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: d + 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="bg-card/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-8 sm:p-10 relative overflow-hidden">
              {/* Inner gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-3xl" />

              <div className="relative flex flex-col items-center text-center">
                {/* Logo with glow */}
                <motion.div
                  className="mb-3"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: d + 0.4, type: 'spring', stiffness: 200, damping: 15 }}
                >
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-brand/30 blur-xl scale-150" />
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
                  transition={{ delay: d + 0.45 }}
                />

                {/* Headline */}
                <motion.h1
                  className="text-3xl sm:text-4xl font-extrabold mb-3 bg-gradient-to-r from-white via-blue-200 to-cyan-200 bg-clip-text text-transparent"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: d + 0.5 }}
                >
                  {t('authGuard.headline')}
                </motion.h1>

                {/* Subtext */}
                <motion.p
                  className="text-blue-200/80 text-sm sm:text-base mb-8 leading-relaxed"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: d + 0.6 }}
                >
                  {t('authGuard.subtext')}
                </motion.p>

                {/* Feature highlights */}
                <div className="flex gap-3 mb-8 w-full">
                  {FEATURES.map((feat, i) => (
                    <motion.div
                      key={feat.key}
                      className="flex-1 bg-card/5 backdrop-blur border border-white/10 rounded-xl p-3 sm:p-4 flex flex-col items-center gap-2"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: d + 0.8 + i * 0.1 }}
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
                  transition={{ duration: 0.5, delay: d + 1.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 animate-[shimmer_3s_infinite]" />
                  <span className="relative">
                    {t('authGuard.ctaButton')}
                  </span>
                </motion.button>

                {/* Secondary button */}
                <motion.button
                  onClick={handleLogin}
                  className="w-full mt-3 rounded-xl py-3 text-sm font-medium text-white/80 bg-card/5 border border-white/20 hover:bg-card/10 transition-colors"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: d + 1.3 }}
                >
                  {t('authGuard.loginButton')}
                </motion.button>

              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          50%, 100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
