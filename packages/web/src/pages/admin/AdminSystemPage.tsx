import { useEffect, useMemo, useState } from 'react'
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
      {/* Kill switches / runtime ops controls (mig 153) */}
      <SystemControls />

      {/* Config-ized growth levers (mig 154 setters + mig 177 read path) */}
      <GrowthLeversPanel />

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

// Runtime kill switches (mig 153). Toggles take effect immediately (edge fns read the
// flag per request). Green = healthy (AI/payments ON, maintenance OFF); red = the switch
// is in its incident/off position.
type FlagKey = 'ai_generation_enabled' | 'payments_enabled' | 'maintenance_mode' | 'sandbox_grants_enabled'

function SystemControls() {
  const { t } = useTranslation('admin')
  const flags = useAdminStore((s) => s.systemFlags)
  const fetchSystemFlags = useAdminStore((s) => s.fetchSystemFlags)
  const setSystemFlags = useAdminStore((s) => s.setSystemFlags)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [msgSaved, setMsgSaved] = useState(false)

  useEffect(() => { fetchSystemFlags() }, [fetchSystemFlags])
  // Sync local msg state with store flags — render-time adjustment (pattern #2)
  // avoids synchronous setState inside an effect.
  const [prevFlags, setPrevFlags] = useState(flags)
  if (flags !== prevFlags) {
    setPrevFlags(flags)
    if (flags) setMsg(flags.maintenance_message ?? '')
  }

  if (!flags) return null

  const toggle = async (key: FlagKey, next: boolean) => {
    setBusy(key)
    await setSystemFlags({ [key]: next })
    setBusy(null)
  }
  const saveMsg = async () => {
    setBusy('msg'); setMsgSaved(false)
    const { error } = await setSystemFlags({ maintenance_message: msg })
    setBusy(null)
    if (!error) { setMsgSaved(true); setTimeout(() => setMsgSaved(false), 2000) }
  }

  const rows: { key: FlagKey; label: string; hint: string; goodWhenOn: boolean }[] = [
    { key: 'ai_generation_enabled', label: t('system.controls.aiEnabled'), hint: t('system.controls.aiHint'), goodWhenOn: true },
    { key: 'payments_enabled', label: t('system.controls.paymentsEnabled'), hint: t('system.controls.paymentsHint'), goodWhenOn: true },
    { key: 'maintenance_mode', label: t('system.controls.maintenance'), hint: t('system.controls.maintenanceHint'), goodWhenOn: false },
    // goodWhenOn:false — ON means free sandbox purchases can mint real credits, which
    // is a deliberate, temporary test posture, not the healthy resting state.
    { key: 'sandbox_grants_enabled', label: t('system.controls.sandboxGrants'), hint: t('system.controls.sandboxGrantsHint'), goodWhenOn: false },
  ]

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="text-sm font-medium text-foreground mb-1">{t('system.controls.title')}</h3>
      <p className="text-xs text-muted-foreground mb-3">{t('system.controls.desc')}</p>
      <div className="space-y-2">
        {rows.map((r) => {
          const on = flags[r.key]
          const healthy = r.goodWhenOn ? on : !on
          return (
            <div key={r.key} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.hint}</div>
              </div>
              <button
                type="button"
                disabled={busy === r.key}
                onClick={() => toggle(r.key, !on)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold min-w-[76px] cursor-pointer disabled:opacity-50 ${healthy ? 'bg-green-500/15 text-green-600' : 'bg-destructive/15 text-destructive'}`}
              >
                {busy === r.key ? '…' : on ? t('system.controls.on') : t('system.controls.off')}
              </button>
            </div>
          )
        })}
      </div>
      <div className="mt-3">
        <label className="block text-xs text-muted-foreground mb-1">{t('system.controls.message')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={t('system.controls.messagePlaceholder')}
            className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy === 'msg'}
            onClick={saveMsg}
            className="px-4 py-2 rounded-lg bg-brand text-white text-sm cursor-pointer disabled:opacity-50"
          >
            {msgSaved ? t('system.controls.saved') : t('system.controls.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pack B growth levers (mig 154 setters, mig 177 getter) ──────────────────
// These change LIVE behaviour and one of them (target margin) is a divisor in the
// charging path, so the panel is built to make a wrong value hard:
//   * current values are READ first (mig 177) — a blind form on money knobs
//     invites overwriting a number you cannot see;
//   * each field saves independently, so a stale value in one input cannot ride
//     along with an intentional edit to another;
//   * the bounds the RPCs enforce are mirrored here as `min`/`max` + a pre-flight
//     check, so the common mistake gets a readable message instead of a 22023.
// The RPCs remain authoritative — this is a nicer door, not a new lock.

/** target_margin_bps is a live divisor: markup = 10000 / (10000 - bps). 100% divides by zero. */
const MAX_MARGIN_BPS = 9999
/** admin_set_ai_free_quota's own range. */
const MAX_FREE_CARDS_PER_DAY = 100000

function LeverRow({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-muted">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  )
}

function GrowthLeversPanel() {
  const { t, i18n } = useTranslation('admin')
  const levers = useAdminStore((s) => s.growthLevers)
  const leversError = useAdminStore((s) => s.growthLeversError)
  const fetchGrowthLevers = useAdminStore((s) => s.fetchGrowthLevers)
  const setAiFreeQuota = useAdminStore((s) => s.setAiFreeQuota)
  const setCardLimit = useAdminStore((s) => s.setCardLimit)
  const setAiPricing = useAdminStore((s) => s.setAiPricing)

  const [quota, setQuota] = useState('')
  const [maxCards, setMaxCards] = useState('')
  const [wonPerCredit, setWonPerCredit] = useState('')
  const [marginBps, setMarginBps] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => { fetchGrowthLevers() }, [fetchGrowthLevers])

  // Seed the inputs from the server values once they arrive (and after any save,
  // since each save re-reads). Render-time adjustment rather than an effect, the
  // same pattern SystemControls uses for the maintenance message.
  const [prevLevers, setPrevLevers] = useState(levers)
  if (levers !== prevLevers) {
    setPrevLevers(levers)
    if (levers) {
      setQuota(String(levers.free_cards_per_day))
      setMaxCards(String(levers.max_owned_cards))
      setWonPerCredit(String(levers.won_per_credit))
      setMarginBps(String(levers.target_margin_bps))
    }
  }

  if (leversError && !levers) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground mb-1">{t('system.levers.title')}</h3>
        <p className="text-xs text-destructive">{leversError}</p>
      </div>
    )
  }
  if (!levers) return null

  const flash = (key: string) => { setSaved(key); setTimeout(() => setSaved((k) => (k === key ? null : k)), 2000) }

  // Parse + bounds-check before calling, so a typo reads as a sentence rather
  // than a Postgres errcode. The RPC re-checks regardless.
  const submit = async (
    key: string,
    parse: () => { ok: true; run: () => Promise<{ error: string | null }> } | { ok: false; msg: string },
  ) => {
    const parsed = parse()
    if (!parsed.ok) { setErr(parsed.msg); return }
    setErr(''); setBusy(key)
    const { error } = await parsed.run()
    setBusy(null)
    if (error) setErr(error)
    else flash(key)
  }

  const intOrNull = (raw: string) => {
    const n = Number(raw)
    return Number.isInteger(n) ? n : null
  }

  const saveBtn = (key: string, onClick: () => void) => (
    <button
      type="button"
      disabled={busy === key}
      onClick={onClick}
      className="px-4 py-2 rounded-lg bg-brand text-white text-sm cursor-pointer disabled:opacity-50 min-w-[72px]"
    >
      {busy === key ? '…' : saved === key ? t('system.controls.saved') : t('system.controls.save')}
    </button>
  )

  const numInput = (value: string, onChange: (v: string) => void, max: number) => (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 px-3 py-2 rounded-lg border border-border text-sm bg-background outline-none focus:border-brand tabular-nums"
    />
  )

  const marginPct = (bps: number) => `${(bps / 100).toFixed(2)}%`
  const updatedAt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(i18n.language) : '-'

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="text-sm font-medium text-foreground mb-1">{t('system.levers.title')}</h3>
      <p className="text-xs text-muted-foreground mb-3">{t('system.levers.desc')}</p>

      {err && <p className="text-xs text-destructive mb-2" role="alert">{err}</p>}

      <div className="space-y-2">
        <LeverRow label={t('system.levers.freeQuota')} hint={t('system.levers.freeQuotaHint')}>
          {numInput(quota, setQuota, MAX_FREE_CARDS_PER_DAY)}
          {saveBtn('quota', () => submit('quota', () => {
            const n = intOrNull(quota)
            if (n === null || n < 0 || n > MAX_FREE_CARDS_PER_DAY) {
              return { ok: false, msg: t('system.levers.errRange', { min: 0, max: MAX_FREE_CARDS_PER_DAY }) }
            }
            return { ok: true, run: () => setAiFreeQuota(n) }
          }))}
        </LeverRow>

        <LeverRow label={t('system.levers.cardCap')} hint={t('system.levers.cardCapHint')}>
          {numInput(maxCards, setMaxCards, 1_000_000_000)}
          {saveBtn('cards', () => submit('cards', () => {
            const n = intOrNull(maxCards)
            if (n === null || n < 0) return { ok: false, msg: t('system.levers.errNonNegative') }
            // null for the flag → the RPC COALESCEs, leaving it untouched.
            return { ok: true, run: () => setCardLimit(n, null) }
          }))}
        </LeverRow>

        <LeverRow
          label={t('system.levers.countOfficial')}
          hint={t('system.levers.countOfficialHint')}
        >
          <button
            type="button"
            disabled={busy === 'official'}
            onClick={() => submit('official', () => ({
              ok: true, run: () => setCardLimit(null, !levers.count_official_cards),
            }))}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold min-w-[76px] cursor-pointer disabled:opacity-50 ${
              levers.count_official_cards ? 'bg-warning/15 text-warning' : 'bg-green-500/15 text-green-600'
            }`}
          >
            {busy === 'official' ? '…' : levers.count_official_cards ? t('system.controls.on') : t('system.controls.off')}
          </button>
        </LeverRow>

        <LeverRow label={t('system.levers.wonPerCredit')} hint={t('system.levers.wonPerCreditHint')}>
          {numInput(wonPerCredit, setWonPerCredit, 1_000_000)}
          {saveBtn('won', () => submit('won', () => {
            const n = intOrNull(wonPerCredit)
            if (n === null || n <= 0 || n > 1_000_000) {
              return { ok: false, msg: t('system.levers.errRange', { min: 1, max: 1000000 }) }
            }
            return { ok: true, run: () => setAiPricing({ wonPerCredit: n }) }
          }))}
        </LeverRow>

        <LeverRow
          label={t('system.levers.targetMargin')}
          hint={t('system.levers.targetMarginHint', { pct: marginPct(levers.target_margin_bps) })}
        >
          {numInput(marginBps, setMarginBps, MAX_MARGIN_BPS)}
          {saveBtn('margin', () => submit('margin', () => {
            const n = intOrNull(marginBps)
            if (n === null || n < 0 || n > MAX_MARGIN_BPS) {
              // Not a generic range message: 100% is refused for a specific
              // reason and an operator should be told which.
              return { ok: false, msg: t('system.levers.errMargin', { max: MAX_MARGIN_BPS }) }
            }
            return { ok: true, run: () => setAiPricing({ targetMarginBps: n }) }
          }))}
        </LeverRow>
      </div>

      <p className="text-[11px] text-content-tertiary mt-3">
        {t('system.levers.updated', {
          ai: updatedAt(levers.ai_settings_updated_at),
          cards: updatedAt(levers.card_limit_updated_at),
        })}
      </p>
    </div>
  )
}
