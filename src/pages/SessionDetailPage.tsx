import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Layers, TrendingUp, BarChart3, Zap, Target } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  formatDuration,
  getStudyModeLabel,
  getStudyModeEmoji,
  getSessionPerformance,
} from '../lib/study-history'
import { computeSrsStats } from '../lib/study-history-stats'
import type { StudySession, StudyLog, Card } from '../types/database'

type LogWithCard = StudyLog & { card?: Card }

export function SessionDetailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as {
    session: StudySession
    deckName: string
    deckIcon: string
  } | null

  const [logs, setLogs] = useState<LogWithCard[]>([])
  const [loading, setLoading] = useState(true)

  // Redirect if no state
  useEffect(() => {
    if (!state) {
      navigate('/history', { replace: true })
    }
  }, [state, navigate])

  // Fetch logs + cards
  useEffect(() => {
    if (!state) return
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      const { session } = state

      const sessionDate = new Date(session.completed_at)
      const dayStart = new Date(sessionDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(sessionDate)
      dayEnd.setHours(23, 59, 59, 999)

      const { data: rawLogs } = await supabase
        .from('study_logs')
        .select('*')
        .eq('deck_id', session.deck_id)
        .eq('study_mode', session.study_mode)
        .gte('studied_at', dayStart.toISOString())
        .lte('studied_at', dayEnd.toISOString())
        .order('studied_at', { ascending: true })

      if (cancelled) return

      const matchedLogs = (rawLogs ?? []) as StudyLog[]
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

      if (!cancelled) {
        setLogs(matchedLogs.map((log) => ({ ...log, card: cardMap.get(log.card_id) })))
        setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [state])

  if (!state) return null

  const { session, deckName, deckIcon } = state
  const performance = getSessionPerformance(session.ratings)
  const ratingEntries = Object.entries(session.ratings)
  const totalRatings = ratingEntries.reduce((s, [, c]) => s + c, 0)
  const isSrs = session.study_mode === 'srs'

  const completedAt = new Date(session.completed_at)
  const dateStr = `${completedAt.getFullYear()}. ${completedAt.getMonth() + 1}. ${completedAt.getDate()}. ${String(completedAt.getHours()).padStart(2, '0')}:${String(completedAt.getMinutes()).padStart(2, '0')}`

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/history')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        학습 기록으로
      </button>

      {/* Common Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{deckIcon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-gray-900 truncate">{deckName}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 shrink-0">
                {getStudyModeEmoji(session.study_mode)} {getStudyModeLabel(session.study_mode)}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{dateStr}</p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Layers className="w-4 h-4 text-gray-400" />
            {session.cards_studied}장 학습
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-4 h-4 text-gray-400" />
            {formatDuration(session.total_duration_ms)}
          </span>
          {totalRatings > 0 && (
            <span className="inline-flex items-center gap-1">
              <Target className="w-4 h-4 text-gray-400" />
              성과 {performance}%
            </span>
          )}
        </div>

        {/* Rating distribution bar */}
        {totalRatings > 0 && (
          <div className="mt-3">
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
              {ratingEntries.map(([rating, count]) => (
                <div
                  key={rating}
                  className={getRatingBarColor(rating)}
                  style={{ width: `${(count / totalRatings) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
              {ratingEntries.map(([rating, count]) => (
                <span key={rating} className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${getRatingBarColor(rating)}`} />
                  {getRatingLabel(rating)} {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-2xl animate-pulse mb-2">...</div>
          <p className="text-sm text-gray-400">상세 기록을 불러오는 중...</p>
        </div>
      ) : (
        <>
          {/* SRS-specific stats */}
          {isSrs && logs.length > 0 && <SrsSection logs={logs} />}

          {/* Summary cards for non-SRS modes */}
          {!isSrs && logs.length > 0 && (
            <SummaryCards
              totalCards={session.cards_studied}
              totalDurationMs={session.total_duration_ms}
              performance={performance}
              showPerformance={session.study_mode === 'sequential_review' || session.study_mode === 'random'}
            />
          )}

          {/* Card detail table */}
          {logs.length > 0 ? (
            <CardDetailTable logs={logs} isSrs={isSrs} />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-400">상세 기록이 없습니다.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── SRS Section ──

function SrsSection({ logs }: { logs: LogWithCard[] }) {
  const srsStats = computeSrsStats(logs)

  return (
    <div className="space-y-4">
      {/* SRS stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Target className="w-4 h-4 text-green-600" />}
          label="유지율"
          value={`${srsStats.retentionRate}%`}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4 text-blue-600" />}
          label="평균 간격 성장"
          value={srsStats.avgIntervalGrowth > 0 ? `+${srsStats.avgIntervalGrowth}일` : `${srsStats.avgIntervalGrowth}일`}
        />
        <StatCard
          icon={<Zap className="w-4 h-4 text-amber-600" />}
          label="평균 Ease"
          value={String(srsStats.avgNewEase)}
        />
        <StatCard
          icon={<BarChart3 className="w-4 h-4 text-purple-600" />}
          label="총 리뷰"
          value={`${srsStats.totalReviews}회`}
        />
      </div>

      {/* Ease distribution chart */}
      {srsStats.easeDistribution.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Ease 분포</h3>
          <div className="space-y-2">
            {srsStats.easeDistribution.map((d) => {
              const maxCount = Math.max(...srsStats.easeDistribution.map((e) => e.count))
              const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0
              return (
                <div key={d.bucket} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-16 text-right shrink-0">{d.bucket}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 w-8 shrink-0">{d.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Summary Cards (non-SRS) ──

function SummaryCards({
  totalCards,
  totalDurationMs,
  performance,
  showPerformance,
}: {
  totalCards: number
  totalDurationMs: number
  performance: number
  showPerformance: boolean
}) {
  const avgSpeed = totalCards > 0 ? Math.round(totalDurationMs / totalCards) : 0

  return (
    <div className={`grid gap-3 ${showPerformance ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
      <StatCard
        icon={<Layers className="w-4 h-4 text-blue-600" />}
        label="총 카드"
        value={`${totalCards}장`}
      />
      <StatCard
        icon={<Clock className="w-4 h-4 text-gray-600" />}
        label="평균 소요시간"
        value={formatDuration(avgSpeed)}
      />
      {showPerformance && (
        <StatCard
          icon={<Target className="w-4 h-4 text-green-600" />}
          label="성과 점수"
          value={`${performance}%`}
        />
      )}
    </div>
  )
}

// ── Stat Card ──

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <span className="text-lg font-bold text-gray-900">{value}</span>
    </div>
  )
}

// ── Card Detail Table ──

const DETAIL_PAGE_SIZE = 20

function CardDetailTable({ logs, isSrs }: { logs: LogWithCard[]; isSrs: boolean }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(logs.length / DETAIL_PAGE_SIZE))
  const startIdx = (page - 1) * DETAIL_PAGE_SIZE
  const pageLogs = logs.slice(startIdx, startIdx + DETAIL_PAGE_SIZE)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          카드별 상세
        </h3>
        <span className="text-xs text-gray-400">{logs.length}건</span>
      </div>

      {/* Table header */}
      <div className="px-4 py-2 bg-gray-50 flex items-center gap-3 text-[11px] font-medium text-gray-500 uppercase">
        <span className="w-6 text-center shrink-0">#</span>
        <span className="flex-1">카드</span>
        <span className="w-16 text-center shrink-0">평가</span>
        {isSrs && (
          <>
            <span className="w-24 text-center shrink-0 hidden sm:block">간격 변화</span>
            <span className="w-24 text-center shrink-0 hidden sm:block">Ease 변화</span>
          </>
        )}
        <span className="w-16 text-right shrink-0 hidden sm:block">소요시간</span>
      </div>

      {/* Table rows */}
      <div className="divide-y divide-gray-50">
        {pageLogs.map((log, i) => (
          <div
            key={log.id ?? i}
            className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50/50"
          >
            <span className="w-6 text-center text-xs text-gray-400 shrink-0">{startIdx + i + 1}</span>
            <span className="flex-1 text-sm text-gray-800 truncate min-w-0">
              {getCardPreview(log.card)}
            </span>
            <div className="w-16 text-center shrink-0">
              <RatingBadge rating={log.rating} />
            </div>
            {isSrs && (
              <>
                <span className="w-24 text-center text-xs text-gray-500 shrink-0 hidden sm:block">
                  {log.prev_interval != null && log.new_interval != null
                    ? `${log.prev_interval}일 → ${log.new_interval}일`
                    : '-'}
                </span>
                <span className="w-24 text-center text-xs text-gray-500 shrink-0 hidden sm:block">
                  {log.prev_ease != null && log.new_ease != null
                    ? `${log.prev_ease.toFixed(2)} → ${log.new_ease.toFixed(2)}`
                    : '-'}
                </span>
              </>
            )}
            <span className="w-16 text-right text-xs text-gray-400 shrink-0 hidden sm:block">
              {log.review_duration_ms ? formatDuration(log.review_duration_ms) : '-'}
            </span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            {startIdx + 1}~{Math.min(startIdx + DETAIL_PAGE_SIZE, logs.length)} / {logs.length}건
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-600 px-2">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
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
