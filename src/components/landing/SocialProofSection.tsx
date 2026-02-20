import { useMemo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Star, Quote } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { ScrollReveal } from './ScrollReveal'
import { REVIEWS, type Review, type Lang } from './reviews-data'

// ── Counter ──
const COUNTER_ITEMS = [
  { key: 'userCount', end: 2500 },
  { key: 'cardsStudied', end: 150000 },
  { key: 'decksCreated', end: 5000 },
]

function Counter({ endValue, displayLabel, delay }: { endValue: number; displayLabel: string; delay: number }) {
  const { value, ref } = useCountUp({ end: endValue })
  const prefersReduced = useReducedMotion()

  const formatted = value >= 1000
    ? `${Math.floor(value / 1000)},${String(value % 1000).padStart(3, '0')}+`
    : `${value}+`

  return (
    <motion.div
      ref={ref}
      className="text-center"
      initial={prefersReduced ? undefined : { opacity: 0, y: 20 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
    >
      <p className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900">{formatted}</p>
      <p className="text-xs sm:text-sm text-gray-500 mt-1">{displayLabel}</p>
    </motion.div>
  )
}

// ── Review Card ──
function ReviewCard({ review, lang }: { review: Review; lang: Lang }) {
  const initial = review.author[lang].charAt(0)

  return (
    <div className="w-[260px] sm:w-[300px] md:w-[340px] flex-shrink-0 group relative">
      <div className="h-full bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden">
        {/* Accent gradient bar */}
        <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${review.color}`} />

        {/* Quote icon */}
        <Quote className="w-6 h-6 sm:w-8 sm:h-8 text-gray-100 absolute top-3 right-3 sm:top-4 sm:right-4" />

        {/* Stars */}
        <div className="flex gap-0.5 mb-2 sm:mb-3">
          {Array.from({ length: review.rating }, (_, i) => (
            <Star key={i} className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-yellow-400 text-yellow-400" />
          ))}
          {Array.from({ length: 5 - review.rating }, (_, i) => (
            <Star key={`e-${i}`} className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-gray-100 text-gray-200" />
          ))}
        </div>

        {/* Quote */}
        <p className="text-xs sm:text-sm text-gray-700 leading-relaxed mb-3 sm:mb-4 line-clamp-3 relative z-10 min-h-[3rem] sm:min-h-[3.5rem]">
          &ldquo;{review.quote[lang]}&rdquo;
        </p>

        {/* Author */}
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br ${review.color} flex items-center justify-center text-white text-[10px] sm:text-xs font-bold shadow-sm`}>
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">{review.author[lang]}</p>
            <p className="text-[10px] sm:text-xs text-gray-400 truncate">{review.role[lang]}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Marquee Row ──
function MarqueeRow({ reviews, direction, speed, lang }: {
  reviews: Review[]
  direction: 'left' | 'right'
  speed: number
  lang: Lang
}) {
  const doubled = useMemo(() => [...reviews, ...reviews], [reviews])
  const animName = direction === 'left' ? 'marquee-left' : 'marquee-right'

  return (
    <div className="overflow-hidden marquee-container">
      <div
        className="flex gap-3 sm:gap-4 w-max"
        style={{
          animation: `${animName} ${speed}s linear infinite`,
        }}
      >
        {doubled.map((review, i) => (
          <ReviewCard key={`${direction}-${i}`} review={review} lang={lang} />
        ))}
      </div>
    </div>
  )
}

// ── Live Activity Badge ──
function LiveActivityBadge() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const [count, setCount] = useState(() => Math.floor(Math.random() * 37) + 12) // 12-48

  const fluctuate = useCallback(() => {
    setCount((prev) => {
      const delta = Math.floor(Math.random() * 3) + 1
      const direction = Math.random() > 0.5 ? 1 : -1
      const next = prev + delta * direction
      return Math.max(12, Math.min(48, next))
    })
  }, [])

  useEffect(() => {
    const interval = setInterval(fluctuate, 30000)
    return () => clearInterval(interval)
  }, [fluctuate])

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full text-sm text-green-700">
      <span
        className={`w-2 h-2 rounded-full bg-green-500 ${prefersReduced ? '' : 'animate-pulse'}`}
      />
      <span>{t('socialProof.liveActivity', '{{count}} people studying right now', { count })}</span>
    </div>
  )
}

// ── Main Section ──
export function SocialProofSection() {
  const { t, i18n } = useTranslation('landing')
  const lang = (i18n.language?.substring(0, 2) || 'en') as Lang
  const safeLang: Lang = ['en', 'ko', 'ja', 'zh'].includes(lang) ? lang : 'en'

  const row1 = REVIEWS.slice(0, 50)
  const row2 = REVIEWS.slice(50, 100)

  return (
    <section id="social-proof" className="py-12 sm:py-16 md:py-24 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4">
        <ScrollReveal>
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 mb-3 sm:mb-4">
              {t('socialProof.title', 'Trusted by Learners Worldwide')}
            </h2>
            <p className="text-gray-500 text-sm sm:text-base md:text-lg max-w-2xl mx-auto">
              {t('socialProof.subtitle', 'Join thousands of students studying smarter')}
            </p>
          </div>
        </ScrollReveal>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {COUNTER_ITEMS.map((item, i) => (
            <Counter
              key={item.key}
              endValue={item.end}
              displayLabel={t(`socialProof.${item.key}Label`, item.key)}
              delay={i * 0.15}
            />
          ))}
        </div>

        {/* Live activity badge */}
        <div className="flex justify-center mb-8 sm:mb-10">
          <LiveActivityBadge />
        </div>
      </div>

      {/* Marquee rows - full width, no padding */}
      <div className="space-y-3 sm:space-y-4">
        <MarqueeRow reviews={row1} direction="left" speed={120} lang={safeLang} />
        <MarqueeRow reviews={row2} direction="right" speed={130} lang={safeLang} />
      </div>
    </section>
  )
}
