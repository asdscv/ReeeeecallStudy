import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shuffle, Flame, Play } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  BRAIN_GAMES,
  currentDays,
  displayLevel,
  gameProgress,
  localDayKey,
} from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useAuthStore } from '../../stores/auth-store'
import { BRAIN_ICONS, brainStorageFor } from '../../components/brain/brain-ui'

/** `/brain` — the mixed run up top, every game below with the level it is at. */
export function BrainHomePage() {
  const { t } = useTranslation('brain')
  const userId = useAuthStore((s) => s.user?.id)
  const hydrate = useBrainStore((s) => s.hydrate)
  const progress = useBrainStore((s) => s.progress)

  useEffect(() => {
    if (userId) hydrate(brainStorageFor(userId))
  }, [userId, hydrate])

  const days = currentDays(progress, localDayKey())

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">{t('title')}</h1>
        <p className="text-xs text-content-tertiary mt-0.5">{t('subtitle')}</p>
      </div>

      {progress.totalRounds > 0 && (
        <div className="flex flex-wrap gap-2 text-xs" data-testid="brain-stats">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/10 text-warning">
            <Flame className="w-3.5 h-3.5" aria-hidden="true" />
            {t('home.streak', { count: days.dayStreak })}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
            {t('home.today', { value: formatCount(days.todayRounds) })}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
            {t('home.totalPoints', { value: formatCount(progress.totalPoints) })}
          </span>
        </div>
      )}

      <Link
        to="/brain/play/mix"
        className="block p-4 rounded-xl bg-brand text-white no-underline hover:bg-brand-hover transition-colors"
        data-testid="brain-mix"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Shuffle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold">{t('mix.title')}</p>
            <p className="text-xs text-white/80 mt-0.5">{t('mix.desc')}</p>
          </div>
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-brand text-sm font-semibold shrink-0">
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {t('mix.start')}
          </span>
        </div>
      </Link>

      <div>
        <p className="text-xs font-medium text-content-tertiary mb-2">{t('home.games')}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BRAIN_GAMES.map((game) => {
            const Icon = BRAIN_ICONS[game.icon]
            const p = gameProgress(progress, game.id)
            return (
              <li key={game.id}>
                <Link
                  to={`/brain/play/${game.id}`}
                  className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border no-underline hover:border-brand/40 transition-colors h-full"
                  data-testid={`brain-game-${game.id}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                    {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{t(`games.${game.id}.name`)}</p>
                      <span className="text-xs text-content-tertiary shrink-0">
                        {p.rounds > 0 ? t('home.level', { level: displayLevel(p.level) }) : t('home.new')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t(`games.${game.id}.desc`)}</p>
                    <p className="text-[11px] text-content-tertiary mt-1">
                      {t(`skills.${game.skill}`)}
                      {p.rounds > 0 && ` · ${t('home.best', { level: displayLevel(p.bestLevel) })}`}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{t('home.howItWorks')}</p>
      <p className="text-[11px] text-content-tertiary">{t('note')}</p>
    </div>
  )
}
