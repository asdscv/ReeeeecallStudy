import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { CategoryIcon } from '../../lib/achievement-icons'

interface Goal {
  category: string
  current: number
  target: number
  icon: string
  xp: number
  progress: number
}

const CATEGORY_LABELS: Record<string, string> = {
  streak: 'goals.streak',
  cards: 'goals.cards',
  sessions: 'goals.sessions',
  time: 'goals.time',
  mastery: 'goals.mastery',
}

function formatValue(category: string, value: number): string {
  if (category === 'time') {
    if (value >= 60) return `${Math.round(value / 60)}h`
    return `${value}m`
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

export function NextGoalsWidget() {
  const { t } = useTranslation('common')
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase.rpc('get_next_goals')
        const result = data as { goals: Goal[] } | null
        setGoals(result?.goals ?? [])
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    )
  }

  if (goals.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        {t('goals.title', 'Next Goals')}
      </h3>
      <div className="space-y-3">
        {goals.map((goal) => (
          <div key={goal.category} className="flex items-center gap-3">
            <div className="shrink-0"><CategoryIcon category={goal.category} size="md" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {t(CATEGORY_LABELS[goal.category] ?? goal.category)}
                </span>
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {formatValue(goal.category, goal.current)} / {formatValue(goal.category, goal.target)}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, goal.progress)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-gray-400">{goal.progress}%</span>
                <span className="text-[10px] text-blue-500 font-medium">+{goal.xp} XP</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
