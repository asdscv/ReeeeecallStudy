import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { exportToCsv } from '../../lib/csv-export'
import { useAuthStore } from '../../stores/auth-store'
import { toast } from 'sonner'

export function UserStatsExport() {
  const { t } = useTranslation('settings')
  const user = useAuthStore((s) => s.user)
  const [exporting, setExporting] = useState<string | null>(null)

  const handleExport = async (type: 'stats' | 'sessions' | 'decks' | 'cards') => {
    if (!user || exporting) return
    setExporting(type)

    try {
      switch (type) {
        case 'stats': {
          const { data, error } = await supabase.rpc('get_user_study_stats')
          if (error) throw error
          const stats = data as Record<string, unknown>
          exportToCsv('my-study-stats', [stats])
          break
        }
        case 'sessions': {
          const { data, error } = await supabase
            .from('study_sessions')
            .select('id, deck_id, study_mode, cards_studied, total_cards, total_duration_ms, ratings, started_at, completed_at')
            .eq('user_id', user.id)
            .order('completed_at', { ascending: false })
            .limit(5000)
          if (error) throw error
          if (!data || data.length === 0) {
            toast.info(t('export.noData', 'No data to export'))
            break
          }
          exportToCsv('my-study-sessions', data)
          break
        }
        case 'decks': {
          const { data, error } = await supabase
            .from('decks')
            .select('id, name, description, color, icon, is_archived, created_at, updated_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
          if (error) throw error
          if (!data || data.length === 0) {
            toast.info(t('export.noData', 'No data to export'))
            break
          }
          exportToCsv('my-decks', data)
          break
        }
        case 'cards': {
          const { data, error } = await supabase
            .from('cards')
            .select('id, deck_id, field_values, tags, srs_status, ease_factor, interval_days, repetitions, next_review_at, created_at')
            .eq('user_id', user.id)
            .limit(10000)
          if (error) throw error
          if (!data || data.length === 0) {
            toast.info(t('export.noData', 'No data to export'))
            break
          }
          exportToCsv('my-cards', data as unknown as Record<string, unknown>[])
          break
        }
      }
      toast.success(t('export.success', 'Export completed'))
    } catch (e) {
      toast.error(t('export.error', 'Export failed'))
      console.error('[UserStatsExport]', e)
    } finally {
      setExporting(null)
    }
  }

  const exports = [
    { type: 'stats' as const, label: t('export.stats', 'Study Statistics'), desc: t('export.statsDesc', 'Overall study performance summary') },
    { type: 'sessions' as const, label: t('export.sessions', 'Study Sessions'), desc: t('export.sessionsDesc', 'All study session history (up to 5,000)') },
    { type: 'decks' as const, label: t('export.decks', 'Decks'), desc: t('export.decksDesc', 'All deck metadata') },
    { type: 'cards' as const, label: t('export.cards', 'Cards'), desc: t('export.cardsDesc', 'All card data with SRS status (up to 10,000)') },
  ]

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">
        {t('export.title', 'Export My Data')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('export.description', 'Download your data as CSV files.')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {exports.map(({ type, label, desc }) => (
          <button
            key={type}
            type="button"
            onClick={() => handleExport(type)}
            disabled={!!exporting}
            className="flex items-center gap-3 p-3 text-left bg-muted dark:bg-slate-800 rounded-lg border border-border dark:border-slate-700 hover:bg-accent dark:hover:bg-slate-700 transition cursor-pointer disabled:opacity-50"
          >
            {exporting === type ? (
              <Loader2 className="w-5 h-5 text-brand animate-spin shrink-0" />
            ) : (
              <Download className="w-5 h-5 text-content-tertiary shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground truncate">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
