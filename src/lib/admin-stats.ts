import type {
  AdminUserSignup,
  AdminDailyStudyActivity,
  AdminModeBreakdown,
  AdminActiveUsers,
  AdminRecentActivity,
  AdminPopularContent,
  AdminReferrerBreakdown,
  AdminDeviceBreakdown,
  AdminScrollDepthData,
  AdminConversionFunnelData,
  AdminBounceRate,
  AdminUtmSourceBreakdown,
} from '../types/database'

// ── User Growth Series ──

export interface UserGrowthPoint {
  date: string
  cumulative: number
}

export function computeUserGrowthSeries(signups: AdminUserSignup[]): UserGrowthPoint[] {
  if (signups.length === 0) return []

  let cumulative = 0
  return signups.map((s) => {
    cumulative += s.count
    return { date: s.date, cumulative }
  })
}

// ── Active vs Inactive Users ──

export interface ActiveInactiveSlice {
  name: 'active' | 'inactive'
  value: number
}

export function computeActiveInactiveUsers(data: AdminActiveUsers): ActiveInactiveSlice[] {
  // Cap active at total_users to handle data anomalies (mau > total_users)
  const active = Math.min(data.mau, data.total_users)
  const inactive = Math.max(0, data.total_users - active)
  return [
    { name: 'active', value: active },
    { name: 'inactive', value: inactive },
  ]
}

// ── Fill Daily Activity Gaps ──

export function fillDailyActivityGaps(
  data: AdminDailyStudyActivity[],
  days: number,
): AdminDailyStudyActivity[] {
  if (data.length === 0) return []

  const dataMap = new Map(data.map((d) => [d.date, d]))

  // Find the latest date in data (sort to handle out-of-order input)
  const dates = data.map((d) => d.date).sort()
  const latestStr = dates[dates.length - 1]
  const [y, m, d] = latestStr.split('-').map(Number)
  const latest = new Date(Date.UTC(y, m - 1, d))

  const result: AdminDailyStudyActivity[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(latest)
    date.setUTCDate(date.getUTCDate() - i)
    const key = date.toISOString().split('T')[0]
    const existing = dataMap.get(key)
    result.push(existing ?? { date: key, sessions: 0, cards: 0, total_duration_ms: 0 })
  }

  return result
}

// ── Mode Usage Percentages ──

export interface ModeUsagePercentage {
  mode: string
  session_count: number
  percentage: number
}

export function computeModeUsagePercentages(modes: AdminModeBreakdown[]): ModeUsagePercentage[] {
  if (modes.length === 0) return []

  const total = modes.reduce((s, m) => s + m.session_count, 0)
  if (total === 0) return []

  return modes.map((m) => ({
    mode: m.mode,
    session_count: m.session_count,
    percentage: Math.round((m.session_count / total) * 100),
  }))
}

// ── Aggregate Ratings ──

const RATING_ORDER = ['again', 'hard', 'good', 'easy']

export interface RatingSlice {
  rating: string
  count: number
  percentage: number
}

