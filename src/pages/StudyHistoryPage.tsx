import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Layers } from 'lucide-react'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { supabase } from '../lib/supabase'
import {
  formatDuration,
  groupSessionsByDate,
  getStudyModeLabel,
  getStudyModeEmoji,
  filterSessionsByDeck,
  filterSessionsByMode,
  paginateSessions,
  aggregateLogsToSessions,
  mergeSessionsWithLogs,
} from '../lib/study-history'
import {
  filterSessionsByPeriod,
  computeOverviewStats,
  computeModeBreakdown,
  computeDailySessionCounts,
  computeRatingDistribution,
  computeSessionDurationTrend,
  computeStudyTimeByMode,
} from '../lib/study-history-stats'
import { getStreakDays } from '../lib/stats'
import { periodToDays } from '../lib/time-period'
import type { TimePeriod } from '../lib/time-period'
import { TimePeriodTabs } from '../components/common/TimePeriodTabs'
import { OverviewStatsCards } from '../components/study-history/OverviewStatsCards'
import { StudyVolumeChart } from '../components/study-history/StudyVolumeChart'
import { RatingDistributionChart } from '../components/study-history/RatingDistributionChart'
import { SessionDurationChart } from '../components/study-history/SessionDurationChart'
import { ModeBreakdownCards } from '../components/study-history/ModeBreakdownCards'
import type { StudySession, StudyLog, Card, Deck, DeckStudyState } from '../types/database'

const PAGE_SIZE = 15

// ── Per-deck progress info ──

interface DeckProgress {
  deck: Deck
  totalCards: number
  studiedCards: number
  newCards: number
  learningCards: number
  reviewCards: number
  sequentialPos: number
  newStartPos: number
}

