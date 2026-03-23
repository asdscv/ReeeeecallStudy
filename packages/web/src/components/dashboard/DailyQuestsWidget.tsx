import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

interface Quest {
  id: string
  quest_type: 'cards' | 'sessions' | 'time' | 'perfect'
  target_value: number
  current_value: number
  xp_reward: number
  completed: boolean
}

const QUEST_ICONS: Record<string, string> = {
  cards: '\uD83D\uDCDA',
  sessions: '\u26A1',
  time: '\u23F1\uFE0F',
  perfect: '\uD83D\uDCAF',
}

export function DailyQuestsWidget() {
  const { t } = useTranslation('common')
  const [quests, setQuests] = useState<Quest[]>([])
  const [loading, setLoading] = useState(true)
  const [justCompleted, setJustCompleted] = useState<Set<string>>(new Set())

  const fetchQuests = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('generate_daily_quests')
      if (error) throw error
      const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as Quest[]
      setQuests(parsed ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQuests()
  }, [fetchQuests])

  // Track newly completed quests for pulse animation
  useEffect(() => {
    const completed = new Set(quests.filter(q => q.completed).map(q => q.id))
    if (completed.size > 0) {
      setJustCompleted(completed)
      const timer = setTimeout(() => setJustCompleted(new Set()), 2000)
      return () => clearTimeout(timer)
    }
  }, [quests])

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 sm:p-5 animate-pulse">
        <div className="h-5 bg-accent rounded w-32 mb-3" />
        <div className="space-y-3">
          <div className="h-10 bg-accent rounded" />
          <div className="h-10 bg-accent rounded" />
          <div className="h-10 bg-accent rounded" />
        </div>
      </div>
    )
  }

  if (quests.length === 0) return null

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        {t('quests.title')}
      </h3>
      <div className="space-y-3">
        {quests.map(quest => {
          const pct = quest.target_value > 0
            ? Math.min((quest.current_value / quest.target_value) * 100, 100)
            : 0
          const isPulsing = justCompleted.has(quest.id) && quest.completed

          return (
            <div
              key={quest.id}
              className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-300 ${
                quest.completed
                  ? 'bg-success/10 border border-success/30'
                  : 'bg-muted border border-border'
              } ${isPulsing ? 'animate-quest-pulse' : ''}`}
            >
              <span className="text-lg flex-shrink-0">
                {quest.completed ? '\u2705' : QUEST_ICONS[quest.quest_type] ?? '\uD83C\uDFAF'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className={`text-xs font-medium truncate ${
                    quest.completed ? 'text-success' : 'text-foreground'
                  }`}>
                    {quest.completed
                      ? t('quests.completed')
                      : t(`quests.${quest.quest_type}`, { target: quest.target_value })}
                  </p>
                  <span className={`text-xs font-medium flex-shrink-0 ml-2 ${
                    quest.completed ? 'text-success' : 'text-warning'
                  }`}>
                    {t('quests.xpReward', { xp: quest.xp_reward })}
                  </span>
                </div>
                <div className="w-full bg-accent rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      quest.completed ? 'bg-success' : 'bg-brand'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {quest.current_value} / {quest.target_value}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes quest-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
          50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.3); }
        }
        .animate-quest-pulse {
          animation: quest-pulse 0.6s ease-in-out 2;
        }
      `}</style>
    </div>
  )
}
