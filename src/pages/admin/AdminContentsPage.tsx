import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { toIntlLocale, LOCALE_CONFIG, type SupportedLocale } from '../../lib/locale-utils'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { ContentViewsChart } from '../../components/admin/ContentViewsChart'
import { PublishingTimelineChart } from '../../components/admin/PublishingTimelineChart'
import { TagDistributionChart } from '../../components/admin/TagDistributionChart'
import { ReferrerBreakdownChart } from '../../components/admin/ReferrerBreakdownChart'
import { DeviceBreakdownChart } from '../../components/admin/DeviceBreakdownChart'
import { ScrollDepthChart } from '../../components/admin/ScrollDepthChart'
import { ConversionFunnelChart } from '../../components/admin/ConversionFunnelChart'
import { UtmSourceChart } from '../../components/admin/UtmSourceChart'
import {
  computeLocaleDistribution,
  computeTagCloudData,
  computePublishingTimeline,
  formatViewDuration,
  fillDailyViewGaps,
  computePopularContentTable,
  computeReferrerBreakdown,
  computeDeviceBreakdown,
  computeScrollDepthDistribution,
  computeConversionFunnel,
  computeUtmSourceBreakdown,
  computeBounceRate,
  computeTopPagesTable,
  computeConversionRate,
} from '../../lib/admin-stats'
import { formatRelativeTime, formatDateKeyShort } from '../../lib/date-utils'

const LOCALE_COLORS = Object.fromEntries(
  Object.entries(LOCALE_CONFIG).map(([k, v]) => [k, v.color]),
) as Record<SupportedLocale, typeof LOCALE_CONFIG[SupportedLocale]['color']>

const VIEW_PERIOD_OPTIONS = [7, 14, 30, 60, 90] as const

