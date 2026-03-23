import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

export function FloatingCTA() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          onClick={() => navigate('/auth/login')}
          className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 z-50 inline-flex items-center gap-2 px-5 py-3 bg-brand text-white text-sm font-semibold rounded-full shadow-lg shadow-blue-600/25 hover:brightness-110 transition cursor-pointer"
          initial={prefersReduced ? { opacity: 1 } : { opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
          transition={prefersReduced ? { duration: 0 } : { type: 'spring', damping: 20, stiffness: 200 }}
          whileHover={prefersReduced ? undefined : { scale: 1.05 }}
          whileTap={prefersReduced ? undefined : { scale: 0.95 }}
        >
          {t('floatingCta')}
          <ArrowRight className="w-4 h-4" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