export function aggregateRatings(sessions: { ratings: Record<string, number> }[]): RatingSlice[] {
  if (sessions.length === 0) return []

  const counts = new Map<string, number>()
  for (const s of sessions) {
    for (const [rating, count] of Object.entries(s.ratings)) {
      counts.set(rating, (counts.get(rating) ?? 0) + count)
    }
  }

  const total = Array.from(counts.values()).reduce((s, c) => s + c, 0)
  if (total === 0) return []

  return Array.from(counts.entries())
    .sort((a, b) => {
      const ai = RATING_ORDER.indexOf(a[0])
      const bi = RATING_ORDER.indexOf(b[0])
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    .map(([rating, count]) => ({
      rating,
      count,
      percentage: Math.round((count / total) * 100),
    }))
}

// ── Engagement Metrics ──

export interface EngagementMetrics {
  dauMauRatio: number   // DAU/MAU * 100, capped at 100
  wauMauRatio: number   // WAU/MAU * 100, capped at 100
  adoptionRate: number  // MAU/total_users * 100, capped at 100
}

export function computeEngagementMetrics(data: AdminActiveUsers): EngagementMetrics {
  const dauMauRatio = data.mau > 0
    ? Math.min(100, Math.round((data.dau / data.mau) * 100))
    : 0
  const wauMauRatio = data.mau > 0
    ? Math.min(100, Math.round((data.wau / data.mau) * 100))
    : 0
  const adoptionRate = data.total_users > 0
    ? Math.min(100, Math.round((data.mau / data.total_users) * 100))
    : 0

  return { dauMauRatio, wauMauRatio, adoptionRate }
}

// ── Validate Admin Days Parameter ──

export function validateAdminDays(days: number | undefined, defaultVal = 30): number {
  if (days === undefined || !Number.isFinite(days)) return defaultVal
  return Math.max(1, Math.min(365, Math.floor(days)))
}

// ── Format Total Study Time ──

export function formatTotalStudyTime(ms: number): string {
  if (ms <= 0) return '0m'

  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ── Extract Error Message (handles PostgrestError plain objects) ──

export function extractErrorMessage(e: unknown): string {
  if (e == null) return 'Unknown error'
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'object' && 'message' in e && typeof (e as Record<string, unknown>).message === 'string') {
    return (e as Record<string, unknown>).message as string
  }
  if (typeof e === 'object' && 'code' in e) {
    return `Error code: ${(e as Record<string, unknown>).code}`
  }
  return String(e)
}

// ── Trend Change (WoW / MoM) ──

export interface TrendChange {
  change: number   // percentage change (-100 to +∞)
  direction: 'up' | 'down' | 'flat'
}

export function computeTrendChange(current: number, previous: number): TrendChange {
  if (previous === 0) return { change: 0, direction: 'flat' }
  const change = Math.round(((current - previous) / previous) * 100)
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  return { change, direction }
}

// ── Mode Effectiveness (cards/session, avg duration by mode) ──

export interface ModeEffectivenessRow {
  mode: string
  session_count: number
  avgCardsPerSession: number
  avgDurationMin: number
}

export function computeModeEffectiveness(modes: AdminModeBreakdown[]): ModeEffectivenessRow[] {
  if (modes.length === 0) return []

  return modes.map((m) => ({
    mode: m.mode,
    session_count: m.session_count,
    avgCardsPerSession: m.session_count > 0
      ? Math.round(m.total_cards / m.session_count)
      : 0,
    avgDurationMin: m.session_count > 0
      ? Math.round((m.total_duration_ms / m.session_count / 60_000) * 10) / 10
      : 0,
  }))
}

// ── Conversion Rate ──

export function computeConversionRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.min(100, Math.round((numerator / denominator) * 100))
}

// ── Week-over-Week from Daily Activity ──

export interface WeekOverWeekTrends {
  sessions: TrendChange
  activeUsers: TrendChange
  cards: TrendChange
}

export function computeWeekOverWeekFromDaily(data: AdminRecentActivity[]): WeekOverWeekTrends {
  const flat: TrendChange = { change: 0, direction: 'flat' }
  if (data.length < 14) return { sessions: flat, activeUsers: flat, cards: flat }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const recent = sorted.slice(-7)
  const previous = sorted.slice(-14, -7)

  const sum = (arr: AdminRecentActivity[], key: 'sessions' | 'active_users' | 'cards') =>
    arr.reduce((s, d) => s + d[key], 0)

  return {
    sessions: computeTrendChange(sum(recent, 'sessions'), sum(previous, 'sessions')),
    activeUsers: computeTrendChange(sum(recent, 'active_users'), sum(previous, 'active_users')),
    cards: computeTrendChange(sum(recent, 'cards'), sum(previous, 'cards')),
  }
}

// ── Label Helpers (map DB enum values to i18n keys) ──

const STUDY_MODES = new Set(['srs', 'sequential_review', 'random', 'sequential', 'by_date'])
const SRS_STATUSES = new Set(['new', 'learning', 'review', 'suspended'])
const SHARE_MODES = new Set(['copy', 'subscribe', 'snapshot'])
const RATINGS = new Set(['again', 'hard', 'good', 'easy'])
const USER_ROLES = new Set(['admin', 'user'])

export function studyModeLabel(mode: string): string {
  return STUDY_MODES.has(mode) ? `study.modes.${mode}` : mode
}

export function srsStatusLabel(status: string): string {
  return SRS_STATUSES.has(status) ? `study.srsStatuses.${status}` : status
}

export function shareModeLabel(mode: string): string {
  return SHARE_MODES.has(mode) ? `market.shareModes.${mode}` : mode
}

export function ratingLabel(rating: string): string {
  return RATINGS.has(rating) ? `study.ratings.${rating}` : rating
}

export function userRoleLabel(role: string): string {
  return USER_ROLES.has(role) ? `users.roles.${role}` : role
}

// ── Format Stat Number (locale-aware comma separator) ──

export function formatStatNumber(value: string | number): string {
  if (typeof value === 'string') return value
  return value.toLocaleString()
}

// ── Locale Distribution (content analytics) ──

export interface LocaleDistributionItem {
  locale: string
  count: number
  published: number
  percentage: number
}

export function computeLocaleDistribution(
  data: { locale: string; count: number; published: number }[],
): LocaleDistributionItem[] {
  if (data.length === 0) return []

  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return data.map((d) => ({ ...d, percentage: 0 }))

  return data.map((d) => ({
    ...d,
    percentage: Math.round((d.count / total) * 100),
  }))
}

// ── Tag Cloud Data ──

export type TagWeight = 'sm' | 'md' | 'lg' | 'xl'

export interface TagCloudItem {
  tag: string
  count: number
  weight: TagWeight
}

export function computeTagCloudData(
  tags: { tag: string; count: number }[],
  max = 15,
): TagCloudItem[] {
  if (tags.length === 0) return []

  const sliced = tags.slice(0, max)
  const counts = sliced.map((t) => t.count)
  const minCount = Math.min(...counts)
  const maxCount = Math.max(...counts)

  if (minCount === maxCount) {
    return sliced.map((t) => ({ ...t, weight: 'md' as TagWeight }))
  }

  const range = maxCount - minCount
  return sliced.map((t) => {
    const ratio = (t.count - minCount) / range
    let weight: TagWeight
    if (ratio < 0.25) weight = 'sm'
    else if (ratio < 0.5) weight = 'md'
    else if (ratio < 0.75) weight = 'lg'
    else weight = 'xl'
    return { ...t, weight }
  })
}

// ── Publishing Timeline ──

export interface PublishingTimelinePoint {
  month: string
  count: number
  cumulative: number
}

export function computePublishingTimeline(
  data: { month: string; count: number }[],
): PublishingTimelinePoint[] {
  if (data.length === 0) return []

  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month))

  // Fill missing months between first and last
  const result: PublishingTimelinePoint[] = []
  const dataMap = new Map(sorted.map((d) => [d.month, d.count]))
  const [startY, startM] = sorted[0].month.split('-').map(Number)
  const [endY, endM] = sorted[sorted.length - 1].month.split('-').map(Number)

  let cumulative = 0
  let y = startY
  let m = startM
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const count = dataMap.get(key) ?? 0
    cumulative += count
    result.push({ month: key, count, cumulative })
    m++
    if (m > 12) { m = 1; y++ }
  }

  return result
}

