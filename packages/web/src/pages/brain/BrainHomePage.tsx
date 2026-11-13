import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings, Play, ChevronRight, BookOpen, Trophy, Clock, Sparkles } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  BRAIN_GAMES,
  GAME_THEMES,
  TRAINING_THEME,
  courseStatus,
  createRng,
  displayLevel,
  gameHistory,
  gameProgress,
  localDayKey,
  planTodaysSession,
  plannedMinutes,
  researchContent,
  todaysPlanSeed,
  weekProgress,
} from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BRAIN_ICONS, cardBackground } from '../../components/brain/brain-ui'
import { BrainSettingsDialog } from '../../components/brain/BrainSettingsDialog'
import { Sparkline } from '../../components/brain/RoundSummary'
import { WeekRing } from '../../components/brain/WeekRing'
import { TierBadge, TierBar } from '../../components/brain/TierBadge'
import { AchievementsGrid } from '../../components/brain/AchievementsGrid'
import { quickEyeSpeedLevel, tierStanding } from '../../components/brain/tier-ui'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'

/**
 * `/brain` — Today's Training first (the bounded session the research counts), every game below
 * as its own card in its own colours, then the research basis and the disclaimer. Progress is
 * shown as sessions this week and course steps, never as a streak or a "brain score".
 */
