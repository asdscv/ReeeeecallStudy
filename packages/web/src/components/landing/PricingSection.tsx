import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { PAYMENTS_ENABLED } from '../../stores/billing-store'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'

// card_limit >= this sentinel means "unlimited" FOR DISPLAY. As of mig 148 NO catalog
// plan is unlimited (the top plan is capped at 100,000); this only fires for admins,
// whose effective limit stays 2e9 (mig 139). Kept so an admin-facing surface still reads
// "무제한" rather than a huge number.
const UNLIMITED_THRESHOLD = 1_000_000_000
// Free tier is static on the landing (from card_limit_settings; not a catalog row).
const FREE_CARD_LIMIT = 1000
// Existing landing signup/login flow — every landing CTA routes here.
const SIGNUP_ROUTE = '/auth/login'

// Shape returned by get_public_plans() (mig 125) — snake_case JSON, public fields.
interface RawPublicPlan {
  id: string
  title: string
  price_krw: number
  price_usd_cents: number
  card_limit: number
  period: string | null
}

interface Tier {
  key: string
  name: string
  price: string
  cardLimitLine: string
  blurb: string
  cta: string
  featured: boolean
}

export function PricingSection() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()
  const [plans, setPlans] = useState<RawPublicPlan[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_plans')
      if (!alive || error || !data) return
      setPlans(data as RawPublicPlan[])
    })()
    return () => {
      alive = false
    }
  }, [])

  // Belt-and-suspenders: the LandingPage guard already withholds this section
  // when payments are off, but never render if the flag is not 'true'.
  if (!PAYMENTS_ENABLED) return null

  // Price is always USD — the store charges USD everywhere (Toss/₩ dropped).
  const fmtPrice = (p: RawPublicPlan) =>
    formatProductPrice({ priceKrw: p.price_krw, priceUsdCents: p.price_usd_cents })
  const isUnlimited = (cardLimit: number) => cardLimit >= UNLIMITED_THRESHOLD

  // The card-limit line: "무제한 카드" for the sentinel, else "카드 {{count}}장".
  const limitLine = (cardLimit: number) =>
    isUnlimited(cardLimit)
      ? t('pricing.unlimitedCards')
      : t('pricing.upToCards', { count: cardLimit })

  // Free tier is static; paid tiers are fetched (data-driven — a new catalog row
  // appears here automatically). Paid tiers are named by rank (first = Standard, higher
  // = Pro) since the catalog now has two finite card-count plans (5,000 / 100,000) — no
  // "unlimited" plan anymore; the card count itself is shown on the cardLimitLine.
  const freeTier: Tier = {
    key: 'free',
    name: t('pricing.plans.free'),
    price: t('pricing.freePrice'),
    cardLimitLine: limitLine(FREE_CARD_LIMIT),
    blurb: t('pricing.plans.freeBlurb'),
    cta: t('pricing.ctaFree'),
    featured: false,
  }

  const paidTiers: Tier[] = plans.map((p, i) => {
    return {
      key: p.id,
      // Rank-based name: first paid tier = Standard, any higher tier = Pro. (No plan is
      // "unlimited" now; the exact card count is on cardLimitLine below.)
      name: i === 0 ? t('pricing.plans.standard') : t('pricing.plans.pro'),
      price: t('pricing.pricePerMonth', { price: fmtPrice(p) }),
      cardLimitLine: limitLine(p.card_limit),
      blurb: t('pricing.plans.standardBlurb'),
      cta: t('pricing.ctaPaid'),
      // Highlight the first paid tier as the recommended one.
      featured: i === 0,
    }
  })

  const tiers: Tier[] = [freeTier, ...paidTiers]

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08 } },
  }
  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  }

  return (
    <section id="pricing" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-3">
            {t('pricing.title')}
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto">
            {t('pricing.subtitle')}
          </p>
        </div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch"
          variants={prefersReduced ? undefined : container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          {tiers.map((tier) => (
            <motion.div
              key={tier.key}
              variants={prefersReduced ? undefined : item}
              className={`relative flex flex-col bg-card rounded-2xl border p-5 sm:p-6 transition-all duration-300 hover:shadow-sm ${
                tier.featured
                  ? 'border-brand ring-1 ring-brand/40 shadow-sm'
                  : 'border-border hover:border-border/80'
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm">
                  {t('pricing.recommended')}
                </span>
              )}

              <h3 className="text-base font-semibold text-foreground mb-1">{tier.name}</h3>
              <p className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight mb-4">
                {tier.price}
              </p>

              <div className="flex items-center gap-2 text-sm text-foreground mb-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="font-medium">{tier.cardLimitLine}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">{tier.blurb}</p>

              <motion.button
                onClick={() => navigate(SIGNUP_ROUTE)}
                className={`mt-auto inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition cursor-pointer ${
                  tier.featured
                    ? 'bg-brand text-white hover:brightness-110 shadow-sm shadow-blue-600/25'
                    : 'bg-accent text-foreground hover:bg-accent/70'
                }`}
                whileHover={prefersReduced ? undefined : { scale: 1.03 }}
                whileTap={prefersReduced ? undefined : { scale: 0.98 }}
              >
                {tier.cta} <ArrowRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          ))}
        </motion.div>

        <p className="text-center text-xs text-muted-foreground mt-8">{t('pricing.note')}</p>
      </div>
    </section>
  )
}
