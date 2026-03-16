import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Zap } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

export function HeroSection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()

  const goLogin = () => navigate('/auth/login')

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.12 } },
  }

  const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
  }

  return (
    <section className="relative py-12 sm:py-16 md:py-24 px-4 overflow-hidden">
      {/* Floating decorative blobs */}
      {!prefersReduced && (
        <>
          <motion.div
            className="absolute -top-20 -left-20 w-40 sm:w-72 h-40 sm:h-72 bg-blue-400 rounded-full blur-3xl opacity-15 sm:opacity-20"
            animate={{ y: [0, -30, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-20 -right-20 w-48 sm:w-80 h-48 sm:h-80 bg-purple-400 rounded-full blur-3xl opacity-15 sm:opacity-20"
            animate={{ y: [0, 30, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}

      <motion.div
        className="max-w-4xl mx-auto text-center relative z-10"
        variants={prefersReduced ? undefined : container}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={prefersReduced ? undefined : fadeUp}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-full mb-6">
            <Zap className="w-4 h-4" />
            {t('hero.badge')}
          </div>
        </motion.div>

        <motion.h1
          variants={prefersReduced ? undefined : fadeUp}
          className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-4 sm:mb-6"
        >
          {t('hero.title1')}
          <br />
          <span className="bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient-shift_4s_ease-in-out_infinite]">
            {t('hero.title2')}
          </span>
        </motion.h1>

        <motion.p
          variants={prefersReduced ? undefined : fadeUp}
          className="text-base sm:text-lg md:text-xl text-gray-500 max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed"
        >
          {t('hero.subtitle1')}
          <br className="hidden sm:block" />
          {t('hero.subtitle2')}
        </motion.p>

        <motion.div
          variants={prefersReduced ? undefined : fadeUp}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
        >
          <motion.button
            onClick={goLogin}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-blue-600 text-white text-base font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            whileHover={prefersReduced ? undefined : { scale: 1.05, boxShadow: '0 20px 40px rgba(37,99,235,0.3)' }}
            whileTap={prefersReduced ? undefined : { scale: 0.98 }}
          >
            {t('hero.cta.start')} <ArrowRight className="w-5 h-5" />
          </motion.button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="w-full sm:w-auto px-8 py-3.5 border border-gray-300 text-gray-700 text-base font-medium rounded-xl hover:bg-gray-50 transition cursor-pointer"
          >
            {t('hero.cta.learn')}
          </button>
        </motion.div>

        {/* spacer */}
        <div className="mt-6" />
      </motion.div>
    </section>
  )
}
