import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

export function FloatingCTA() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          onClick={() => navigate('/auth/login')}
          className="group fixed bottom-6 sm:bottom-12 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-16 flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 bg-transparent cursor-pointer z-50 whitespace-nowrap touch-manipulation"
          initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 40 }}
          transition={prefersReduced ? { duration: 0 } : { type: 'spring', damping: 20, stiffness: 200 }}
        >
          <div className="relative">
            <img src="/favicon.png" alt="" className="w-10 h-10 sm:w-14 sm:h-14 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12 active:scale-110 active:rotate-12" />
            <div className="absolute inset-0 bg-blue-500/0 rounded-full blur-xl transition-all duration-300 group-hover:bg-blue-500/40 group-hover:scale-150 group-active:bg-blue-500/40 group-active:scale-150" />
          </div>
          <div className="relative">
            <span className="text-lg sm:text-2xl font-bold text-gray-900 relative z-10 transition-all duration-300 group-hover:text-blue-600 group-hover:tracking-wider group-active:text-blue-600 group-active:tracking-wider">{t('floatingCta')}</span>
            <div className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-500 rounded-full transition-all duration-300 group-hover:w-full group-hover:shadow-[0_0_10px_rgba(59,130,246,0.6)] group-active:w-full group-active:shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
