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
    <section className="relative py-16 sm:py-20 md:py-28 lg:py-32 px-4 overflow-hidden">
      {/* Dot grid pattern background */}
      <div
        className="absolute inset-0 opacity-[0.4] dark:opacity-[0.15]"
        aria-hidden
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(var(--color-border)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Radial gradient fade — masks edges of dot grid */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 50%, transparent 30%, hsl(var(--card)) 70%)',
        }}
      />

      {/* Floating decorative blobs */}
      {!prefersReduced && (
        <>
          <motion.div
            className="absolute top-1/4 -left-20 w-72 h-72 bg-brand rounded-full blur-[100px] opacity-[0.08]"
            animate={{ y: [0, -30, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-1/4 -right-20 w-80 h-80 bg-violet-500 rounded-full blur-[100px] opacity-[0.06]"
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
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand/10 text-brand text-xs sm:text-sm font-medium rounded-full mb-6 border border-brand/20">
            <Zap className="w-3.5 h-3.5" />
            {t('hero.badge')}
          </div>
        </motion.div>

        <motion.h1
          variants={prefersReduced ? undefined : fadeUp}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-foreground leading-[1.1] tracking-tight mb-5 sm:mb-6"
        >
          {t('hero.title1')}
          <br />
          <span className="bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient-shift_4s_ease-in-out_infinite]">
            {t('hero.title2')}
          </span>
        </motion.h1>

        <motion.p
          variants={prefersReduced ? undefined : fadeUp}
          className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 sm:mb-12 leading-relaxed"
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
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-brand text-white text-base font-semibold rounded-xl hover:brightness-110 transition shadow-lg shadow-blue-600/25 cursor-pointer"
            whileHover={prefersReduced ? undefined : { scale: 1.04, boxShadow: '0 20px 40px rgba(37,99,235,0.3)' }}
            whileTap={prefersReduced ? undefined : { scale: 0.98 }}
          >
            {t('hero.cta.start')} <ArrowRight className="w-5 h-5" />
          </motion.button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="w-full sm:w-auto px-8 py-3.5 border border-border text-foreground text-base font-medium rounded-xl hover:bg-muted transition cursor-pointer bg-transparent"
          >
            {t('hero.cta.learn')}
          </button>
        </motion.div>
      </motion.div>
    </section>
  )
}
