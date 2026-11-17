import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../../lib/supabase'
import { calendarRange, exportTraffic, fetchTraffic, type TrafficAccount, type TrafficClass, type TrafficFilters, type TrafficKind, type TrafficReport, type TrafficRow } from '../../lib/traffic-analytics'
import { AdminStatCard } from './AdminStatCard'

const control = 'rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground min-w-0'
const button = `${control} cursor-pointer disabled:opacity-50 disabled:cursor-default hover:bg-accent`
const classes: TrafficClass[] = ['all', 'external', 'internal', 'bot', 'suspected_bot', 'unknown']
const kindKeys: TrafficKind[] = ['all', 'page', 'content', 'request']
const classColors: Record<string, string> = {
  external: 'bg-success/10 text-success', internal: 'bg-purple-500/10 text-purple-600',
  bot: 'bg-orange-500/10 text-orange-600', suspected_bot: 'bg-warning/10 text-warning', unknown: 'bg-muted text-muted-foreground',
}

function dateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function defaultDates(days = 30) {
  const end = new Date(), start = new Date()
  start.setDate(start.getDate() - days + 1)
  return { from: dateInput(start), until: dateInput(end) }
}
function initialFilters(): TrafficFilters {
  const dates = defaultDates()
  return { ...calendarRange(dates.from, dates.until), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    classification: 'all', kind: 'all', source: 'all', device: 'all', environment: 'all', search: '', account: '', session: '' }
}

