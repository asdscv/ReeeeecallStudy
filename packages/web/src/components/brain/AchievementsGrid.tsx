import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Aperture,
  CalendarCheck,
  Crown,
  Eye,
  Flag,
  Flame,
  GraduationCap,
  Hash,
  LayoutGrid,
  Lock,
  Medal,
  RotateCcw,
  Shapes,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { ACHIEVEMENTS, hasAchievement, type AchievementId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

/**
 * Achievements are game facts ("cleared a round without losing a chance") — never streaks of days,
 * volume, totals or anything said about the brain. No screen shows how many there are or how many
 * are earned: that count would be a combined score (EVIDENCE §3).
 */
const ICONS: Record<AchievementId, LucideIcon> = {
  firstClear: Flag,
  cleanRound: ShieldCheck,
  streak10: Flame,
  streak20: Zap,
  flawlessHunt: Hash,
  span7: LayoutGrid,
  quickEyeStage5: Aperture,
  quickEyeStage10: Eye,
  allGames: Shapes,
  firstSession: Sparkles,
  weekGoal: CalendarCheck,
  coreCourse: GraduationCap,
  comeback: RotateCcw,
  goldTier: Medal,
  masterTier: Crown,
}

const GOLD = 'linear-gradient(135deg,#FEF3C7 0%,#F5B400 100%)'

/** Achievements just earned, on a game canvas: one card each, popping in one after another. */
export function AchievementCards({ ids, delayMs = 300 }: { ids: readonly AchievementId[]; delayMs?: number }) {
  const { t } = useTranslation('brain')
  if (ids.length === 0) return null
  return (
    <ul className="space-y-2" aria-label={t('achievements.earned')} data-testid="brain-achievements-earned">
      {ids.map((id, i) => {
        const Icon = ICONS[id]
        return (
          <li
            key={id}
            className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.09] border border-[#FDE68A]/35"
            style={{ animation: `bfx-pop 320ms cubic-bezier(.2,.9,.3,1.4) ${delayMs + i * 160}ms both` }}
          >
            <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-[0_6px_18px_rgba(245,180,0,0.35)]" style={{ background: GOLD }}>
              <Icon className="w-6 h-6 text-[#422006]" aria-hidden="true" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-[#FDE68A]">{t('achievements.earned')}</span>
              <span className="block text-lg font-bold leading-snug">{t(`achievements.${id}.title`)}</span>
              <span className="block text-sm text-white/80">{t(`achievements.${id}.body`)}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * `/brain`'s achievements: every one, earned in colour, the rest dimmed as "not yet". The body
 * says how each is earned — always visible from sm up, a tap away on a phone (and in the tooltip).
 */
export function AchievementsGrid() {
  const { t } = useTranslation('brain')
  const meta = useBrainStore((s) => s.meta)
  const [open, setOpen] = useState<AchievementId | null>(null)
  return (
    <section className="space-y-3" aria-labelledby="brain-achievements">
      <h2 id="brain-achievements" className="text-xl font-bold text-foreground">{t('achievements.title')}</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="brain-achievements">
        {ACHIEVEMENTS.map((id) => {
          const earned = hasAchievement(meta, id)
          const Icon = earned ? ICONS[id] : Lock
          const body = t(`achievements.${id}.body`)
          const expanded = open === id
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : id)}
                title={body}
                aria-expanded={expanded}
                className={`w-full h-full min-h-16 flex items-start gap-2.5 p-3 rounded-2xl border text-left cursor-pointer transition-colors ${
                  earned ? 'bg-card border-[#F5B400]/50 hover:border-[#F5B400]' : 'bg-muted/40 border-border hover:border-muted-foreground/40'
                }`}
                data-testid={`brain-achievement-${id}`}
                data-earned={earned}
              >
                <span
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${earned ? '' : 'bg-muted text-muted-foreground'}`}
                  style={earned ? { background: GOLD } : undefined}
                >
                  <Icon className={`w-5 h-5 ${earned ? 'text-[#422006]' : ''}`} aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-bold leading-snug ${earned ? 'text-foreground' : 'text-muted-foreground'}`}>{t(`achievements.${id}.title`)}</span>
                  {!earned && <span className="block text-xs font-medium text-muted-foreground">{t('achievements.locked')}</span>}
                  <span className={`${expanded ? 'block' : 'hidden'} sm:block mt-0.5 text-xs leading-snug text-muted-foreground`}>{body}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