// ── Format View Duration ──

export function formatViewDuration(ms: number): string {
  if (ms <= 0) return '0s'

  const totalSeconds = Math.floor(ms / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const seconds = totalSeconds % 60
  const minutes = totalMinutes % 60

  if (totalHours > 0) return `${totalHours}h ${minutes}m`
  if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`
  return `${totalSeconds}s`
}

// ── Fill Daily View Gaps ──

export interface DailyViewPoint {
  date: string
  views: number
  unique_viewers: number
}

export function fillDailyViewGaps(data: DailyViewPoint[], days: number): DailyViewPoint[] {
  if (data.length === 0) return []

  const dataMap = new Map(data.map((d) => [d.date, d]))
  const dates = data.map((d) => d.date).sort()
  const latestStr = dates[dates.length - 1]
  const [y, m, d] = latestStr.split('-').map(Number)
  const latest = new Date(Date.UTC(y, m - 1, d))

  const result: DailyViewPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(latest)
    date.setUTCDate(date.getUTCDate() - i)
    const key = date.toISOString().split('T')[0]
    const existing = dataMap.get(key)
    result.push(existing ?? { date: key, views: 0, unique_viewers: 0 })
  }

  return result
}

// ── Popular Content Table ──

export interface PopularContentRow {
  id: string
  title: string
  slug: string
  locale: string
  view_count: number
  unique_viewers: number
  avg_duration: string
}

export function computePopularContentTable(data: AdminPopularContent[]): PopularContentRow[] {
  return data.map((d) => ({
    id: d.id,
    title: d.title,
    slug: d.slug,
    locale: d.locale,
    view_count: d.view_count,
    unique_viewers: d.unique_viewers,
    avg_duration: formatViewDuration(d.avg_duration_ms),
  }))
}

// ── Referrer Breakdown ──

export interface ReferrerBreakdownItem {
  category: string
  count: number
  percentage: number
}

export function computeReferrerBreakdown(data: AdminReferrerBreakdown[]): ReferrerBreakdownItem[] {
  if (data.length === 0) return []

  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return []

  return data.map((d) => ({
    category: d.category,
    count: d.count,
    percentage: Math.round((d.count / total) * 100),
  }))
}

// ── Device Breakdown ──

export interface DeviceBreakdownItem {
  device: string
  count: number
  percentage: number
}

export function computeDeviceBreakdown(data: AdminDeviceBreakdown[]): DeviceBreakdownItem[] {
  if (data.length === 0) return []

  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return []

  return data.map((d) => ({
    device: d.device_type,
    count: d.count,
    percentage: Math.round((d.count / total) * 100),
  }))
}

// ── Scroll Depth Distribution ──

export interface ScrollDepthDistributionItem {
  label: string
  milestone: number
  count: number
}

export function computeScrollDepthDistribution(data: AdminScrollDepthData[]): ScrollDepthDistributionItem[] {
  if (data.length === 0) return []

  return data
    .sort((a, b) => a.milestone - b.milestone)
    .map((d) => ({
      label: `${d.milestone}%`,
      milestone: d.milestone,
      count: d.count,
    }))
}

// ── Conversion Funnel ──

export interface ConversionFunnelStep {
  label: string
  key: string
  count: number
  percentage: number
}

export function computeConversionFunnel(data: AdminConversionFunnelData): ConversionFunnelStep[] {
  const steps: { key: string; label: string; value: number }[] = [
    { key: 'content_viewers', label: 'Content Viewers', value: data.content_viewers },
    { key: 'signed_up', label: 'Signed Up', value: data.signed_up },
    { key: 'created_deck', label: 'Created Deck', value: data.created_deck },
    { key: 'studied_cards', label: 'Studied Cards', value: data.studied_cards },
  ]

  const top = steps[0].value || 1

  return steps.map((s) => ({
    label: s.label,
    key: s.key,
    count: s.value,
    percentage: Math.round((s.value / top) * 100),
  }))
}

// ── Merge Daily Summary with Live (Phase 4) ──

export interface DailySummaryRow {
  date: string
  view_count: number
  unique_sessions: number
  unique_viewers: number
  avg_duration_ms: number
}

export function mergeDailySummaryWithLive(
  summaries: DailySummaryRow[],
  live: DailyViewPoint[],
): DailyViewPoint[] {
  const merged = new Map<string, DailyViewPoint>()

  for (const s of summaries) {
    merged.set(s.date, {
      date: s.date,
      views: s.view_count,
      unique_viewers: s.unique_viewers,
    })
  }

  // Live data overrides summaries for recent days
  for (const l of live) {
    merged.set(l.date, l)
  }

  return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ── Bounce Rate ──

export interface BounceRateMetrics {
  bounceRate: number   // percentage 0–100
  engagedRate: number  // percentage 0–100
  total: number
  bounced: number
  engaged: number
}

export function computeBounceRate(data: AdminBounceRate): BounceRateMetrics {
  const total = data.total_content_views
  if (total === 0) {
    return { bounceRate: 0, engagedRate: 0, total: 0, bounced: 0, engaged: 0 }
  }
  return {
    bounceRate: Math.round((data.bounced_views / total) * 100),
    engagedRate: Math.round((data.engaged_views / total) * 100),
    total,
    bounced: data.bounced_views,
    engaged: data.engaged_views,
  }
}

// ── Top Pages Table ──

export interface TopPageRow {
  page_path: string
  view_count: number
  unique_visitors: number
}

export function computeTopPagesTable(data: { page_path: string; view_count: number; unique_visitors: number }[]): TopPageRow[] {
  return data.map((d) => ({
    page_path: d.page_path,
    view_count: d.view_count,
    unique_visitors: d.unique_visitors,
  }))
}

// ── UTM Source Breakdown ──

export interface UtmSourceBreakdownItem {
  source: string
  count: number
  percentage: number
}

export function computeUtmSourceBreakdown(data: AdminUtmSourceBreakdown[]): UtmSourceBreakdownItem[] {
  if (data.length === 0) return []

  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return []

  return data.map((d) => ({
    source: d.source,
    count: d.count,
    percentage: Math.round((d.count / total) * 100),
  }))
}
