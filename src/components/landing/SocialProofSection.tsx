import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { useCountUp } from '../../hooks/useCountUp'
import { ScrollReveal } from './ScrollReveal'

const COUNTER_ITEMS = [
  { key: 'userCount', end: 2500 },
  { key: 'cardsStudied', end: 150000 },
  { key: 'decksCreated', end: 5000 },
]

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
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
      <p className="text-3xl sm:text-4xl font-extrabold text-gray-900">{formatted}</p>
      <p className="text-sm text-gray-500 mt-1">{displayLabel}</p>
    </motion.div>
  )
}

export function SocialProofSection() {
  const { t } = useTranslation('landing')

  const testimonials = [0, 1, 2].map((i) => ({
    quote: t(`socialProof.testimonials.${i}.quote`, ''),
    author: t(`socialProof.testimonials.${i}.author`, ''),
    role: t(`socialProof.testimonials.${i}.role`, ''),
  }))

  return (
    <section className="py-16 sm:py-24 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {t('socialProof.title', 'Trusted by Learners Worldwide')}
            </h2>
            <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
              {t('socialProof.subtitle', 'Join thousands of students studying smarter')}
            </p>
          </div>
        </ScrollReveal>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-6 mb-14">
          {COUNTER_ITEMS.map((item, i) => (
            <Counter
              key={item.key}
              endValue={item.end}
              displayLabel={t(`socialProof.${item.key}Label`, item.key)}
              delay={i * 0.15}
            />
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {testimonials.map((testimonial, i) => (
            <ScrollReveal key={i} delay={i * 0.15}>
              <div className="bg-white rounded-xl border border-gray-200 p-6 h-full">
                <p className="text-gray-600 leading-relaxed mb-5 italic">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${AVATAR_COLORS[i]} flex items-center justify-center text-white font-bold text-sm`}>
                    {testimonial.author.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{testimonial.author}</p>
                    <p className="text-xs text-gray-400">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}