export function StudyHistoryPage() {
  const { user } = useAuthStore()
  const { decks, fetchDecks } = useDeckStore()

  const [sessions, setSessions] = useState<StudySession[]>([])
  const [allLogs, setAllLogs] = useState<StudyLog[]>([])
  const [deckProgress, setDeckProgress] = useState<DeckProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<TimePeriod>('1m')
  const [deckFilter, setDeckFilter] = useState<string>('all')
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    fetchDecks()
  }, [fetchDecks])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)

      const [sessionsRes, logsRes, cardsRes, studyStateRes] = await Promise.all([
        supabase
          .from('study_sessions')
          .select('*')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: false })
          .limit(500),
        supabase
          .from('study_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('studied_at', { ascending: false })
          .limit(5000),
        supabase
          .from('cards')
          .select('id, deck_id, srs_status')
          .eq('user_id', user.id),
        supabase
          .from('deck_study_state')
          .select('*')
          .eq('user_id', user.id),
      ])

      if (!cancelled) {
        const realSessions = (sessionsRes.data ?? []) as StudySession[]
        const logs = (logsRes.data ?? []) as StudyLog[]
        const cards = (cardsRes.data ?? []) as Pick<Card, 'id' | 'deck_id' | 'srs_status'>[]
        const studyStates = (studyStateRes.data ?? []) as DeckStudyState[]

        setAllLogs(logs)
        const logSessions = aggregateLogsToSessions(logs)
        setSessions(mergeSessionsWithLogs(realSessions, logSessions))

        const stateMap = new Map(studyStates.map((s) => [s.deck_id, s]))
        const deckCardMap = new Map<string, Pick<Card, 'id' | 'deck_id' | 'srs_status'>[]>()
        for (const card of cards) {
          const arr = deckCardMap.get(card.deck_id) ?? []
          arr.push(card)
          deckCardMap.set(card.deck_id, arr)
        }

        setDeckProgress(
          Array.from(deckCardMap.entries())
            .map(([deckId, deckCards]) => {
              const deck = decks.find((d) => d.id === deckId)
              if (!deck) return null
              const state = stateMap.get(deckId)
              const newCards = deckCards.filter((c) => c.srs_status === 'new').length
              const learningCards = deckCards.filter((c) => c.srs_status === 'learning').length
              const reviewCards = deckCards.filter((c) => c.srs_status === 'review').length
              return {
                deck,
                totalCards: deckCards.length,
                studiedCards: deckCards.length - newCards,
                newCards,
                learningCards,
                reviewCards,
                sequentialPos: state?.sequential_pos ?? 0,
                newStartPos: state?.new_start_pos ?? 0,
              } satisfies DeckProgress
            })
            .filter((p): p is DeckProgress => p !== null)
            .sort((a, b) => b.studiedCards - a.studiedCards)
        )

        setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [user, decks])

  // ── Derived data (memoized) ──

  const days = periodToDays(period)

  const periodSessions = useMemo(
    () => filterSessionsByPeriod(sessions, days),
    [sessions, days]
  )

  const overviewStats = useMemo(
    () => computeOverviewStats(periodSessions),
    [periodSessions]
  )

  const streak = useMemo(() => getStreakDays(allLogs), [allLogs])

  const dailyCounts = useMemo(
    () => computeDailySessionCounts(periodSessions, days),
    [periodSessions, days]
  )

  const ratingDist = useMemo(
    () => computeRatingDistribution(periodSessions),
    [periodSessions]
  )

  const durationTrend = useMemo(
    () => computeSessionDurationTrend(periodSessions, days),
    [periodSessions, days]
  )

  const modeBreakdown = useMemo(
    () => computeModeBreakdown(periodSessions),
    [periodSessions]
  )

  const timeByMode = useMemo(
    () => computeStudyTimeByMode(periodSessions),
    [periodSessions]
  )

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1) }, [period])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📝</div>
      </div>
    )
  }

  const deckMap = new Map<string, Deck>(decks.map((d) => [d.id, d]))
  const progressMap = new Map(deckProgress.map((p) => [p.deck.id, p]))

  // Session list filtering (separate from period-filtered chart data)
  let filtered = periodSessions
  if (deckFilter !== 'all') {
    filtered = filterSessionsByDeck(filtered, deckFilter)
  }
  if (modeFilter !== 'all') {
    filtered = filterSessionsByMode(filtered, modeFilter)
  }

  const { items: paginatedItems, totalPages, startIdx, endIdx } =
    paginateSessions(filtered, currentPage, PAGE_SIZE)

  const groups = groupSessionsByDate(paginatedItems)
  const uniqueModes = Array.from(new Set(periodSessions.map((s) => s.study_mode)))
  const sessionDeckIds = new Set(periodSessions.map((s) => s.deck_id))
  const sessionDecks = decks.filter((d) => sessionDeckIds.has(d.id))

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ── Header + Period Selection ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          학습 기록
        </h1>
        <TimePeriodTabs value={period} onChange={setPeriod} />
      </div>

      {/* ── Overview Stats Cards ── */}
      <OverviewStatsCards stats={overviewStats} streak={streak} />

      {/* ── Charts Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StudyVolumeChart data={dailyCounts} />
        <RatingDistributionChart data={ratingDist} />
        <SessionDurationChart data={durationTrend} />
        <ModeBreakdownCards breakdown={modeBreakdown} timeByMode={timeByMode} />
      </div>

      {/* ── Deck Progress ── */}
      {deckProgress.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">덱별 진도</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deckProgress.map((p) => (
              <DeckProgressCard key={p.deck.id} progress={p} />
            ))}
          </div>
        </div>
      )}

      {/* ── Session List Section ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-3">세션 목록</h2>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
          <select
            value={deckFilter}
            onChange={(e) => { setDeckFilter(e.target.value); setCurrentPage(1) }}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none bg-white"
          >
            <option value="all">전체 덱</option>
            {sessionDecks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon} {d.name}
              </option>
            ))}
          </select>
          <select
            value={modeFilter}
            onChange={(e) => { setModeFilter(e.target.value); setCurrentPage(1) }}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none bg-white"
          >
            <option value="all">전체 모드</option>
            {uniqueModes.map((m) => (
              <option key={m} value={m}>
                {getStudyModeEmoji(m)} {getStudyModeLabel(m)}
              </option>
            ))}
          </select>
        </div>

        {/* Session list */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-12 text-center">
            <div className="text-4xl sm:text-5xl mb-4">📝</div>
            <p className="text-gray-500">
              {sessions.length === 0
                ? '아직 학습 기록이 없습니다. 학습을 시작해보세요!'
                : '필터 조건에 맞는 기록이 없습니다.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4 sm:space-y-6">
              {groups.map((group) => (
                <div key={group.date}>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2 sm:mb-3">
                    {group.date}
                  </h3>
                  <div className="space-y-2">
                    {group.sessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        deck={deckMap.get(session.deck_id)}
                        progress={progressMap.get(session.deck_id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 sm:px-4 py-3 mt-4 sm:mt-6 bg-white rounded-xl border border-gray-200">
                <span className="text-xs sm:text-sm text-gray-500">
                  {startIdx + 1}~{Math.min(endIdx, filtered.length)} / {filtered.length}건
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                    className="p-2 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let page: number
                    if (totalPages <= 5) {
                      page = i + 1
                    } else if (currentPage <= 3) {
                      page = i + 1
                    } else if (currentPage >= totalPages - 2) {
                      page = totalPages - 4 + i
                    } else {
                      page = currentPage - 2 + i
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-9 h-9 text-sm rounded cursor-pointer ${
                          currentPage === page
                            ? 'bg-blue-600 text-white'
                            : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage >= totalPages}
                    className="p-2 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Deck Progress Card ──

function DeckProgressCard({ progress: p }: { progress: DeckProgress }) {
  const pct = p.totalCards > 0 ? Math.round((p.studiedCards / p.totalCards) * 100) : 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{p.deck.icon}</span>
        <span className="text-sm font-semibold text-gray-900 truncate">{p.deck.name}</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Numbers */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          <span className="font-semibold text-gray-900">{p.studiedCards}</span>
          <span className="text-gray-400"> / {p.totalCards}장</span>
        </span>
        <span className="font-semibold text-blue-600">{pct}%</span>
      </div>

      {/* Status breakdown */}
      <div className="flex items-center gap-2 mt-2 text-[11px]">
        {p.newCards > 0 && (
          <span className="text-blue-600">미학습 {p.newCards}</span>
        )}
        {p.learningCards > 0 && (
          <span className="text-amber-600">학습중 {p.learningCards}</span>
        )}
        {p.reviewCards > 0 && (
          <span className="text-green-600">복습 {p.reviewCards}</span>
        )}
      </div>
    </div>
  )
}

// ── SessionCard: navigates to detail page ──

function SessionCard({
  session,
  deck,
  progress,
}: {
  session: StudySession
  deck?: Deck
  progress?: DeckProgress
}) {
  const navigate = useNavigate()

  const time = new Date(session.completed_at)
  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`

  const ratingEntries = Object.entries(session.ratings)
  const totalRatings = ratingEntries.reduce((s, [, c]) => s + c, 0)

  const handleClick = () => {
    navigate('/history/detail', {
      state: {
        session,
        deckName: deck?.name ?? '삭제된 덱',
        deckIcon: deck?.icon ?? '📚',
      },
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={handleClick}
        className="w-full text-left p-3 sm:p-4 hover:bg-gray-50 transition cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl shrink-0">{deck?.icon ?? '📚'}</span>

          <div className="flex-1 min-w-0">
            {/* Deck name + mode + time */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {deck?.name ?? '삭제된 덱'}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 shrink-0">
                {getStudyModeEmoji(session.study_mode)} {getStudyModeLabel(session.study_mode)}
              </span>
              <span className="text-xs text-gray-400 shrink-0">{timeStr}</span>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {session.cards_studied}장
                {progress && (
                  <span className="text-gray-400">/ {progress.totalCards}</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(session.total_duration_ms)}
              </span>

              {/* Rating bar */}
              {totalRatings > 0 && (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <div className="flex h-2 flex-1 rounded-full overflow-hidden bg-gray-100 max-w-[160px]">
                    {ratingEntries.map(([rating, count]) => (
                      <div
                        key={rating}
                        className={getRatingBarColor(rating)}
                        style={{ width: `${(count / totalRatings) * 100}%` }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">
                    {ratingEntries.map(([r, c]) => `${getRatingLabel(r)} ${c}`).join(' / ')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Navigate icon */}
          <div className="shrink-0 text-gray-400">
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </button>
    </div>
  )
}

// ── Helpers ──

function getRatingLabel(rating: string): string {
  const labels: Record<string, string> = {
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Easy',
  }
  return labels[rating] ?? rating
}

function getRatingBarColor(rating: string): string {
  const colors: Record<string, string> = {
    again: 'bg-red-400',
    hard: 'bg-orange-400',
    good: 'bg-green-400',
    easy: 'bg-blue-400',
  }
  return colors[rating] ?? 'bg-gray-300'
}
