import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { TrafficDashboard } from '../../components/admin/TrafficDashboard'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { useAdminStore } from '../../stores/admin-store'
import { PublishingTimelineChart } from '../../components/admin/PublishingTimelineChart'
import { TagDistributionChart } from '../../components/admin/TagDistributionChart'
import { computePublishingTimeline, computeTagCloudData } from '../../lib/admin-stats'

export function AdminContentsPage() {
  const { t } = useTranslation('admin')
  const { contentsAnalytics: data, fetchContents } = useAdminStore()
  useEffect(() => { void fetchContents() }, [fetchContents])
  return <div className="space-y-8">
    <TrafficDashboard />
    {data && <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('contents.totalContents')}</summary>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <AdminStatCard label={t('contents.totalContents')} value={data.total_contents} />
        <AdminStatCard label={t('contents.published')} value={data.published_contents} color="green" />
        <AdminStatCard label={t('contents.drafts')} value={data.draft_contents} color="gray" />
        <AdminStatCard label={t('contents.avgReadingTime')} value={t('contents.minuteShort', { value: data.avg_reading_time_minutes })} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <PublishingTimelineChart data={computePublishingTimeline(data.publishing_timeline)} />
        <TagDistributionChart data={computeTagCloudData(data.top_tags)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {data.by_locale.map(locale => <AdminStatCard key={locale.locale} label={locale.locale.toUpperCase()}
          value={`${locale.published.toLocaleString()} / ${locale.count.toLocaleString()}`} />)}
      </div>
    </details>}
  </div>
}
