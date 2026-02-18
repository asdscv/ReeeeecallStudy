import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'

export function AdminSystemPage() {
  const { t } = useTranslation('admin')
  const { systemStats, systemLoading, systemError, fetchSystem } = useAdminStore()

  useEffect(() => {
    fetchSystem()
  }, [fetchSystem])

  if (systemLoading && !systemStats) {
    return <p className="text-sm text-gray-400 py-8 text-center">{t('loading')}</p>
  }

  if (systemError) {
    return <AdminErrorState error={systemError} onRetry={fetchSystem} />
  }

  const stats = systemStats

  return (
    <div className="space-y-6">
      {/* API Keys */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminStatCard icon="🔑" label={t('system.totalApiKeys')} value={stats?.total_api_keys ?? 0} color="blue" />
        <AdminStatCard icon="✅" label={t('system.activeApiKeys')} value={stats?.active_api_keys ?? 0} color="green" />
        <AdminStatCard icon="⏰" label={t('system.expiredApiKeys')} value={stats?.expired_api_keys ?? 0} color="orange" />
        <AdminStatCard icon="📡" label={t('system.recentlyUsedKeys')} value={stats?.recently_used_keys ?? 0} color="purple" />
      </div>

      {/* Content & Logs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <AdminStatCard icon="📄" label={t('system.totalContents')} value={stats?.total_contents ?? 0} color="blue" />
        <AdminStatCard icon="📢" label={t('system.publishedContents')} value={stats?.published_contents ?? 0} color="green" />
        <AdminStatCard icon="📊" label={t('system.totalStudyLogs')} value={stats?.total_study_logs ?? 0} color="gray" />
      </div>
    </div>
  )
}
