import { useTranslation } from 'react-i18next'
import { Brain, Zap, Moon, Shuffle, TrendingDown, TrendingUp, FlaskConical, GraduationCap, BookOpen } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { ScrollReveal } from './ScrollReveal'

/* ───────────────────────────────────────────
   Forgetting Curve vs SRS — animated bar chart
   ─────────────────────────────────────────── */

const CURVE_DATA = [
  { day: '1d', cramming: 90, srs: 95 },
  { day: '3d', cramming: 60, srs: 92 },
  { day: '7d', cramming: 35, srs: 88 },
  { day: '14d', cramming: 20, srs: 85 },
  { day: '30d', cramming: 10, srs: 82 },
  { day: '90d', cramming: 5, srs: 78 },
]

function RetentionChart() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-foreground">
            {t('science.chart.title', 'Memory Retention Over Time')}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t('science.chart.subtitle', 'Traditional cramming vs. spaced repetition')}
          </p>
        </div>
        <FlaskConical className="w-5 h-5 text-muted-foreground hidden sm:block" />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-red-400 to-red-500" />
          <span className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
            <TrendingDown className="w-3 h-3" />
            {t('science.chart.cramming', 'Cramming')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-blue-500 to-cyan-400" />
          <span className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {t('science.chart.srs', 'Spaced Repetition')}
          </span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="space-y-3 sm:space-y-4">
        {CURVE_DATA.map((d, i) => (
          <div key={d.day} className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs font-mono text-muted-foreground w-8 sm:w-10 text-right shrink-0">
              {d.day}
            </span>
            <div className="flex-1 space-y-1.5">
              {/* Cramming bar */}
              <div className="h-2.5 sm:h-3 bg-accent rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-red-400 to-red-500"
                  initial={{ width: 0 }}
                  whileInView={{ width: `${d.cramming}%` }}
                  viewport={{ once: true }}
                  transition={prefersReduced ? { duration: 0 } : { duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
                />
              </div>
              {/* SRS bar */}
              <div className="h-2.5 sm:h-3 bg-accent rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                  initial={{ width: 0 }}
                  whileInView={{ width: `${d.srs}%` }}
                  viewport={{ once: true }}
                  transition={prefersReduced ? { duration: 0 } : { duration: 0.8, delay: i * 0.1 + 0.1, ease: 'easeOut' }}
                />
              </div>
            </div>
            <div className="text-right shrink-0 w-16 sm:w-20">
              <span className="text-xs font-semibold text-red-500">{d.cramming}%</span>
              <span className="text-xs text-muted-foreground mx-1">/</span>
              <span className="text-xs font-semibold text-blue-500">{d.srs}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      <div className="mt-4 sm:mt-6 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          {t('science.chart.note', 'Based on Ebbinghaus forgetting curve research and spaced repetition studies. SRS reviews at optimal intervals maintain 78%+ retention even after 90 days.')}
        </p>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────
   Research-backed principle cards
   ─────────────────────────────────────────── */

interface PrincipleCardProps {
  icon: React.ElementType
  iconGradient: string
  iconBg: string
  title: string
  description: string
  source: string
  delay: number
}

function PrincipleCard({ icon: Icon, iconGradient, iconBg, title, description, source, delay }: PrincipleCardProps) {
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      className="bg-card rounded-2xl border border-border p-5 sm:p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group"
      initial={prefersReduced ? undefined : { opacity: 0, y: 30 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${iconGradient} text-white shadow-lg shadow-${iconBg}/20`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{description}</p>
      <div className="flex items-center gap-1.5">
        <BookOpen className="w-3.5 h-3.5 text-content-tertiary" />
        <span className="text-xs text-content-tertiary italic">{source}</span>
      </div>
    </motion.div>
  )
}

/* ───────────────────────────────────────────
   Main Section
   ─────────────────────────────────────────── */

export function ScienceSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()

  const principles = [
    {
      icon: Brain,
      iconGradient: 'from-blue-600 to-cyan-500',
      iconBg: 'blue-600',
      titleKey: 'science.principles.spacing.title',
      titleFallback: 'Spacing Effect',
      descKey: 'science.principles.spacing.desc',
      descFallback: 'Spreading study sessions over time dramatically improves long-term retention. Our SRS algorithm calculates the optimal moment for each review — right before you forget.',
      sourceKey: 'science.principles.spacing.source',
      sourceFallback: 'Ebbinghaus (1885), Cepeda et al. (2006)',
    },
    {
      icon: Zap,
      iconGradient: 'from-amber-500 to-orange-500',
      iconBg: 'amber-500',
      titleKey: 'science.principles.retrieval.title',
      titleFallback: 'Active Recall',
      descKey: 'science.principles.retrieval.desc',
      descFallback: 'Testing yourself strengthens memory far more than re-reading. Every card flip is a retrieval practice trial that reinforces neural pathways.',
      sourceKey: 'science.principles.retrieval.source',
      sourceFallback: 'Roediger & Karpicke (2006)',
    },
    {
      icon: Moon,
      iconGradient: 'from-violet-600 to-purple-500',
      iconBg: 'violet-600',
      titleKey: 'science.principles.consolidation.title',
      titleFallback: 'Sleep Consolidation',
      descKey: 'science.principles.consolidation.desc',
      descFallback: 'During sleep, your brain replays and consolidates memories. Our day-boundary system ensures reviews align with your natural sleep-wake cycle for maximum retention.',
      sourceKey: 'science.principles.consolidation.source',
      sourceFallback: 'Diekelmann & Born (2010)',
    },
    {
      icon: Shuffle,
      iconGradient: 'from-emerald-500 to-teal-500',
      iconBg: 'emerald-500',
      titleKey: 'science.principles.interleaving.title',
      titleFallback: 'Interleaving',
      descKey: 'science.principles.interleaving.desc',
      descFallback: 'Mixing different topics during study improves discrimination and transfer. Our multi-mode system supports interleaved practice across decks and categories.',
      sourceKey: 'science.principles.interleaving.source',
      sourceFallback: 'Bjork & Bjork (2011)',
    },
    {
      icon: GraduationCap,
      iconGradient: 'from-pink-500 to-rose-500',
      iconBg: 'pink-500',
      titleKey: 'science.principles.difficulty.title',
      titleFallback: 'Desirable Difficulties',
      descKey: 'science.principles.difficulty.desc',
      descFallback: 'Making retrieval slightly harder paradoxically strengthens memory. The 4-level rating system (Again/Hard/Good/Easy) creates the right challenge level for each card.',
      sourceKey: 'science.principles.difficulty.source',
      sourceFallback: 'Bjork (1994)',
    },
    {
      icon: FlaskConical,
      iconGradient: 'from-sky-500 to-blue-500',
      iconBg: 'sky-500',
      titleKey: 'science.principles.adaptive.title',
      titleFallback: 'Adaptive Scheduling',
      descKey: 'science.principles.adaptive.desc',
      descFallback: 'Each card adapts independently based on your performance. Easy cards space out to months; difficult cards stay close until mastered.',
      sourceKey: 'science.principles.adaptive.source',
      sourceFallback: 'Lindsey et al. (2014)',
    },
  ]

  return (
    <section id="science" className="py-12 sm:py-16 md:py-24 px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto relative">
        {/* Section header */}
        <ScrollReveal>
          <div className="text-center mb-10 sm:mb-14 md:mb-16">
            <motion.div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-600 text-xs sm:text-sm font-medium mb-4"
              initial={prefersReduced ? undefined : { opacity: 0, scale: 0.9 }}
              whileInView={prefersReduced ? undefined : { opacity: 1, scale: 1 }}
              viewport={{ once: true }}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              {t('science.badge', 'Evidence-Based Learning')}
            </motion.div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground mb-3 sm:mb-4">
              {t('science.title', 'Built on Cognitive Science')}
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              {t('science.subtitle', 'Every feature in ReeeeecallStudy is grounded in decades of peer-reviewed research in memory, learning, and neuroscience.')}
            </p>
          </div>
        </ScrollReveal>

        {/* Two-column layout: chart + principles */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 md:gap-10 mb-10 sm:mb-14">
          {/* Left: Retention chart */}
          <ScrollReveal direction="left">
            <RetentionChart />
          </ScrollReveal>

          {/* Right: Key insight card */}
          <ScrollReveal direction="right">
            <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl p-6 sm:p-8 text-white h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                    <Brain className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-medium text-blue-200">
                    {t('science.insight.badge', 'The Science')}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold mb-4 leading-tight">
                  {t('science.insight.title', 'Why does spaced repetition work?')}
                </h3>
                <p className="text-sm sm:text-base text-blue-100 leading-relaxed mb-4">
                  {t('science.insight.p1', 'When you recall information at increasing intervals, each successful retrieval strengthens the neural pathway. This process — called memory consolidation — transforms fragile short-term memories into durable long-term knowledge.')}
                </p>
                <p className="text-sm sm:text-base text-blue-100 leading-relaxed">
                  {t('science.insight.p2', 'The key insight: reviewing too early wastes time, reviewing too late means relearning from scratch. SRS finds the sweet spot — reviewing right before you forget — maximizing retention with minimum effort.')}
                </p>
              </div>

              {/* Bottom stats */}
              <div className="grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/15">
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-extrabold">78%</p>
                  <p className="text-xs text-blue-200 mt-1">{t('science.insight.stat1', '90-day retention')}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-extrabold">50%</p>
                  <p className="text-xs text-blue-200 mt-1">{t('science.insight.stat2', 'less study time')}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-extrabold">4x</p>
                  <p className="text-xs text-blue-200 mt-1">{t('science.insight.stat3', 'faster mastery')}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>

        {/* Research-backed principles grid */}
        <ScrollReveal>
          <h3 className="text-xl sm:text-2xl font-bold text-foreground text-center mb-6 sm:mb-8">
            {t('science.principlesTitle', '6 Research-Backed Principles Powering Your Learning')}
          </h3>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
          {principles.map((p, i) => (
            <PrincipleCard
              key={p.titleKey}
              icon={p.icon}
              iconGradient={p.iconGradient}
              iconBg={p.iconBg}
              title={t(p.titleKey, p.titleFallback)}
              description={t(p.descKey, p.descFallback)}
              source={t(p.sourceKey, p.sourceFallback)}
              delay={i * 0.1}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
