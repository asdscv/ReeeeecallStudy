import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Layers, Store, Globe, Repeat } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { supabase } from '../../lib/supabase'
import { SUPPORTED_LOCALES } from '../../lib/locale-utils'
import { STUDY_MODES } from '@reeeeecall/shared/lib/study-validation'

/**
 * 랜딩의 수치 섹션.
 *
 * 이 자리에 있던 것은 지어낸 값이었습니다 — 활성 사용자 2,500명(실제 36명), 덱 5,000개
 * (실제 703명이 아니라 703개), 그리고 Math.random() 으로 30초마다 흔들리던 "지금 N명이
 * 공부 중". 여기 있는 네 숫자는 전부 셀 수 있는 값이고, 둘은 서버가(mig 270), 둘은
 * 코드 자체가 셉니다.
 *
 * 규칙 하나: 값이 없으면 그 타일을 그리지 않습니다. 기본값을 채우는 순간 지금 지운
 * 그것으로 돌아갑니다.
 */
interface PublicStats {
  cards_total: number
  decks_total: number
  listings_total: number
}

function Tile({
  icon: Icon,
  end,
  label,
  hint,
  delay,
}: {
  icon: typeof Layers
  end: number
  label: string
  hint: string
  delay: number
}) {
  const { value, ref } = useCountUp({ end })
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      ref={ref}
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6 text-center"
      initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
      <Icon className="w-5 h-5 mx-auto mb-3 text-brand" />
      <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground tabular-nums">
        {value.toLocaleString()}
      </p>
      <p className="text-sm font-semibold text-foreground mt-2">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </motion.div>
  )
}

export function ProofSection() {
  const { t } = useTranslation('landing')
  const [stats, setStats] = useState<PublicStats | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_stats')
      if (!alive || error || !data) return
      setStats(data as PublicStats)
    })()
    return () => {
      alive = false
    }
  }, [])

  // 서버가 세는 둘은 값이 왔을 때만, 코드가 세는 둘은 언제나 그립니다.
  const tiles = [
    ...(stats
      ? [
          {
            key: 'cards',
            icon: Layers,
            end: stats.cards_total,
            label: t('proof.cards.label'),
            hint: t('proof.cards.hint'),
          },
          {
            key: 'listings',
            icon: Store,
            end: stats.listings_total,
            label: t('proof.listings.label'),
            hint: t('proof.listings.hint'),
          },
        ]
      : []),
    {
      key: 'languages',
      icon: Globe,
      end: SUPPORTED_LOCALES.length,
      label: t('proof.languages.label'),
      hint: t('proof.languages.hint'),
    },
    {
      key: 'modes',
      icon: Repeat,
      end: STUDY_MODES.length,
      label: t('proof.modes.label'),
      hint: t('proof.modes.hint'),
    },
  ]

  return (
    <section id="proof" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-3">
            {t('proof.title')}
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto">
            {t('proof.subtitle')}
          </p>
        </div>

        <div
          className={`grid gap-4 sm:gap-5 ${
            tiles.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'
          }`}
        >
          {tiles.map((tile, i) => (
            <Tile
              key={tile.key}
              icon={tile.icon}
              end={tile.end}
              label={tile.label}
              hint={tile.hint}
              delay={i * 0.08}
            />
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">{t('proof.footnote')}</p>
      </div>
    </section>
  )
}
