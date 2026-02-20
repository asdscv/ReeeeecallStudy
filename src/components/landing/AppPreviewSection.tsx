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
    <section className="px-4 pb-12 sm:pb-16 md:pb-24">
      <ScrollReveal>
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 border-b border-gray-700">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div className="ml-3 px-3 py-1 bg-gray-700 rounded text-xs text-gray-300 font-mono">
                ReeeeecallStudy
              </div>
            </div>

            {/* Content area */}
            <div className="p-6 sm:p-10 flex flex-col items-center">
              {/* Flashcard with flip */}
              <div className="w-full max-w-[280px] sm:max-w-sm h-40 sm:h-48 [perspective:1000px] mb-4 sm:mb-6">
                <motion.div
                  className="relative w-full h-full [transform-style:preserve-3d]"
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ duration: 0.6, ease: 'easeInOut' }}
                >
                  {/* Front */}
                  <div className="absolute inset-0 [backface-visibility:hidden] bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center p-6">
                    <p className="text-2xl sm:text-3xl font-bold text-white">
                      {t('preview.mockFront', 'Hello')}
                    </p>
                  </div>
                  {/* Back */}
                  <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center p-6">
                    <p className="text-2xl sm:text-3xl font-bold text-white">
                      {t('preview.mockBack', 'Bonjour')}
                    </p>
                  </div>
                </motion.div>
              </div>

              {/* Rating buttons */}
              <div className="flex gap-2 sm:gap-3 mb-5">
                {RATING_BUTTONS.map((label, i) => (
                  <div
                    key={label}
                    className={`px-3 sm:px-5 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                      highlightIdx === i
                        ? RATING_COLORS[i]
                        : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Status bar */}
              <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-400">
                <span>{t('preview.mockCards', '12/30 cards')}</span>
                <span className="w-1 h-1 rounded-full bg-gray-600" />
                <span>{t('preview.mockStreak', 'Streak: 7 days')}</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  )
}
