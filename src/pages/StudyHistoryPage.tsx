import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock, Layers } from 'lucide-react'
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
import type { StudySession, StudyLog, Card, Deck, DeckStudyState } from '../types/database'

const PAGE_SIZE = 15

// ── Per-deck progress info ──

interface DeckProgress {
  deck: Deck
  totalCards: number
  studiedCards: number      // cards that are NOT "new" (at least seen once)
  newCards: number
  learningCards: number
  reviewCards: number
  sequentialPos: number     // for sequential mode
  newStartPos: number       // for sequential_review mode
}

export function StudyHistoryPage() {
  const { user } = useAuthStore()
  const { decks, fetchDecks } = useDeckStore()

  const [sessions, setSessions] = useState<StudySession[]>([])
  const [allLogs, setAllLogs] = useState<StudyLog[]>([])
  const [deckProgress, setDeckProgress] = useState<DeckProgress[]>([])
  const [loading, setLoading] = useState(true)
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

        // Build deck progress map
        const stateMap = new Map(studyStates.map((s) => [s.deck_id, s]))
        const deckCardMap = new Map<string, Pick<Card, 'id' | 'deck_id' | 'srs_status'>[]>()
        for (const card of cards) {
          const arr = deckCardMap.get(card.deck_id) ?? []
          arr.push(card)
          deckCardMap.set(card.deck_id, arr)
        }

        setDeckProgress(
          // Only include decks that have cards
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

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📝</div>
      </div>
    )
  }

  const deckMap = new Map<string, Deck>(decks.map((d) => [d.id, d]))
  const progressMap = new Map(deckProgress.map((p) => [p.deck.id, p]))

  let filtered = sessions
  if (deckFilter !== 'all') {
    filtered = filterSessionsByDeck(filtered, deckFilter)
  }
  if (modeFilter !== 'all') {
    filtered = filterSessionsByMode(filtered, modeFilter)
  }

  const { items: paginatedItems, totalPages, startIdx, endIdx } =
    paginateSessions(filtered, currentPage, PAGE_SIZE)

  const groups = groupSessionsByDate(paginatedItems)
  const uniqueModes = Array.from(new Set(sessions.map((s) => s.study_mode)))
  const sessionDeckIds = new Set(sessions.map((s) => s.deck_id))
  const sessionDecks = decks.filter((d) => sessionDeckIds.has(d.id))

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
        학습 기록
      </h1>

      {/* ── Deck Progress Overview ── */}
      {deckProgress.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">덱별 진도</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deckProgress.map((p) => (
              <DeckProgressCard key={p.deck.id} progress={p} />
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:mb-6">
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

      {/* ── Session list ── */}
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
                <h2 className="text-sm font-semibold text-gray-500 mb-2 sm:mb-3">
                  {group.date}
                </h2>
                <div className="space-y-2">
                  {group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      deck={deckMap.get(session.deck_id)}
                      progress={progressMap.get(session.deck_id)}
                      allLogs={allLogs}
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

// ── SessionCard: expandable with card-level detail ──

function SessionCard({
  session,
  deck,
  progress,
  allLogs,
}: {
  session: StudySession
  deck?: Deck
  progress?: DeckProgress
  allLogs: StudyLog[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [detailLogs, setDetailLogs] = useState<(StudyLog & { card?: Card })[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const time = new Date(session.completed_at)
  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`

  const ratingEntries = Object.entries(session.ratings)
  const totalRatings = ratingEntries.reduce((s, [, c]) => s + c, 0)

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }

    setExpanded(true)
    setDetailLoading(true)

    const sessionDate = new Date(session.completed_at)
    const dateStr = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`

    const matchedLogs = allLogs.filter((log) => {
      if (log.deck_id !== session.deck_id) return false
      if (log.study_mode !== session.study_mode) return false
      const d = new Date(log.studied_at)
      const logDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return logDate === dateStr
    })

    const cardIds = [...new Set(matchedLogs.map((l) => l.card_id))]
    let cardMap = new Map<string, Card>()
    if (cardIds.length > 0) {
      const { data: cards } = await supabase
        .from('cards')
        .select('*')
        .in('id', cardIds)
      if (cards) {
        cardMap = new Map((cards as Card[]).map((c) => [c.id, c]))
      }
    }

    setDetailLogs(
      matchedLogs.map((log) => ({ ...log, card: cardMap.get(log.card_id) }))
    )
    setDetailLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Summary row — clickable */}
      <button
        onClick={handleToggle}
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

          {/* Expand icon */}
          <div className="shrink-0 text-gray-400">
            {expanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-gray-100">
          {detailLoading ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              불러오는 중...
            </div>
          ) : detailLogs.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              상세 기록이 없습니다.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              <div className="px-4 py-2 bg-gray-50 flex items-center gap-4 text-[11px] font-medium text-gray-500 uppercase">
                <span className="flex-1">카드</span>
                <span className="w-16 text-center">평가</span>
                <span className="w-16 text-right hidden sm:block">소요 시간</span>
              </div>
              {detailLogs.map((log, i) => (
                <DetailRow key={log.id ?? i} log={log} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail row: single card study record ──

function DetailRow({
  log,
  index,
}: {
  log: StudyLog & { card?: Card }
  index: number
}) {
  const cardPreview = getCardPreview(log.card)

  return (
    <div className="px-4 py-2.5 flex items-center gap-4 hover:bg-gray-50/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0 w-5 text-right">{index + 1}</span>
          <span className="text-sm text-gray-800 truncate">{cardPreview}</span>
        </div>
      </div>
      <div className="w-16 text-center shrink-0">
        <RatingBadge rating={log.rating} />
      </div>
      <div className="w-16 text-right shrink-0 text-xs text-gray-400 hidden sm:block">
        {log.review_duration_ms ? formatDuration(log.review_duration_ms) : '-'}
      </div>
    </div>
  )
}

// ── Helpers ──

function getCardPreview(card?: Card): string {
  if (!card) return '(삭제된 카드)'
  const values = Object.values(card.field_values)
  if (values.length === 0) return '(내용 없음)'
  const front = values[0]?.slice(0, 40) || ''
  const back = values[1]?.slice(0, 30) || ''
  if (back) return `${front} → ${back}`
  return front
}

function RatingBadge({ rating }: { rating: string }) {
  const config: Record<string, { label: string; className: string }> = {
    again: { label: 'Again', className: 'bg-red-50 text-red-600 border-red-200' },
    hard: { label: 'Hard', className: 'bg-orange-50 text-orange-600 border-orange-200' },
    good: { label: 'Good', className: 'bg-green-50 text-green-700 border-green-200' },
    easy: { label: 'Easy', className: 'bg-blue-50 text-blue-600 border-blue-200' },
  }
  const c = config[rating] ?? { label: rating, className: 'bg-gray-50 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${c.className}`}>
      {c.label}
    </span>
  )
}

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