export function BrainHomePage() {
  const { t, i18n } = useTranslation('brain')
  useBrainHydrated()
  const progress = useBrainStore((s) => s.progress)
  const history = useBrainStore((s) => s.history)
  const meta = useBrainStore((s) => s.meta)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const plan = planTodaysSession(progress, createRng(todaysPlanSeed(progress, today)))
  const minutes = plannedMinutes(plan)
  const research = researchContent(i18n.language)

  const courseChip =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : course.phase === 'core'
        ? t('training.course', { done: course.coreDone, total: course.coreTotal })
        : course.nextBoosterOn
          ? t('training.boosterNext', { date: course.nextBoosterOn })
          : null
  const courseFrac = course.phase === 'booster' && course.booster ? course.booster.done / course.booster.total : course.phase === 'core' ? course.coreDone / course.coreTotal : 1

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-base text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('home.settings')}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-accent border-none bg-transparent cursor-pointer"
          data-testid="brain-settings"
        >
          <Settings className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Today's Training — the hero. */}
      <section
        className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white shadow-[0_20px_50px_-20px_rgba(49,46,129,0.6)]"
        style={{ background: cardBackground(TRAINING_THEME) }}
        data-testid="brain-training-card"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full opacity-40 blur-2xl" style={{ background: 'radial-gradient(circle, #A5B4FC 0%, transparent 65%)' }} />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wider text-white/75">{t('training.kicker')}</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{t('training.title')}</h2>
            <p className="mt-1 text-base text-white/85">{t('training.desc', { minutes })}</p>
          </div>
          <WeekRing done={week.done} goal={week.goal} size={88} label={t('training.week', { done: week.done, goal: week.goal })} />
        </div>

        <ul className="relative mt-5 flex items-center gap-2" aria-label={t('training.lineup')}>
          {plan.map((slot, i) => {
            const Icon = BRAIN_ICONS[BRAIN_GAMES.find((g) => g.id === slot.gameId)?.icon ?? '']
            return (
              <li key={i} className="flex items-center gap-2 min-w-0">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-white/30" style={{ background: cardBackground(GAME_THEMES[slot.gameId]) }} title={t(`games.${slot.gameId}.name`)}>
                  {Icon && <Icon className="w-5 h-5 text-white" aria-hidden="true" />}
                  <span className="sr-only">{t(`games.${slot.gameId}.name`)}</span>
                </span>
                {i < plan.length - 1 && <span className="w-3 h-0.5 rounded-full bg-white/40" aria-hidden="true" />}
              </li>
            )
          })}
        </ul>

        <Link
          to="/brain/training"
          className="relative mt-6 flex items-center justify-center gap-2 min-h-14 rounded-2xl bg-white text-lg font-extrabold no-underline shadow-[0_10px_30px_rgba(0,0,0,0.25)] hover:scale-[1.01] active:scale-[0.99] transition-transform"
          style={{ color: TRAINING_THEME.cardTo }}
          data-testid="brain-training-start"
        >
          <Play className="w-5 h-5 fill-current" aria-hidden="true" />
          {t('training.start')}
        </Link>

        <div className="relative mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {courseChip && (
            <div>
              <p className="font-semibold text-white/90">{courseChip}</p>
              <div className="mt-1.5 h-2 rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(4, courseFrac * 100)}%` }} />
              </div>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-white/85 sm:justify-end">
            <Clock className="w-4 h-4" aria-hidden="true" />
            {progress.sessions.minutes > 0 ? t('training.minutes', { value: formatCount(progress.sessions.minutes) }) : t('training.dose')}
          </p>
        </div>
      </section>

      {/* Every game, in its own colours. */}
      <section className="space-y-3" aria-labelledby="brain-free-play">
        <div>
          <h2 id="brain-free-play" className="text-xl font-bold text-foreground">{t('home.freePlay')}</h2>
          <p className="text-base text-muted-foreground mt-0.5">{t('home.freePlayHint')}</p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BRAIN_GAMES.map((game) => {
            const Icon = BRAIN_ICONS[game.icon]
            const theme = GAME_THEMES[game.id]
            const p = gameProgress(progress, game.id)
            const standing = tierStanding(game.id, meta, progress)
            const played = p.rounds > 0 || standing.tier > 0
            // A placement left part-way (n = 0) has no level yet: shown like a game never played —
            // "new", no level and no tier bar — never its interim probe level. A tier earned stays.
            const placing = meta.sk[game.id]?.n === 0
            const fresh = !played || (placing && standing.tier === 0)
            const qe = game.id === 'quickEye'
            const best = progress.bestRuns[game.id]
            const trend = gameHistory(history, game.id).map((h) => h.level)
            const levelLabel = qe
              ? t('home.quickEyeLevel', { stage: progress.quickEye.variant, speed: quickEyeSpeedLevel(p.level) })
              : t('home.level', { level: displayLevel(p.level).toFixed(1) })
            return (
              <li key={game.id}>
                <Link
                  to={`/brain/play/${game.id}`}
                  className="group relative flex flex-col h-full min-h-44 p-5 rounded-3xl text-white no-underline overflow-hidden shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_rgba(0,0,0,0.55)] transition-[transform,box-shadow] duration-200"
                  style={{ background: cardBackground(theme) }}
                  data-testid={`brain-game-${game.id}`}
                >
                  <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-6 opacity-[0.14] group-hover:opacity-20 transition-opacity">
                    {Icon && <Icon className="w-40 h-40" strokeWidth={1.25} />}
                  </div>
                  <div className="relative flex items-start justify-between gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-white/20 ring-1 ring-white/25 flex items-center justify-center">
                      {Icon && <Icon className="w-6 h-6" aria-hidden="true" />}
                    </span>
                    {!fresh ? (
                      <TierBadge tier={standing.tier} size="sm" testId={`brain-tier-${game.id}`} />
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-sm font-bold bg-white text-slate-900">
                        <Sparkles className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />
                        {t('home.new')}
                      </span>
                    )}
                  </div>
                  <div className="relative mt-3 flex-1">
                    <p className="text-xl font-extrabold">{t(`games.${game.id}.name`)}</p>
                    <p className="mt-0.5 text-sm text-white/85 line-clamp-2">{t(`games.${game.id}.desc`)}</p>
                  </div>
                  <div className="relative mt-3 flex items-end justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* The way to this game's next tier — its own ladder, never a total across games. */}
                      {!fresh && <TierBar standing={standing} fill="#FFFFFF" track="rgba(255,255,255,0.25)" height="h-1.5" />}
                      <p className="mt-1.5 text-sm text-white/85 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                        {played && !placing && (
                          <>
                            <span className="font-semibold text-white tabular-nums" data-testid={`brain-level-${game.id}`}>{levelLabel}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span>{t(`skills.${game.skill}`)}</span>
                        {best ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                              {t('home.record', { value: formatCount(best) })}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {trend.length >= 2 && (
                      <div className="w-24 shrink-0 opacity-90">
                        <Sparkline values={trend} color="#FFFFFF" height={36} />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <AchievementsGrid />

      <p className="text-base text-muted-foreground leading-relaxed">{t('home.howItWorks')}</p>

      {research && (
        <Link
          to="/brain/research"
          className="flex items-center gap-3 p-4 min-h-14 rounded-2xl border border-border bg-card no-underline hover:border-brand"
          data-testid="brain-research-link"
        >
          <BookOpen className="w-5 h-5 text-brand-active" aria-hidden="true" />
          <span className="flex-1 text-base font-medium text-foreground">{t('home.research')}</span>
          <ChevronRight className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}

      <footer className="space-y-2 pb-4 text-sm text-muted-foreground">
        <p>{t('disclaimer')}</p>
        <p>{t('worry')}</p>
      </footer>

      <BrainSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
