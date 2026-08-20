import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Layers, Store, Globe, Repeat, RefreshCw } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { supabase } from '../../lib/supabase'
import { SUPPORTED_LOCALES } from '../../lib/locale-utils'
import { STUDY_MODES } from '@reeeeecall/shared/lib/study-validation'

/**
 * 랜딩의 수치 섹션.
 *
 * 이 자리에 있던 것은 지어낸 값이었습니다 — 활성 사용자 2,500명(실제 36명), 덱 5,000개
 * (실제 703개), 그리고 Math.random() 으로 30초마다 흔들리던 "지금 N명이 공부 중".
 * 여기 있는 네 숫자는 전부 셀 수 있는 값이고, 둘은 서버가(mig 270), 둘은 코드 자체가
 * 셉니다 — `SUPPORTED_LOCALES.length` 와 `STUDY_MODES.length`.
 *
 * 규칙 하나: 값이 없으면 그 칸을 그리지 않습니다. 기본값을 채우는 순간 지금 지운
 * 그것으로 돌아갑니다.
 */
interface PublicStats {
  cards_total: number
  decks_total: number
  listings_total: number
}

/** 큰 숫자는 자릿수가 바뀔 때 폭이 흔들리지 않도록 tabular-nums 로 셉니다. */
function Figure({ end, className }: { end: number; className: string }) {
  const { value, ref } = useCountUp({ end })
  return (
    <p
      ref={ref}
      className={`bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent tabular-nums ${className}`}
    >
      {value.toLocaleString()}
    </p>
  )
}

export function ProofSection() {
  const { t } = useTranslation('landing')
  const prefersReduced = useReducedMotion()
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

  // 코드가 세는 둘은 언제나, 서버가 세는 둘은 값이 왔을 때만.
  const minor = [
    ...(stats
      ? [{ key: 'listings', icon: Store, end: stats.listings_total, label: t('proof.listings') }]
      : []),
    { key: 'languages', icon: Globe, end: SUPPORTED_LOCALES.length, label: t('proof.languages') },
    { key: 'modes', icon: Repeat, end: STUDY_MODES.length, label: t('proof.modes') },
  ]

  return (
    <section id="proof" className="py-16 sm:py-20 md:py-28 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              {!prefersReduced && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/70" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            {t('proof.eyebrow')}
          </span>
          <h2 className="mt-4 text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
            {t('proof.title')}
          </h2>
          <p className="mt-3 text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto">
            {t('proof.subtitle')}
          </p>
        </div>

        <div className="relative">
          {/* 패널 위로 브랜드색을 아주 옅게 깔아 판을 띄웁니다. 장식이라 스크린리더에서 숨깁니다. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-8 -top-12 h-40 bg-[radial-gradient(45%_60%_at_50%_0%,var(--brand),transparent)] opacity-[0.10] blur-2xl"
          />

          <motion.div
            className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-card to-card/40 shadow-sm"
            initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
            whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* 상단 헤어라인 — 판의 윗면에 빛이 닿은 것처럼 */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />

            <div className={`grid ${stats ? 'md:grid-cols-5' : 'grid-cols-2'}`}>
              {stats && (
                <div className="relative md:col-span-3 flex flex-col justify-center border-b md:border-b-0 md:border-r border-border/60 p-6 sm:p-9">
                  {/* 도트 그리드는 오른쪽으로 사라지게 마스킹해서, 숫자 뒤가 아니라 여백에만 남습니다. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 text-border opacity-40 [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_right,black,transparent_80%)]"
                  />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Layers className="w-4 h-4 text-brand" />
                      <span className="text-[13px] font-medium">{t('proof.cards.label')}</span>
                    </div>
                    <Figure
                      end={stats.cards_total}
                      className="mt-4 text-[3.25rem] sm:text-7xl font-semibold tracking-[-0.045em] leading-none"
                    />
                    <p className="mt-4 text-xs sm:text-sm text-muted-foreground">
                      {t('proof.cards.hint')}
                    </p>
                  </div>
                </div>
              )}

              {/* 모바일에서는 세 칸이 가로로, 데스크톱에서는 세 줄로 쌓여 판의 오른쪽을 채웁니다. */}
              <div
                className={`grid grid-cols-3 ${
                  stats ? 'md:col-span-2 md:grid-cols-1' : 'col-span-2 grid-cols-2'
                }`}
              >
                {minor.map((m, i) => (
                  <div
                    key={m.key}
                    className={`p-4 sm:px-6 sm:py-5 flex flex-col gap-2 ${
                      stats ? 'md:flex-row md:items-baseline md:justify-between' : 'items-center text-center'
                    } ${
                      i < minor.length - 1 ? 'border-r md:border-r-0 md:border-b border-border/60' : ''
                    }`}
                  >
                    <span className="flex items-start md:items-center gap-1.5 text-[11px] sm:text-[13px] font-medium leading-tight text-muted-foreground">
                      <m.icon className="w-3.5 h-3.5 shrink-0 mt-px md:mt-0" />
                      {m.label}
                    </span>
                    {/* 모바일에서는 라벨이 두 줄이 되는 칸이 있어, 숫자를 아래로 밀어 밑선을 맞춥니다. */}
                    <Figure
                      end={m.end}
                      className="mt-auto md:mt-0 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
          <RefreshCw className="w-3 h-3" />
          {t('proof.footnote')}
        </p>
      </div>
    </section>
  )
}