export function AdminContentsPage() {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = toIntlLocale(i18n.language)
  const [viewDays, setViewDays] = useState<number>(30)
  const {
    contentsAnalytics, contentsLoading, contentsError, fetchContents,
    pageViewsAnalytics, pageViewsLoading, fetchPageViews,
  } = useAdminStore()

  useEffect(() => {
    fetchContents()
    fetchPageViews()
  }, [fetchContents, fetchPageViews])

  if (contentsLoading && !contentsAnalytics) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (contentsError) {
    return <AdminErrorState error={contentsError} onRetry={fetchContents} />
  }

  const data = contentsAnalytics
  if (!data) return null

  const locales = computeLocaleDistribution(data.by_locale)
  const tags = computeTagCloudData(data.top_tags)
  const timeline = computePublishingTimeline(data.publishing_timeline)
  const dailyViews = fillDailyViewGaps(data.daily_views, viewDays)
  const popularRows = computePopularContentTable(data.popular_content)
  const referrerData = computeReferrerBreakdown(data.referrer_breakdown ?? [])
  const deviceData = computeDeviceBreakdown(data.device_breakdown ?? [])
  const scrollData = computeScrollDepthDistribution(data.scroll_depth ?? [])
  const funnelData = data.conversion_funnel
    ? computeConversionFunnel(data.conversion_funnel).map((step) => ({
        ...step,
        label: t(step.label.replace('admin.', ''), { defaultValue: step.label }),
      }))
    : []
  const utmData = computeUtmSourceBreakdown(data.utm_source_breakdown ?? [])

  // Page views data (loaded independently)
  const pv = pageViewsAnalytics
  const bounceMetrics = pv?.bounce_rate ? computeBounceRate(pv.bounce_rate) : null
  const topPages = pv?.top_pages ? computeTopPagesTable(pv.top_pages) : []

  // Computed KPIs
  const publishRate = data.total_contents > 0 ? computeConversionRate(data.published_contents, data.total_contents) : 0
  const viewsPerContent = data.published_contents > 0 ? Math.round(data.total_views / data.published_contents) : 0
  const avgViewersPerContent = data.published_contents > 0 ? Math.round(data.unique_viewers / data.published_contents) : 0

  return (
    <div className="space-y-6">
      {/* Content stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminStatCard icon="📄" label={t('contents.totalContents')} value={data.total_contents} color="blue" subtitle={`${publishRate}% ${t('contents.published').toLowerCase()}`} />
        <AdminStatCard icon="✅" label={t('contents.published')} value={data.published_contents} color="green" />
        <AdminStatCard icon="📝" label={t('contents.drafts')} value={data.draft_contents} color="gray" />
        <AdminStatCard icon="⏱" label={t('contents.avgReadingTime')} value={t('contents.minuteShort', { value: data.avg_reading_time_minutes })} color="purple" />
      </div>

      {/* View stats + bounce rate */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminStatCard icon="👁" label={t('contents.totalViews')} value={data.total_views} color="blue" subtitle={t('contents.viewsPerContent', { value: viewsPerContent })} />
        <AdminStatCard icon="👤" label={t('contents.uniqueViewers')} value={data.unique_viewers} color="green" subtitle={t('contents.viewersPerContent', { value: avgViewersPerContent })} />
        <AdminStatCard icon="⏳" label={t('contents.avgViewDuration')} value={formatViewDuration(data.avg_view_duration_ms)} color="orange" />
        {bounceMetrics && (
          <AdminStatCard icon="↩" label={t('contents.bounceRate')} value={`${bounceMetrics.bounceRate}%`} color={bounceMetrics.bounceRate > 60 ? 'red' : bounceMetrics.bounceRate > 40 ? 'orange' : 'green'} subtitle={`${bounceMetrics.engaged} ${t('contents.engaged')} / ${bounceMetrics.total}`} />
        )}
      </div>

      {/* Page views stats */}
      {pv && !pageViewsLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <AdminStatCard icon="📊" label={t('contents.totalPageViews')} value={pv.total_page_views} color="blue" />
          <AdminStatCard icon="🧑" label={t('contents.uniqueVisitors')} value={pv.unique_visitors} color="green" />
          {bounceMetrics && (
            <AdminStatCard icon="✓" label={t('contents.engagedRate')} value={`${bounceMetrics.engagedRate}%`} color="green" />
          )}
        </div>
      )}

      {/* Locale breakdown */}
      {locales.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.localeBreakdown')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {locales.map((l) => (
              <AdminStatCard
                key={l.locale}
                icon="🌐"
                label={`${l.locale.toUpperCase()} (${l.percentage}%)`}
                value={`${l.published}/${l.count}`}
                color={LOCALE_COLORS[l.locale as SupportedLocale] ?? 'gray'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Period selector + Daily views chart */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-sm text-gray-600">{t('contents.viewPeriod')}:</span>
        <div className="flex gap-1">
          {VIEW_PERIOD_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={viewDays === p}
              onClick={() => setViewDays(p)}
              className={`px-3 py-1 text-xs rounded-full border transition cursor-pointer ${
                viewDays === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {p}{t('contents.dayShort')}
            </button>
          ))}
        </div>
      </div>

      <ContentViewsChart data={dailyViews} />

      {/* Daily page views chart */}
      {pv?.daily_page_views && pv.daily_page_views.length > 0 && (
        <DailyPageViewsChart data={pv.daily_page_views} days={viewDays} dateLocale={dateLocale} />
      )}

      {/* Referrer & Device breakdown side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ReferrerBreakdownChart data={referrerData} />
        <DeviceBreakdownChart data={deviceData} />
      </div>

      {/* UTM Source Attribution */}
      <UtmSourceChart data={utmData} ctaClicks={data.cta_clicks ?? 0} />

      {/* Scroll depth & Conversion funnel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ScrollDepthChart data={scrollData} />
        <ConversionFunnelChart data={funnelData} />
      </div>

      {/* Top pages table */}
      {topPages.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.topPages')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 text-xs">
                  <th className="pb-2 text-left font-medium">{t('contents.rank')}</th>
                  <th className="pb-2 text-left font-medium">{t('contents.pagePath')}</th>
                  <th className="pb-2 text-right font-medium">{t('contents.viewCount')}</th>
                  <th className="pb-2 text-right font-medium">{t('contents.uniqueViewersCol')}</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((row, i) => (
                  <tr key={row.page_path} className="border-b border-gray-100">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 text-gray-900 font-mono text-xs max-w-[200px] truncate">{row.page_path}</td>
                    <td className="py-2 text-right text-gray-900">{row.view_count.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">{row.unique_visitors.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Publishing timeline */}
      <PublishingTimelineChart data={timeline} />

      {/* Popular content table */}
      {popularRows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.popularContent')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 text-xs">
                  <th className="pb-2 text-left font-medium">{t('contents.rank')}</th>
                  <th className="pb-2 text-left font-medium">{t('contents.contentTitle')}</th>
                  <th className="pb-2 text-left font-medium">{t('contents.locale')}</th>
                  <th className="pb-2 text-right font-medium">{t('contents.viewCount')}</th>
                  <th className="pb-2 text-right font-medium">{t('contents.uniqueViewersCol')}</th>
                  <th className="pb-2 text-right font-medium">{t('contents.avgDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {popularRows.map((row, i) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 text-gray-900 font-medium max-w-[200px] truncate">{row.title}</td>
                    <td className="py-2 text-gray-500">{row.locale.toUpperCase()}</td>
                    <td className="py-2 text-right text-gray-900">{row.view_count.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">{row.unique_viewers.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">{row.avg_duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top tags */}
      <TagDistributionChart data={tags} />

      {/* Recently published */}
      {data.recent_published.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.recentPublished')}</h3>
          <div className="space-y-3">
            {data.recent_published.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {item.locale.toUpperCase()} · {t('contents.readingTime', { value: item.reading_time_minutes })}
                    {item.tags.length > 0 && ` · ${item.tags.slice(0, 3).join(', ')}`}
                  </p>
                </div>
                <span className="text-xs text-gray-400 ml-3 whitespace-nowrap">
                  {item.published_at ? formatRelativeTime(item.published_at, dateLocale) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline sub-component for daily page views chart ──

function DailyPageViewsChart({ data, days, dateLocale }: { data: { date: string; views: number; unique_visitors: number }[]; days: number; dateLocale: string }) {
  const { t } = useTranslation('admin')

  const chartData = useMemo(() => {
    const sliced = data.slice(-days)
    const tickInterval = Math.max(1, Math.floor(sliced.length / 6))
    return sliced.map((d, i) => ({
      ...d,
      label: i % tickInterval === 0 || i === sliced.length - 1
        ? formatDateKeyShort(d.date, dateLocale)
        : '',
    }))
  }, [data, days, dateLocale])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.dailyPageViews')}</h3>
      {chartData.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
            <RechartsTooltip
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                if (item?.payload?.date) return formatDateKeyShort(item.payload.date, dateLocale)
                return ''
              }}
            />
            <Legend />
            <Bar dataKey="views" name={t('contents.views')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="unique_visitors" name={t('contents.uniqueVisitors')} fill="#06b6d4" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
