import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings, Play, ChevronRight, BookOpen } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  BRAIN_GAMES,
  courseStatus,
  createRng,
  displayLevel,
  gameProgress,
  localDayKey,
  planTodaysSession,
  plannedMinutes,
  researchContent,
  weekProgress,
} from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BRAIN_ICONS } from '../../components/brain/brain-ui'
import { BrainSettingsDialog } from '../../components/brain/BrainSettingsDialog'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'

/**
 * `/brain` — Today's Training first (the bounded session the research counts), free practice of
 * any single game below, then the research basis and the disclaimer. Progress is shown as
 * sessions this week and course steps, never as a streak or a "brain score".
 */
export function BrainHomePage() {
  const { t, i18n } = useTranslation('brain')
  useBrainHydrated()
  const progress = useBrainStore((s) => s.progress)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const minutes = useMemo(() => plannedMinutes(planTodaysSession(progress, createRng(1))), [progress])
  const research = researchContent(i18n.language)

  const courseChip =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : course.phase === 'core'
        ? t('training.course', { done: course.coreDone, total: course.coreTotal })
        : course.nextBoosterOn
          ? t('training.boosterNext', { date: course.nextBoosterOn })
          : null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('home.settings')}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent border-none bg-transparent cursor-pointer"
          data-testid="brain-settings"
        >
          <Settings className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <section className="p-5 rounded-2xl bg-card border border-border space-y-4" data-testid="brain-training-card">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('training.title')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('training.desc', { minutes })}</p>
        </div>
        <Link
          to="/brain/training"
          className="flex items-center justify-center gap-2 min-h-14 rounded-xl bg-brand text-white text-lg font-semibold no-underline hover:bg-brand-hover transition-colors"
          data-testid="brain-training-start"
        >
          <Play className="w-5 h-5" aria-hidden="true" />
          {t('training.start')}
        </Link>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className={`px-3 py-1 rounded-full ${week.done >= week.goal ? 'bg-success/10 text-success font-medium' : 'bg-muted text-foreground'}`}>
            {week.done >= week.goal ? t('training.weekDone') : t('training.week', { done: week.done, goal: week.goal })}
          </span>
          {courseChip && <span className="px-3 py-1 rounded-full bg-muted text-foreground">{courseChip}</span>}
          {progress.sessions.minutes > 0 && (
            <span className="px-3 py-1 rounded-full bg-muted text-foreground">{t('training.minutes', { value: formatCount(progress.sessions.minutes) })}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('training.dose')}</p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('home.freePlay')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('home.freePlayHint')}</p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BRAIN_GAMES.map((game) => {
            const Icon = BRAIN_ICONS[game.icon]
            const p = gameProgress(progress, game.id)
            const played = p.rounds > 0
            const level =
              game.id === 'quickEye'
                ? t('home.quickEyeLevel', { stage: progress.quickEye.variant, speed: Math.round(p.level) })
                : played
                  ? t('home.level', { level: displayLevel(p.level) })
                  : t('home.new')
            const best = progress.bestRuns[game.id]
            return (
              <li key={game.id}>
                <Link
                  to={`/brain/play/${game.id}`}
                  className="flex items-start gap-3 p-4 min-h-16 bg-card rounded-xl border border-border no-underline hover:border-brand transition-colors h-full"
                  data-testid={`brain-game-${game.id}`}
                >
                  <div className="w-11 h-11 rounded-lg bg-brand/10 text-brand-active flex items-center justify-center shrink-0">
                    {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-base font-semibold text-foreground">{t(`games.${game.id}.name`)}</p>
                      <span className="text-sm text-muted-foreground shrink-0">{game.id === 'quickEye' && !played ? t('home.new') : level}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{t(`games.${game.id}.desc`)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t(`skills.${game.skill}`)}
                      {best ? ` · ${t('home.record', { value: formatCount(best) })}` : ''}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground leading-relaxed">{t('home.howItWorks')}</p>

      {research && (
        <Link
          to="/brain/research"
          className="flex items-center gap-3 p-4 min-h-14 rounded-xl border border-border bg-card no-underline hover:border-brand"
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
