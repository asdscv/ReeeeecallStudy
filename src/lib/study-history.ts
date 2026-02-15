import type { StudySession, StudyLog } from '../types/database'

/** Format milliseconds to human-readable Korean duration string */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0초'

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}시간`)
  if (minutes > 0) parts.push(`${minutes}분`)
  if (seconds > 0 && hours === 0) parts.push(`${seconds}초`)

  return parts.join(' ') || '0초'
}

/** Calculate performance score (0~100) from ratings */
export function getSessionPerformance(ratings: Record<string, number>): number {
  const weights: Record<string, number> = {
    again: 0,
    hard: 30,
    good: 70,
    easy: 100,
    '1': 0,
    '2': 33,
    '3': 67,
    '4': 100,
    '5': 100,
  }

  let totalWeight = 0
  let totalCount = 0

  for (const [rating, count] of Object.entries(ratings)) {
    const w = weights[rating] ?? 50
    totalWeight += w * count
    totalCount += count
  }

  if (totalCount === 0) return 0
  return Math.round(totalWeight / totalCount)
}

/** Group sessions by date (newest first) */
export function groupSessionsByDate(
  sessions: StudySession[]
): { date: string; sessions: StudySession[] }[] {
  const groups = new Map<string, StudySession[]>()

  for (const session of sessions) {
    const d = new Date(session.completed_at)
    const dateKey = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
    const arr = groups.get(dateKey) ?? []
    arr.push(session)
    groups.set(dateKey, arr)
  }

  return Array.from(groups.entries())
    .sort((a, b) => {
      const dateA = new Date(a[1][0].completed_at)
      const dateB = new Date(b[1][0].completed_at)
      return dateB.getTime() - dateA.getTime()
    })
    .map(([date, sessions]) => ({ date, sessions }))
}

/** Get human-readable label for study mode */
export function getStudyModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    srs: 'SRS',
    sequential_review: '순차 복습',
    random: '랜덤',
    sequential: '순차',
    by_date: '날짜별',
  }
  return labels[mode] ?? mode
}

/** Get emoji for study mode */
export function getStudyModeEmoji(mode: string): string {
  const emojis: Record<string, string> = {
    srs: '\uD83E\uDDE0',
    sequential_review: '\uD83D\uDD01',
    random: '\uD83C\uDFB2',
    sequential: '\u27A1\uFE0F',
    by_date: '\uD83D\uDCC5',
  }
  return emojis[mode] ?? '\uD83D\uDCDA'
}

/** Filter sessions by deck ID */
export function filterSessionsByDeck(
  sessions: StudySession[],
  deckId: string
): StudySession[] {
  return sessions.filter((s) => s.deck_id === deckId)
}

/** Filter sessions by study mode */
export function filterSessionsByMode(
  sessions: StudySession[],
  mode: string
): StudySession[] {
  return sessions.filter((s) => s.study_mode === mode)
}

/** Paginate items */
export function paginateSessions<T>(
  items: T[],
  page: number,
  pageSize: number
): { items: T[]; totalPages: number; startIdx: number; endIdx: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.max(1, Math.min(page, totalPages))
  const startIdx = (safePage - 1) * pageSize
  const endIdx = Math.min(startIdx + pageSize, items.length)
  return {
    items: items.slice(startIdx, endIdx),
    totalPages,
    startIdx,
    endIdx,
  }
}

/**
 * Aggregate study_logs into pseudo StudySession records.
 * Groups logs by (deck_id, study_mode, date) so that historical
 * data from before study_sessions existed can be displayed.
 */
export function aggregateLogsToSessions(logs: StudyLog[]): StudySession[] {
  const groups = new Map<string, StudyLog[]>()

  for (const log of logs) {
    const d = new Date(log.studied_at)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const key = `${log.deck_id}|${log.study_mode}|${dateKey}`
    const arr = groups.get(key) ?? []
    arr.push(log)
    groups.set(key, arr)
  }

  const sessions: StudySession[] = []

  for (const [key, groupLogs] of groups.entries()) {
    const [deckId, studyMode] = key.split('|')
    const first = groupLogs[0]

    const ratings: Record<string, number> = {}
    let totalDurationMs = 0

    for (const log of groupLogs) {
      ratings[log.rating] = (ratings[log.rating] || 0) + 1
      totalDurationMs += log.review_duration_ms ?? 0
    }

    const timestamps = groupLogs.map((l) => new Date(l.studied_at).getTime())
    const minTime = Math.min(...timestamps)
    const maxTime = Math.max(...timestamps)

    sessions.push({
      id: `log-${key}`,
      user_id: first.user_id,
      deck_id: deckId,
      study_mode: studyMode,
      cards_studied: groupLogs.length,
      total_cards: groupLogs.length,
      total_duration_ms: totalDurationMs,
      ratings,
      started_at: new Date(minTime).toISOString(),
      completed_at: new Date(maxTime).toISOString(),
    })
  }

  return sessions.sort(
    (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  )
}

/**
 * Merge real study_sessions with aggregated log sessions.
 * For dates where a real study_session already exists for the same
 * (deck_id, study_mode, date), the aggregated one is skipped.
 */
export function mergeSessionsWithLogs(
  realSessions: StudySession[],
  logSessions: StudySession[]
): StudySession[] {
  const realKeys = new Set<string>()
  for (const s of realSessions) {
    const d = new Date(s.completed_at)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    realKeys.add(`${s.deck_id}|${s.study_mode}|${dateKey}`)
  }

  const dedupedLogs = logSessions.filter((s) => {
    const d = new Date(s.completed_at)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return !realKeys.has(`${s.deck_id}|${s.study_mode}|${dateKey}`)
  })

  return [...realSessions, ...dedupedLogs].sort(
    (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  )
}
