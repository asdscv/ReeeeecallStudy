import { supabase } from './supabase'

export type TrafficClass = 'all' | 'external' | 'internal' | 'bot' | 'suspected_bot' | 'unknown'
export type TrafficKind = 'all' | 'page' | 'content' | 'request'
export interface TrafficFilters {
  start: string; end: string; timezone: string; classification: TrafficClass
  kind: TrafficKind; source: string; device: string; environment: string; search: string; account: string; session: string
}
export interface TrafficRow {
  id: string; kind: Exclude<TrafficKind, 'all'>; created_at: string; page_path: string; title: string | null
  viewer_id: string | null; session_id: string | null; account_name: string; hostname: string | null
  environment: string; user_agent: string | null; referrer: string | null; referrer_domain: string | null
  source: string; device: string; viewport_width: number | null; utm_source: string | null
  utm_medium: string | null; utm_campaign: string | null; duration_ms: number | null; scroll_percent: number | null
  country: string | null; asn: number | null; verified_bot: boolean | null; response_status: number | null
  classification: Exclude<TrafficClass, 'all'>; evidence: string
}
export interface TrafficCounts { page_views: number; content_views: number; http_requests: number }
export interface TrafficSummary extends TrafficCounts {
  total: number; visitors: number; sessions: number; engaged_reads: number
  avg_duration_ms: number | null; avg_scroll_percent: number | null
}
export interface TrafficReport {
  summary: TrafficSummary
  classes: (TrafficCounts & { classification: Exclude<TrafficClass, 'all'> })[]
  daily: (TrafficCounts & { date: string })[]
  pages: (TrafficCounts & { page_path: string; title: string | null; engaged_reads: number; avg_duration_ms: number | null; max_scroll_percent: number | null })[]
  sources: (TrafficCounts & { source: string; referrer_domain: string | null })[]
  devices: { device: string; viewport_width: number | null; total: number }[]
  campaigns: (Pick<TrafficCounts, 'page_views' | 'content_views'> & { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null })[]
  countries: { country: string | null; asn: number | null; http_requests: number }[]
  conversions: { category: string; action: string; total: number }[]
  rows: TrafficRow[]
  start: string; end: string; timezone: string
  coverage: { first_edge_request: string | null; first_browser_context: string | null }
}
export interface TrafficAccount { id: string; display_name: string | null; role: string; reason: string | null; page_views: number; content_views: number }

export async function fetchTraffic(filters: TrafficFilters, offset = 0, limit = 50, signal?: AbortSignal): Promise<TrafficReport> {
  const query = supabase.rpc('admin_traffic_report', { p_filters: filters, p_offset: offset, p_limit: limit })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
  return data as TrafficReport
}

/** Date inputs are calendar days in the browser's displayed timezone; end is exclusive. */
export function calendarRange(start: string, end: string): { start: string; end: string } {
  const from = new Date(`${start}T00:00:00`)
  const until = new Date(`${end}T00:00:00`)
  until.setDate(until.getDate() + 1)
  if (!Number.isFinite(+from) || !Number.isFinite(+until) || from >= until) throw new Error('invalidDateRange')
  return { start: from.toISOString(), end: until.toISOString() }
}

/** Spreadsheet applications must never execute referrers/paths as formulas. */
export function trafficCsv(rows: TrafficRow[]): string {
  const columns: (keyof TrafficRow)[] = ['created_at','kind','classification','evidence','page_path','title','viewer_id',
    'session_id','account_name','hostname','environment','source','referrer_domain','referrer','device','viewport_width',
    'utm_source','utm_medium','utm_campaign','duration_ms','scroll_percent','user_agent','country','asn','verified_bot','response_status']
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value)
    const safe = /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n')
}

export async function exportTraffic(filters: TrafficFilters): Promise<{ csv: string; count: number }> {
  const rows: TrafficRow[] = []
  let total = 0
  do {
    const result = await fetchTraffic(filters, rows.length, 1000)
    total = result.summary.total
    if (total > 100_000) throw new Error('exportTooLarge')
    rows.push(...result.rows)
    if (!result.rows.length && rows.length < total) throw new Error('exportChanged')
  } while (rows.length < total)
  return { csv: trafficCsv(rows), count: rows.length }
}
