import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Minus } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

function FAQItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      initial={prefersReduced ? undefined : { opacity: 0, y: 12 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-start justify-between gap-4 py-5 text-left cursor-pointer bg-transparent border-none group"
      >
        <span className="text-base sm:text-lg font-medium text-foreground group-hover:text-brand transition-colors leading-snug">
          {question}
        </span>
        <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full border border-border flex items-center justify-center group-hover:border-brand/40 transition-colors">
          {isOpen ? (
            <Minus className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={prefersReduced ? { height: 'auto' } : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={prefersReduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-sm sm:text-base text-muted-foreground leading-relaxed pr-10">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </motion.div>
  )
}

export function FAQSection() {
  const { t } = useTranslation('landing')

  const faqItems = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
  ]

  return (
    <section id="faq" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-2xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-10 sm:mb-14">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
              {t('faq.title', 'Frequently Asked Questions')}
            </h2>
          </div>
        </ScrollReveal>

        <div>
          {faqItems.map((item, i) => (
            <FAQItem key={i} question={item.question} answer={item.answer} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
