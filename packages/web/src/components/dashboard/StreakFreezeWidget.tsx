import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

interface FreezeInfo {
  streak_freezes: number
  freeze_used_today: boolean
  current_streak: number
}

const MAX_FREEZES = 3

export function StreakFreezeWidget() {
  const { t } = useTranslation('common')
  const [info, setInfo] = useState<FreezeInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const { data, error } = await supabase.rpc('get_streak_freeze_info')
        if (error) throw error
        const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as FreezeInfo
        setInfo(parsed)
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchInfo()
  }, [])

  if (loading || !info) return null

  const { streak_freezes, freeze_used_today } = info

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-foreground mb-2">
        {t('streakFreeze.title')}
      </h3>

      {freeze_used_today && (
        <p className="text-xs text-success font-medium mb-2">
          {t('streakFreeze.used')}
        </p>
      )}

      <div className="flex items-center gap-1.5 mb-1">
        {Array.from({ length: MAX_FREEZES }).map((_, i) => (
          <span
            key={i}
            className={`text-lg transition-opacity duration-300 ${
              i < streak_freezes ? 'opacity-100' : 'opacity-25'
            }`}
            title={i < streak_freezes
              ? t('streakFreeze.available', { count: streak_freezes })
              : ''}
          >
            {'\uD83D\uDEE1\uFE0F'}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('streakFreeze.available', { count: streak_freezes })}
      </p>
    </div>
  )
}
