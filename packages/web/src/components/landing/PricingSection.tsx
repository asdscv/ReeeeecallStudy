import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ArrowRight, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PAYMENTS_ENABLED } from '../../stores/billing-store'
import { formatProductPrice } from '@reklue/shared/lib/pricing'
import { STUDY_MODES } from '@reklue/shared/lib/study-validation'
import { BRAIN_GAMES } from '@reklue/shared/lib/brain-games/catalog'
import './landing-pricing.css'

const UNLIMITED_THRESHOLD = 1_000_000_000
const SIGNUP_ROUTE = '/auth/login'

interface RawPublicPlan {
  id: string
  title: string
  price_krw: number
  price_usd_cents: number
  card_limit: number
  period: string | null
}

/** Public presentation only. Limits, prices and allowances remain server-owned. */
export function PricingSection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const [plans, setPlans] = useState<RawPublicPlan[]>([])
  const [freeCardLimit, setFreeCardLimit] = useState<number | null>(null)
  const [freeAiCardsPerDay, setFreeAiCardsPerDay] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [catalog, limits] = await Promise.all([
        supabase.rpc('get_public_plans'),
        supabase.rpc('get_plan_limits'),
      ])
      if (!alive) return
      if (!catalog.error && catalog.data) setPlans(catalog.data as RawPublicPlan[])
      const row = limits.data as { free_card_limit?: number | null; free_ai_cards_per_day?: number | null } | null
      if (!limits.error && row?.free_card_limit != null && Number.isFinite(Number(row.free_card_limit))) {
        setFreeCardLimit(Number(row.free_card_limit))
      }
      if (!limits.error && row?.free_ai_cards_per_day != null && Number.isFinite(Number(row.free_ai_cards_per_day))) {
        setFreeAiCardsPerDay(Number(row.free_ai_cards_per_day))
      }
    })()
    return () => { alive = false }
  }, [])

  if (!PAYMENTS_ENABLED) return null

  const limitLine = (cardLimit: number) => cardLimit >= UNLIMITED_THRESHOLD
    ? t('pricing.unlimitedCards')
    : t('pricing.upToCards', { count: cardLimit })
  const freeTier = {
    cardLimitLine: freeCardLimit == null ? '' : limitLine(freeCardLimit),
  }
  const features = [
    t('pricing.features.cards'),
    t('pricing.features.decks'),
    t('pricing.features.study', { count: STUDY_MODES.length }),
    t('pricing.features.brain', { count: BRAIN_GAMES.length }),
    t('pricing.features.history'),
    ...(freeAiCardsPerDay != null && freeAiCardsPerDay > 0
      ? [t('pricing.freeAiCards', { count: freeAiCardsPerDay })] : []),
  ]

  return <section id="pricing" className="rl-free-pricing" aria-labelledby="rl-pricing-title">
    <div className="rl-container">
      <div className="rl-free-pricing-heading">
        <p className="rl-eyebrow">{t('pricing.freeIncludes')}</p>
        <h2 id="rl-pricing-title">{t('pricing.title')}</h2>
        <p>{t('pricing.subtitle')}</p>
      </div>
      <article className="rl-free-plan" aria-labelledby="rl-free-plan-title" data-plan="free">
        <div className="rl-free-plan-summary">
          <span className="rl-free-plan-badge">{t('pricing.freeBadge')}</span>
          <h3 id="rl-free-plan-title">{t('pricing.plans.free')}</h3>
          <p className="rl-free-plan-price">{t('pricing.freePrice')}</p>
          {freeTier.cardLimitLine && <p className="rl-free-plan-capacity">{freeTier.cardLimitLine}</p>}
          <p className="rl-free-plan-description">{t('pricing.plans.freeBlurb')}</p>
          <button type="button" className="rl-free-plan-cta" onClick={() => navigate(SIGNUP_ROUTE)}>{t('pricing.ctaFree')}<ArrowRight size={17} aria-hidden="true" /></button>
        </div>
        <ul className="rl-free-plan-features" aria-label={t('pricing.freeIncludes')}>
          {features.map(feature => <li key={feature}><Check size={18} aria-hidden="true" /><span>{feature}</span></li>)}
        </ul>
      </article>
      <p className="rl-free-pricing-note">{t('pricing.note')}</p>
      {plans.length > 0 && <details className="rl-optional-plans">
        <summary><span>{t('pricing.optionalTitle')}</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <p>{t('pricing.optionalText')}</p>
        <div className="rl-optional-plan-list">
          {plans.map(p => <article key={p.id} className="rl-optional-plan" aria-label={p.title} data-plan="paid">
            <div><h3>{p.title}</h3><p>{t('pricing.pricePerMonth', { price: formatProductPrice({ priceKrw: p.price_krw, priceUsdCents: p.price_usd_cents }) })}</p></div>
            <div><strong>{limitLine(p.card_limit)}</strong><p>{t('pricing.plans.standardBlurb')}</p></div>
            <button type="button" onClick={() => navigate(SIGNUP_ROUTE)}>{t('pricing.ctaPaid')}<ArrowRight size={15} aria-hidden="true" /></button>
          </article>)}
        </div>
      </details>}
    </div>
  </section>
}
