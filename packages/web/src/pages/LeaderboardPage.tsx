import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, Medal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'

type Period = 'weekly' | 'monthly' | 'all_time'

interface LeaderboardEntry {
  rank: number
  user_id: string
  display_name: string
  level: number
  cards_studied: number
  sessions: number
}

const PERIOD_OPTIONS: Period[] = ['weekly', 'monthly', 'all_time']

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-500 font-bold text-lg">🥇</span>
  if (rank === 2) return <span className="text-gray-400 font-bold text-lg">🥈</span>
  if (rank === 3) return <span className="text-amber-600 font-bold text-lg">🥉</span>
  return <span className="text-sm font-semibold text-gray-500 w-6 text-center inline-block">{rank}</span>
}

export function LeaderboardPage() {
  const { t } = useTranslation('common')
  const user = useAuthStore(s => s.user)
  const [period, setPeriod] = useState<Period>('weekly')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLeaderboard = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_leaderboard', {
        p_period: p,
      } as Record<string, unknown>)

      if (error) throw error
      setEntries((data ?? []) as LeaderboardEntry[])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLeaderboard(period)
  }, [period, fetchLeaderboard])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Medal className="w-6 h-6 text-yellow-500" />
          {t('leaderboard.title')}
        </h1>

        {/* Period tabs */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
                period === p
                  ? 'bg-white text-blue-700 font-medium shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`leaderboard.${p === 'all_time' ? 'allTime' : p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>{t('leaderboard.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-500 w-16">
                    {t('leaderboard.rank')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t('leaderboard.name')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 hidden sm:table-cell">
                    {t('leaderboard.level')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">
                    {t('leaderboard.cardsStudied')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 hidden sm:table-cell">
                    {t('leaderboard.sessions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(entry => {
                  const isMe = entry.user_id === user?.id
                  const rowClass = isMe
                    ? 'bg-blue-50 font-medium'
                    : entry.rank <= 3
                      ? 'bg-yellow-50/40'
                      : ''

                  return (
                    <tr key={entry.user_id} className={`${rowClass} transition-colors`}>
                      <td className="px-4 py-3">
                        <RankBadge rank={entry.rank} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={isMe ? 'text-blue-700' : 'text-gray-900'}>
                            {entry.display_name}
                          </span>
                          {isMe && (
                            <span className="text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                              {t('leaderboard.you')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">
                          {entry.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {entry.cards_studied.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 hidden sm:table-cell">
                        {entry.sessions.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
