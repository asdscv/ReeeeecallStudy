import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, Lock, Medal } from 'lucide-react'
import { useAchievementStore } from '../stores/achievement-store'
import type { Achievement } from '../stores/achievement-store'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'

// ── Badges tab types & helpers ──

const CATEGORY_ORDER: Achievement['category'][] = ['streak', 'study', 'social', 'milestone']

function xpForLevel(level: number): number {
  return level * 100
}

function xpInCurrentLevel(xp: number, level: number): number {
  let remaining = xp
  for (let i = 1; i < level; i++) {
    remaining -= xpForLevel(i)
  }
  return remaining
}

// ── Leaderboard tab types & helpers ──

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

// ── Tab type ──

type Tab = 'badges' | 'leaderboard'

// ── Main Page ──

export function AchievementsPage() {
  const { t } = useTranslation('common')
  // Leaderboard tab disabled until user base grows — uncomment to enable
  const tab: Tab = 'badges'
  // const [tab, setTab] = useState<Tab>('badges')

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('achievements.title')}</h1>

      {/* Tab switcher — Leaderboard hidden until user base grows */}
      {/* To enable: uncomment the leaderboard tab button below */}
      {/*
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        <button onClick={() => setTab('badges')} className={...}>{t('achievements.tabs.badges')}</button>
        <button onClick={() => setTab('leaderboard')} className={...}>{t('achievements.tabs.leaderboard')}</button>
      </div>
      */}

      {tab === 'badges' ? <BadgesContent /> : <LeaderboardContent />}
    </div>
  )
}

// ── Badges Content ──

function BadgesContent() {
  const { t } = useTranslation('common')
  const { achievements, xp, level, loading, fetchAchievements } = useAchievementStore()

  useEffect(() => {
    fetchAchievements()
  }, [fetchAchievements])

  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpForLevel(level)
  const progressPct = Math.min((currentLevelXp / nextLevelXp) * 100, 100)

  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    items: achievements.filter(a => a.category === cat),
  })).filter(g => g.items.length > 0)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse"><Trophy className="w-10 h-10 text-yellow-500" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Level + XP bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-yellow-100 text-yellow-600 font-bold text-lg">
            {level}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">
              {t('achievements.level')} {level}
            </p>
            <p className="text-xs text-gray-500">
              {currentLevelXp} / {nextLevelXp} {t('achievements.xp')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{xp} {t('achievements.xp')}</p>
            <p className="text-xs text-gray-500">{t('achievements.totalXp')}</p>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-yellow-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Achievement groups */}
      {grouped.map(({ category, items }) => (
        <div key={category}>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 capitalize">
            {t(`achievements.category.${category}`)}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {items.map(ach => (
              <div
                key={ach.id}
                className={`relative rounded-xl border p-4 text-center transition-all ${
                  ach.earned
                    ? 'bg-white border-yellow-300 shadow-sm'
                    : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                <div className="text-3xl mb-2">{ach.icon}</div>
                <p className="text-sm font-medium text-gray-900 mb-1">
                  {t(`achievements.badge.${ach.id}`, ach.id)}
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  {t(`achievements.badgeDesc.${ach.id}`, '')}
                </p>
                <span className="inline-block text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                  +{ach.xp_reward} {t('achievements.xp')}
                </span>
                {ach.earned && ach.earned_at && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {new Date(ach.earned_at).toLocaleDateString()}
                  </p>
                )}
                {!ach.earned && (
                  <div className="absolute top-2 right-2 text-gray-400">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {achievements.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>{t('achievements.empty')}</p>
        </div>
      )}
    </div>
  )
}

// ── Leaderboard Content ──

function LeaderboardContent() {
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
      const result = data as { entries: LeaderboardEntry[] } | null
      setEntries(result?.entries ?? [])
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
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Medal className="w-5 h-5 text-yellow-500" />
          {t('leaderboard.title')}
        </h2>

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
