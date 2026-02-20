import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

interface FAQItemProps {
  question: string
  answer: string
}

function FAQItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const prefersReduced = useReducedMotion()

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between cursor-pointer p-5 text-left font-semibold text-gray-900 hover:bg-gray-50 transition bg-transparent border-none"
      >
        <span>{question}</span>
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
          className="shrink-0 ml-4"
        >
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={prefersReduced ? { height: 'auto' } : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={prefersReduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 text-gray-600 leading-relaxed">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
    <section className="py-16 sm:py-24 px-4 bg-gray-50">
      <div className="max-w-3xl mx-auto">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-10 text-center">
            {t('faq.title', 'Frequently Asked Questions')}
          </h2>
        </ScrollReveal>
        <div className="space-y-4">
          {faqItems.map((item, i) => (
            <ScrollReveal key={i} delay={i * 0.08}>
              <FAQItem question={item.question} answer={item.answer} />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}