export function TrafficDashboard() {
  const { t, i18n } = useTranslation('traffic')
  const [filters, setFilters] = useState(initialFilters)
  const [draft, setDraft] = useState(filters)
  const [dates, setDates] = useState(defaultDates)
  const [report, setReport] = useState<TrafficReport | null>(null)
  const [accounts, setAccounts] = useState<TrafficAccount[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const n = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(i18n.language)
  const seconds = (value: number | null) => value == null ? '—' : `${n(Math.round(value / 1000))}${t('seconds')}`
  const stamp = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language, { timeZone: filters.timezone }) : t('notCollected')
  const failure = (e: unknown) => e instanceof Error ? e.message : (e as { message?: string })?.message || t('loadFailed')
  const refresh = () => { setSelected(null); setRevision(v => v + 1) }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    fetchTraffic(filters, page * 50, 50, controller.signal).then(
      data => { if (!controller.signal.aborted) setReport(data) },
      e => { if (!controller.signal.aborted) { setReport(null); setError(failure(e)) } },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // Error localization is read at failure time; changing language doesn't refetch data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, revision])

  useEffect(() => {
    let active = true
    supabase.rpc('admin_traffic_accounts').then(({ data, error: accountError }) => {
      if (!active) return
      if (accountError) setError(failure(accountError))
      else setAccounts((data as TrafficAccount[]) || [])
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  const apply = (next: TrafficFilters) => {
    setPage(0); setSelected(null); setFilters(next); setDraft(next); setNotice('')
  }
  const download = async () => {
    setExporting(true); setNotice('')
    try {
      // Freeze the report's time window, rather than including rows arriving mid-export.
      const output = await exportTraffic({ ...filters, end: report?.end || filters.end })
      const url = URL.createObjectURL(new Blob([output.csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = `reklue-traffic-${dateInput(new Date())}.csv`
      link.click(); URL.revokeObjectURL(url)
      setNotice(t('exported', { count: output.count }))
    } catch (e) { setNotice(t(failure(e), { defaultValue: failure(e) })) }
    finally { setExporting(false) }
  }

  const summary = report?.summary
  const hasFilters = draft.classification !== 'all' || draft.source !== 'all' || draft.device !== 'all' || draft.environment !== 'all' || !!draft.search || !!draft.account || !!draft.session || draft.kind !== 'all'

  return <section className="space-y-5" aria-label={t('title')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-foreground">{t('title')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p></div>
      <div className="flex gap-2"><button className={button} onClick={refresh} disabled={loading}>{t('refresh')}</button>
        <button className={button} onClick={download} disabled={loading || exporting || !summary?.total}>{exporting ? t('exporting') : t('export')}</button></div>
    </div>
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 text-sm text-foreground space-y-1">
      <p>{t('honestMetrics')}</p><p className="text-muted-foreground">{t('historyNotice')}</p>
    </div>
    <form className="rounded-xl border border-border bg-card p-4 space-y-3" onSubmit={event => {
      event.preventDefault()
      try { apply({ ...draft, ...calendarRange(dates.from, dates.until) }) } catch { setError(t('invalidDateRange')) }
    }}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">{t('from')}<input className={control} type="date" required value={dates.from} onChange={e => setDates(v => ({ ...v, from: e.target.value }))} /></label>
        <label className="grid gap-1 text-xs">{t('until')}<input className={control} type="date" required value={dates.until} onChange={e => setDates(v => ({ ...v, until: e.target.value }))} /></label>
        {[7, 30, 90, 0].map(days => <button key={days} type="button" className={button} onClick={() => {
          const next = days ? defaultDates(days) : { from: '2020-01-01', until: dateInput(new Date()) }
          setDates(next); apply({ ...draft, ...calendarRange(next.from, next.until) })
        }}>{days ? t('days', { count: days }) : t('allTime')}</button>)}
        <span className="text-xs text-muted-foreground pb-2">{filters.timezone}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Filter label={t('classification')} value={draft.classification} options={classes} name={key => t(`classes.${key}`)} onChange={v => setDraft({ ...draft, classification: v as TrafficClass })} />
        <Filter label={t('kind')} value={draft.kind} options={kindKeys} name={key => t(`kinds.${key}`)} onChange={v => setDraft({ ...draft, kind: v as TrafficKind })} />
        <Filter label={t('source')} value={draft.source} options={['all','direct','search','social','internal','authentication','development','other']} name={key => t(`sources.${key}`)} onChange={v => setDraft({ ...draft, source: v })} />
        <Filter label={t('device')} value={draft.device} options={['all','desktop','mobile','tablet','unknown']} name={key => t(`devices.${key}`)} onChange={v => setDraft({ ...draft, device: v })} />
        <Filter label={t('environment')} value={draft.environment} options={['all','production','development','preview','unknown']} name={key => t(`environments.${key}`)} onChange={v => setDraft({ ...draft, environment: v })} />
        <label className="grid gap-1 text-xs">{t('account')}<select className={control} value={draft.account} onChange={e => setDraft({ ...draft, account: e.target.value })}><option value="">{t('classes.all')}</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name || a.id.slice(0, 8)}{a.role === 'admin' || a.reason ? ` · ${t('classes.internal')}` : ''}</option>)}</select></label>
        <label className="grid gap-1 text-xs lg:col-span-2">{t('search')}<input className={control} maxLength={200} value={draft.search} placeholder={t('searchHint')} onChange={e => setDraft({ ...draft, search: e.target.value })} /></label>
        <label className="grid gap-1 text-xs lg:col-span-2">{t('sessionId')}<input className={control} maxLength={100} value={draft.session} placeholder={t('sessionHint')} onChange={e => setDraft({ ...draft, session: e.target.value })} /></label>
      </div>
      <div className="flex items-center gap-2"><button type="submit" className={`${button.replace('bg-card', '').replace('text-foreground', '')} bg-brand text-white hover:bg-brand/90`}>{t('apply')}</button>{hasFilters && <button className={button} type="button" onClick={() => {
        const next = { ...initialFilters(), start: filters.start, end: filters.end }; apply(next)
      }}>{t('reset')}</button>}<span className="text-xs text-muted-foreground">{t('filterNotice')}</span></div>
    </form>
    {error && <div role="alert" className="rounded-lg bg-destructive/10 p-4 text-destructive">{t('loadFailed')} {error}<button className={`${button} ml-2`} onClick={refresh}>{t('refresh')}</button></div>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>}
    {report && summary && <div className={loading ? 'space-y-5 opacity-50 pointer-events-none' : 'space-y-5'} aria-busy={loading}>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <AdminStatCard label={t('pageViews')} value={summary.page_views} subtitle={t('pageDefinition')} />
        <AdminStatCard label={t('contentViews')} value={summary.content_views} color="green" subtitle={t('contentDefinition')} />
        <AdminStatCard label={t('visitors')} value={summary.visitors} color="purple" subtitle={t('visitorDefinition')} />
        <AdminStatCard label={t('httpRequests')} value={summary.http_requests} color="orange" subtitle={t('requestDefinition')} />
        <AdminStatCard label={t('sessions')} value={summary.sessions} color="teal" subtitle={t('sessionDefinition')} />
        <AdminStatCard label={t('engagedReads')} value={summary.engaged_reads} color="green" subtitle={t('engagedDefinition')} />
        <AdminStatCard label={t('averageDuration')} value={seconds(summary.avg_duration_ms)} color="orange" subtitle={t('durationDefinition')} />
        <AdminStatCard label={t('averageScroll')} value={summary.avg_scroll_percent == null ? '—' : `${n(summary.avg_scroll_percent)}%`} subtitle={t('scrollDefinition')} />
      </div>
      <Panel title={t('classificationTitle')}><p className="text-xs text-muted-foreground mb-3">{t('classificationNotice')}</p>
        <Table headers={[t('classification'),t('pageViews'),t('contentViews'),t('httpRequests'),t('inspect')]} rows={classes.filter(c => c !== 'all').map(cls => {
          const counts = report.classes.find(c => c.classification === cls)
          return [<Badge key={cls} value={cls} label={t(`classes.${cls}`)} />,n(counts?.page_views || 0),n(counts?.content_views || 0),n(counts?.http_requests || 0),
            <button key="inspect" className={button} onClick={() => apply({ ...filters, classification: cls })}>{t('inspect')}</button>]
        })} empty={t('empty')} />
      </Panel>
      {!summary.total && <p className="rounded-xl border border-border p-6 text-muted-foreground">{t('empty')}</p>}
      {!!report.daily.length && <Panel title={t('dailyTitle')}><div className="h-64" role="img" aria-label={t('dailyTitle')}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={report.daily}><CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => String(v).slice(5)} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip /><Legend /><Bar dataKey="page_views" name={t('pageViews')} fill="#6366f1" /><Bar dataKey="content_views" name={t('contentViews')} fill="#10b981" /><Bar dataKey="http_requests" name={t('httpRequests')} fill="#f59e0b" />
        </BarChart></ResponsiveContainer></div></Panel>}
      <Panel title={t('pagesTitle')}><p className="text-xs text-muted-foreground mb-2">{t('top30')}</p><Table headers={[t('page'),t('pageViews'),t('contentViews'),t('httpRequests'),t('engagedReads'),t('averageDuration'),t('maxScroll')]} rows={report.pages.map(p => [
        <button className="text-left text-brand hover:underline max-w-xs break-words" onClick={() => apply({ ...filters, search: p.page_path })}>{p.title || p.page_path}</button>,n(p.page_views),n(p.content_views),n(p.http_requests),n(p.engaged_reads),seconds(p.avg_duration_ms),p.max_scroll_percent == null ? '—' : `${n(p.max_scroll_percent)}%`,
      ])} empty={t('empty')} /></Panel>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={t('sourcesTitle')}><Table headers={[t('source'),t('domain'),t('pageViews'),t('contentViews'),t('httpRequests')]} rows={report.sources.map(s => [t(`sources.${s.source}`, { defaultValue: s.source }),s.referrer_domain || t('noReferrer'),n(s.page_views),n(s.content_views),n(s.http_requests)])} empty={t('empty')} /></Panel>
        <Panel title={t('devicesTitle')}><p className="text-xs text-muted-foreground mb-2">{t('deviceNotice')}</p><Table headers={[t('device'),t('width'),t('records')]} rows={report.devices.map(d => [t(`devices.${d.device}`),n(d.viewport_width),n(d.total)])} empty={t('empty')} /></Panel>
        <Panel title={t('campaignsTitle')}><Table headers={['UTM source','UTM medium','UTM campaign',t('pageViews'),t('contentViews')]} rows={report.campaigns.map(c => [c.utm_source || '—',c.utm_medium || '—',c.utm_campaign || '—',n(c.page_views),n(c.content_views)])} empty={t('noCampaigns')} /></Panel>
        <Panel title={t('countriesTitle')}><Table headers={[t('country'),'ASN',t('httpRequests')]} rows={report.countries.map(c => [c.country || t('notCollected'),n(c.asn),n(c.http_requests)])} empty={t('edgeNotice')} /></Panel>
        <Panel title={t('conversionsTitle')}><p className="text-xs text-muted-foreground mb-2">{t('conversionNotice')}</p><Table headers={[t('category'),t('action'),t('records')]} rows={report.conversions.map(c => [c.category,c.action,n(c.total)])} empty={t('empty')} /></Panel>
        <Panel title={t('coverageTitle')}><dl className="text-sm space-y-2"><dt>{t('contextSince')}</dt><dd className="text-muted-foreground">{stamp(report.coverage.first_browser_context)}</dd>
          <dt>{t('edgeSince')}</dt><dd className="text-muted-foreground">{stamp(report.coverage.first_edge_request)}</dd></dl><p className="mt-3 text-xs text-muted-foreground">{t('coverageNotice')}</p></Panel>
      </div>
      <Panel title={t('visitsTitle')}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-sm"><span>{t('recordCount', { count: summary.total })}</span><span>{t('pageNumber', { page: page + 1, pages: Math.max(1, Math.ceil(summary.total / 50)) })}</span></div>
        <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr className="border-b border-border text-muted-foreground">{['time','kind','classification','page','source','account','duration','scroll','details'].map(k => <th key={k} className="px-2 py-3 whitespace-nowrap">{t(k)}</th>)}</tr></thead>
          <tbody>{report.rows.map(row => {
            const key = `${row.kind}:${row.id}`
            return <Fragment key={key}><tr className="border-b border-border hover:bg-accent/50">
              <td className="px-2 py-3 whitespace-nowrap">{stamp(row.created_at)}</td><td className="px-2">{t(`kinds.${row.kind}`)}</td>
              <td className="px-2"><Badge value={row.classification} label={t(`classes.${row.classification}`)} /></td>
              <td className="px-2 max-w-64 break-words">{row.title || row.page_path}</td><td className="px-2">{row.referrer_domain || t(`sources.${row.source}`)}</td>
              <td className="px-2">{row.account_name || (row.viewer_id ? row.viewer_id.slice(0,8) : t(row.kind === 'request' ? 'notCollected' : 'anonymous'))}</td>
              <td className="px-2 whitespace-nowrap">{seconds(row.duration_ms)}</td><td className="px-2">{row.scroll_percent == null ? '—' : `${n(row.scroll_percent)}%`}</td>
              <td className="px-2"><button className={button} aria-expanded={selected === key} onClick={() => setSelected(selected === key ? null : key)}>{t('details')}</button></td>
            </tr>{selected === key && <tr><td colSpan={9} className="bg-accent/30 p-4"><VisitDetail row={row} onSaved={refresh} onSession={session => apply({ ...initialFilters(), start: filters.start, end: filters.end, session })} /></td></tr>}</Fragment>
          })}</tbody></table></div>
        <div className="flex justify-end gap-2 mt-3"><button className={button} disabled={page === 0 || loading} onClick={() => { setSelected(null); setPage(p => p - 1) }}>{t('previous')}</button><button className={button} disabled={(page + 1) * 50 >= summary.total || loading} onClick={() => { setSelected(null); setPage(p => p + 1) }}>{t('next')}</button></div>
      </Panel>
      <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer font-medium text-foreground">{t('accountsTitle')}</summary>
        <p className="text-sm text-muted-foreground my-3">{t('accountsNotice')}</p><div className="space-y-3">{accounts.map(account => <AccountRule key={`${account.id}:${account.reason}`} account={account} onSaved={refresh} />)}</div>
      </details>
    </div>}
  </section>
}

function Filter({ label, value, options, name, onChange }: { label: string; value: string; options: string[]; name: (key: string) => string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-xs">{label}<select className={control} value={value} onChange={e => onChange(e.target.value)}>{options.map(key => <option key={key} value={key}>{name(key)}</option>)}</select></label>
}
function Badge({ value, label }: { value: string; label: string }) {
  return <span className={`inline-block rounded-md px-2 py-1 text-xs whitespace-nowrap ${classColors[value] || ''}`}>{label}</span>
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-border bg-card p-4"><h3 className="font-medium text-sm text-foreground mb-3">{title}</h3>{children}</section>
}
function Table({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground py-3">{empty}</p>
  return <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr className="text-muted-foreground border-b border-border">{headers.map((h,i) => <th key={i} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i} className="border-b border-border last:border-0">{row.map((cell,j) => <td key={j} className="px-2 py-2 break-words">{cell}</td>)}</tr>)}</tbody></table></div>
}

function VisitDetail({ row, onSaved, onSession }: { row: TrafficRow; onSaved: () => void; onSession: (session: string) => void }) {
  const { t } = useTranslation('traffic')
  const [classification, setClassification] = useState<TrafficClass>(row.classification)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (reset = false) => {
    setBusy(true); setError('')
    const { error: saveError } = await supabase.rpc('admin_annotate_traffic', { p_kind: row.kind, p_event_id: row.id,
      p_classification: reset ? null : classification, p_reason: reset ? null : reason })
    setBusy(false)
    if (saveError) setError(saveError.message)
    else onSaved()
  }
  return <div className="space-y-4">
    {row.session_id && <button className={button} onClick={() => onSession(row.session_id!)}>{t('inspectSession')}</button>}
    <dl className="grid sm:grid-cols-2 gap-3 text-xs">{[
      [t('evidence'), t(`evidenceKeys.${row.evidence}`, { defaultValue: row.evidence })], [t('page'), row.page_path],
      [t('host'),row.hostname], [t('environment'),t(`environments.${row.environment}`)], ['User-Agent',row.user_agent],
      [t('referrer'),row.referrer], [t('sessionId'),row.session_id], [t('accountId'),row.viewer_id],
      [t('device'),`${t(`devices.${row.device}`)} / ${row.viewport_width ?? '—'}px`],
      [t('edgeVerification'),row.verified_bot == null ? t('notCollected') : t(row.verified_bot ? 'yes' : 'no')],
      [t('country'),row.country], ['ASN',row.asn], ['HTTP',row.response_status],
      ['UTM',[row.utm_source,row.utm_medium,row.utm_campaign].filter(Boolean).join(' / ')],
    ].map(([label,value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value ?? t('notCollected')}</dd></div>)}</dl>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void save() }}>
      <Filter label={t('manualClassification')} value={classification} options={classes.filter(c => c !== 'all')} name={key => t(`classes.${key}`)} onChange={v => setClassification(v as TrafficClass)} />
      <label className="grid gap-1 text-xs flex-1 min-w-48">{t('reason')}<input className={control} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('reasonHint')} /></label>
      <button className={button} disabled={busy || !reason.trim()}>{t('save')}</button><button type="button" className={button} disabled={busy} onClick={() => void save(true)}>{t('restoreAutomatic')}</button>
    </form>{error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}

function AccountRule({ account, onSaved }: { account: TrafficAccount; onSaved: () => void }) {
  const { t, i18n } = useTranslation('traffic')
  const [reason, setReason] = useState(account.reason || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (remove = false) => {
    setBusy(true); setError('')
    const { error: result } = await supabase.rpc('admin_set_traffic_account', { p_user_id: account.id, p_reason: remove ? null : reason.trim() })
    setBusy(false)
    if (result) setError(result.message)
    else onSaved()
  }
  return <form className="border-b border-border pb-3 flex flex-wrap items-center gap-2 text-xs" onSubmit={e => { e.preventDefault(); void save() }}>
    <span className="w-44 break-words">{account.display_name || account.id.slice(0,8)}<span className="block text-muted-foreground">{account.page_views.toLocaleString(i18n.language)} / {account.content_views.toLocaleString(i18n.language)} {t('viewsShort')}</span></span>
    {account.role === 'admin' ? <Badge value="internal" label={t('adminAlwaysInternal')} /> : <>
      <input className={`${control} flex-1 min-w-44`} aria-label={`${t('reason')} ${account.display_name || account.id}`} maxLength={500} required placeholder={t('accountReasonHint')} value={reason} onChange={e => setReason(e.target.value)} />
      <button className={button} disabled={busy || !reason.trim()}>{t('markInternal')}</button>{account.reason && <button type="button" className={button} disabled={busy} onClick={() => void save(true)}>{t('removeRule')}</button>}
    </>}{error && <p role="alert" className="text-destructive">{error}</p>}
  </form>
}
