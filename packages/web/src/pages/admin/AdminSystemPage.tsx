import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { computeConversionRate } from '../../lib/admin-stats'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'

function ProgressBar({ label, value, max, color = 'blue' }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const colorMap: Record<string, string> = {
    blue: 'bg-brand',
    green: 'bg-success',
    orange: 'bg-orange-500',
    red: 'bg-destructive',
    purple: 'bg-purple-500',
  }
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">{value.toLocaleString()} / {max.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="w-full bg-accent rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${colorMap[color] ?? colorMap.blue}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HealthIndicator({ status, label }: { status: 'healthy' | 'warning' | 'critical'; label: string }) {
  const config = {
    healthy: { dot: 'bg-success', bg: 'bg-success/10', text: 'text-success' },
    warning: { dot: 'bg-warning', bg: 'bg-warning/10', text: 'text-warning' },
    critical: { dot: 'bg-destructive', bg: 'bg-destructive/10', text: 'text-destructive' },
  }
  const c = config[status]
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${c.bg}`}>
      <div className={`w-2.5 h-2.5 rounded-full ${c.dot} animate-pulse`} />
      <span className={`text-xs font-medium ${c.text}`}>{label}</span>
    </div>
  )
}

export function AdminSystemPage() {
  const { t } = useTranslation('admin')
  const { systemStats, systemLoading, systemError, fetchSystem } = useAdminStore()

  useEffect(() => {
    fetchSystem()
  }, [fetchSystem])

  const healthChecks = useMemo(() => {
    if (!systemStats) return []
    const s = systemStats
    const checks: { key: string; status: 'healthy' | 'warning' | 'critical'; label: string }[] = []

    // Content pipeline health
    const publishRate = s.total_contents > 0 ? s.published_contents / s.total_contents : 0
    checks.push({
      key: 'content',
      status: publishRate < 0.3 ? 'warning' : 'healthy',
      label: t('system.health.content'),
    })

    // Study activity health
    checks.push({
      key: 'study',
      status: s.total_study_logs > 0 ? 'healthy' : 'warning',
      label: t('system.health.study'),
    })

    return checks
  }, [systemStats, t])

  if (systemLoading && !systemStats) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-accent rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (systemError) {
    return <AdminErrorState error={systemError} onRetry={fetchSystem} />
  }

  const stats = systemStats

  const contentPublishRate = stats ? computeConversionRate(stats.published_contents, stats.total_contents) : 0
  // AI credit wallet — balances are micro-USD (mig 145); format as $.
  const aiCardsToday = (stats?.ai_cards_free_today ?? 0) + (stats?.ai_cards_paid_today ?? 0)

  return (
    <div className="space-y-6">
      {/* System Health */}
      {healthChecks.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">{t('system.healthStatus')}</h3>
          <div className="flex flex-wrap gap-3">
            {healthChecks.map((check) => (
              <HealthIndicator key={check.key} status={check.status} label={check.label} />
            ))}
          </div>
        </div>
      )}

      {/* AI Credit Wallet */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">{t('system.aiCreditWallet')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AdminStatCard icon="💰" label={t('system.totalWalletBalance')} value={formatUsdMicro(stats?.total_wallet_balance ?? 0)} color="green" />
          <AdminStatCard icon="💸" label={t('system.totalAiSpent')} value={formatUsdMicro(stats?.total_ai_spent ?? 0)} color="orange" />
          <AdminStatCard icon="👛" label={t('system.activeWallets')} value={stats?.active_wallets ?? 0} color="blue" />
          <AdminStatCard
            icon="🤖"
            label={t('system.aiCardsToday')}
            value={aiCardsToday}
            color="purple"
            subtitle={t('system.aiCardsTodayBreakdown', { free: stats?.ai_cards_free_today ?? 0, paid: stats?.ai_cards_paid_today ?? 0 })}
          />
        </div>
      </div>

      {/* Content Pipeline */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">{t('system.contentPipeline')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <AdminStatCard icon="📄" label={t('system.totalContents')} value={stats?.total_contents ?? 0} color="blue" />
          <AdminStatCard icon="📢" label={t('system.publishedContents')} value={stats?.published_contents ?? 0} color="green" subtitle={`${contentPublishRate}%`} />
          <AdminStatCard icon="📝" label={t('system.draftContents')} value={(stats?.total_contents ?? 0) - (stats?.published_contents ?? 0)} color="gray" />
        </div>
        {stats && stats.total_contents > 0 && (
          <ProgressBar label={t('system.publishedContents')} value={stats.published_contents} max={stats.total_contents} color="green" />
        )}
      </div>

      {/* Study Logs */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">{t('system.studyActivity')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AdminStatCard icon="📊" label={t('system.totalStudyLogs')} value={stats?.total_study_logs ?? 0} color="blue" size="lg" />
          <div className="bg-muted rounded-xl p-4 flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center">
              {t('system.studyLogsNote')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
