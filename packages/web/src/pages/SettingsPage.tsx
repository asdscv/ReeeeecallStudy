import { useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, BookOpen, Globe, Loader2, LogOut, Zap, Bot, Palette, Target, Download, CreditCard, User } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { useTheme } from '../hooks/useTheme'
import { ThemeToggle } from '../components/common/ThemeToggle'
import { UserStatsExport } from '../components/settings/UserStatsExport'
import { ReminderSettings } from '../components/settings/ReminderSettings'
import { CollapsibleSection } from '../components/settings/CollapsibleSection'
import { WalletSummary } from '../components/settings/WalletSummary'
import { PaymentHistory } from '../components/settings/PaymentHistory'
import { PlanSelector, isUnlimitedCardLimit } from '../components/billing/PlanSelector'
import { CardUsagePanel } from '../components/billing/CardUsagePanel'
import { registerCardUsageDetailInterest, releaseCardUsageDetailInterest } from '@reeeeecall/shared/stores/deck-store'
import {
  loadSettings,
  saveSettings,
  type StudyInputSettings,
} from '../lib/study-input-settings'
import type { Profile } from '../types/database'

/** Auto-save a single profile field to DB */
async function autoSaveProfile(
  userId: string,
  field: string,
  value: unknown,
): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ [field]: value } as Record<string, unknown>)
    .eq('id', userId)
  return !error
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary px-1 pt-2 first:pt-0">{children}</h2>
}

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tWallet } = useTranslation('wallet')
  const { t: tBilling } = useTranslation('billing')
  const { changeLanguage } = useLocale()
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()
  const { theme, setTheme } = useTheme()
  const cardUsage = useDeckStore((s) => s.cardUsage)
  const fetchCardUsage = useDeckStore((s) => s.fetchCardUsage)
  const cardUsageDetail = useDeckStore((s) => s.cardUsageDetail)
  const fetchCardUsageDetail = useDeckStore((s) => s.fetchCardUsageDetail)

  useEffect(() => {
    registerCardUsageDetailInterest()
    void fetchCardUsage()
    void fetchCardUsageDetail()
    return () => releaseCardUsageDetailInterest()
  }, [fetchCardUsage, fetchCardUsageDetail])

  const [loading, setLoading] = useState(true)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [savedDisplayName, setSavedDisplayName] = useState('')
  const [dailyNewLimit, setDailyNewLimit] = useState(20)
  const [savedDailyNewLimit, setSavedDailyNewLimit] = useState(20)
  const [dailyGoal, setDailyGoal] = useState<number | null>(null)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [ttsSpeed, setTtsSpeed] = useState(0.9)
  const [ttsProvider, setTtsProvider] = useState<'web_speech' | 'edge_tts'>('web_speech')

  // Display name validation
  const [nameChecking, setNameChecking] = useState(false)
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // SRS save state
  const [srsSaving, setSrsSaving] = useState(false)


  // Study input settings (localStorage)
  const [inputSettings, setInputSettingsRaw] = useState<StudyInputSettings>(() => loadSettings())

  // Auto-save helper
  const autoSave = useCallback(async (field: string, value: unknown) => {
    if (!user) return
    const ok = await autoSaveProfile(user.id, field, value)
    if (ok) {
      toast.success(t('autoSaved'))
    }
  }, [user, t])

  // Answer mode: auto-save
  const updateAnswerMode = useCallback(async (mode: 'button' | 'swipe') => {
    const next: StudyInputSettings = { version: 3, mode }
    setInputSettingsRaw(next)
    saveSettings(next)
    await autoSave('answer_mode', mode)
  }, [autoSave])

  // TTS: auto-save on change
  const updateTtsEnabled = useCallback(async (enabled: boolean) => {
    setTtsEnabled(enabled)
    await autoSave('tts_enabled', enabled)
  }, [autoSave])

  const updateTtsProvider = useCallback(async (provider: 'web_speech' | 'edge_tts') => {
    setTtsProvider(provider)
    await autoSave('tts_provider', provider)
  }, [autoSave])

  const ttsSpeedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateTtsSpeed = useCallback((speed: number) => {
    setTtsSpeed(speed)
    if (ttsSpeedTimer.current) clearTimeout(ttsSpeedTimer.current)
    ttsSpeedTimer.current = setTimeout(() => {
      autoSave('tts_speed', speed)
    }, 500)
  }, [autoSave])

  // Display name: debounced duplicate check
  const checkNameAvailability = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === savedDisplayName) {
      setNameAvailable(null)
      setNameError(null)
      setNameChecking(false)
      return
    }
    if (trimmed.length < 2 || trimmed.length > 12) {
      setNameAvailable(false)
      setNameError(t('profile.nameLength'))
      setNameChecking(false)
      return
    }
    setNameChecking(true)
    const { data } = await supabase.rpc('check_nickname_available', { p_nickname: trimmed })
    const result = data as { available: boolean; error?: string } | null
    if (result?.error === 'invalid_length') {
      setNameAvailable(false)
      setNameError(t('profile.nameLength'))
    } else if (result?.available === false) {
      setNameAvailable(false)
      setNameError(t('profile.nameTaken'))
    } else {
      setNameAvailable(true)
      setNameError(null)
    }
    setNameChecking(false)
  }, [savedDisplayName, t])

  const handleNameChange = (value: string) => {
    setDisplayName(value)
    setNameAvailable(null)
    setNameError(null)
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current)
    const trimmed = value.trim()
    if (!trimmed || trimmed === savedDisplayName) return
    nameCheckTimer.current = setTimeout(() => {
      checkNameAvailability(value)
    }, 500)
  }

  const handleSaveName = async () => {
    if (!user) return
    const trimmed = displayName.trim()
    if (trimmed === savedDisplayName) return
    if (trimmed && (trimmed.length < 2 || trimmed.length > 12)) {
      toast.error(t('profile.nameLength'))
      return
    }
    setNameSaving(true)
    const ok = await autoSaveProfile(user.id, 'display_name', trimmed || null)
    if (ok) {
      setSavedDisplayName(trimmed)
      setNameAvailable(null)
      setNameError(null)
      toast.success(t('profile.nameSaved'))
    } else {
      toast.error(t('profile.nameTaken'))
    }
    setNameSaving(false)
  }

  // SRS: save button
  const handleSaveSrs = async () => {
    if (!user) return
    setSrsSaving(true)
    const ok = await autoSaveProfile(user.id, 'daily_new_limit', dailyNewLimit)
    if (ok) {
      setSavedDailyNewLimit(dailyNewLimit)
      toast.success(t('autoSaved'))
    }
    setSrsSaving(false)
  }

  // Fetch profile on mount
  useEffect(() => {
    if (!user) return

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      const p = data as Profile | null
      if (p) {
        setDisplayName(p.display_name ?? '')
        setSavedDisplayName(p.display_name ?? '')
        setDailyNewLimit(p.daily_new_limit)
        setSavedDailyNewLimit(p.daily_new_limit)
        setDailyGoal((p as Record<string, unknown>).daily_study_goal as number | null)
        setTtsEnabled(p.tts_enabled)
        setTtsSpeed(p.tts_speed ?? 0.9)
        setTtsProvider(p.tts_provider ?? 'web_speech')
        if (p.answer_mode) {
          const synced: StudyInputSettings = { version: 3, mode: p.answer_mode }
          setInputSettingsRaw(synced)
          saveSettings(synced)
        }
      }
      setLoading(false)
    }

    fetchProfile()

  }, [user])


  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-muted-foreground">{t('loading')}</div>
      </div>
    )
  }

  const nameChanged = displayName.trim() !== savedDisplayName
  const srsChanged = dailyNewLimit !== savedDailyNewLimit
  const userInitial = (displayName || user?.email || '?')[0].toUpperCase()

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-1">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mb-6 sm:mb-8">{t('subtitle', 'Manage your account, credits, and study preferences.')}</p>

      <div className="space-y-7">

        {/* ── Quick Actions (nav strip, no label) ── */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => navigate('/quick-study')}
              className="bg-orange-50 border border-orange-200 dark:bg-orange-500/15 dark:border-orange-500/30 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-orange-100 dark:hover:bg-orange-500/25 transition cursor-pointer text-center"
            >
              <Zap className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              <span className="text-sm font-semibold text-orange-700 dark:text-orange-300">{t('quickActions.quickStudy', 'Quick Study')}</span>
            </button>
            <button
              onClick={() => navigate('/ai-generate')}
              className="bg-purple-50 border border-purple-200 dark:bg-purple-500/15 dark:border-purple-500/30 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-purple-100 dark:hover:bg-purple-500/25 transition cursor-pointer text-center"
            >
              <Bot className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">{t('quickActions.aiGenerate', 'AI Generate')}</span>
            </button>
            <button
              onClick={() => navigate('/guide')}
              className="bg-brand/10 border border-brand/30 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-brand/15 transition cursor-pointer text-center"
            >
              <BookOpen className="w-6 h-6 text-brand" />
              <span className="text-sm font-semibold text-brand">{t('quickActions.guide', 'Guide')}</span>
            </button>
          </div>
        </div>

        {/* ── Account ── */}
        <div className="space-y-3">
          <GroupLabel>{t('groups.account', 'Account')}</GroupLabel>
          <CollapsibleSection title={t('profile.title')} icon={<User className="w-5 h-5 text-muted-foreground" />}>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-brand flex items-center justify-center shrink-0">
                <span className="text-2xl font-bold text-white">{userInitial}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground mb-1">{user?.email}</p>
                <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                  false /* isPro -- add when available */
                    ? 'bg-success/10 text-success border border-success/30'
                    : 'bg-accent text-muted-foreground border border-border'
                }`}>
                  {t('plan.free')}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('profile.displayName')}</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder={t('profile.displayNamePlaceholder')}
                    maxLength={12}
                    className={`w-full px-4 py-2.5 rounded-lg border outline-none text-foreground ${
                      nameError
                        ? 'border-destructive/50 focus:border-destructive focus:ring-2 focus:ring-destructive/20'
                        : nameAvailable
                          ? 'border-success/50 focus:border-success focus:ring-2 focus:ring-success/20'
                          : 'border-border focus:border-brand focus:ring-2 focus:ring-brand/20'
                    }`}
                  />
                  {nameChecking && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary animate-spin" />
                  )}
                  {!nameChecking && nameAvailable && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-success" />
                  )}
                </div>
                <button
                  onClick={handleSaveName}
                  disabled={nameSaving || !nameChanged || nameChecking || nameAvailable === false}
                  className="px-4 py-2.5 text-sm text-white bg-brand rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer font-medium whitespace-nowrap"
                >
                  {nameSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('profile.saveBtn')}
                </button>
              </div>
              {nameError && (
                <p className="text-xs text-destructive mt-1">{nameError}</p>
              )}
              {nameAvailable && (
                <p className="text-xs text-success mt-1">{t('profile.nameAvailable')}</p>
              )}
            </div>
          </CollapsibleSection>
        </div>

        {/* ── Credits & Usage ── */}
        <div className="space-y-3">
          <GroupLabel>{t('groups.billing', 'Credits & Usage')}</GroupLabel>
          {/* ── Wallet ── */}
          <CollapsibleSection title={tWallet('title')} icon={<span className="text-base">💳</span>}>
            <WalletSummary />
          </CollapsibleSection>

          {/* ── Card storage usage (owned-card limit, mig 116) ── */}
          {cardUsage && (() => {
            // A card_limit >= 1e9 is the "unlimited" sentinel (mig 124's 2e9 plan). It
            // is a normal integer cap in the DB; here we only collapse it to a word and
            // skip the progress bar so an Unlimited plan never renders a broken/near-
            // empty meter.
            const unlimited = isUnlimitedCardLimit(cardUsage.limit)
            return (
              <CollapsibleSection
                title={t('cardUsage.title')}
                icon={<CreditCard className="w-5 h-5 text-muted-foreground" />}
                badge={
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {unlimited
                      ? t('cardUsage.countUnlimited', { owned: cardUsage.owned.toLocaleString() })
                      : t('cardUsage.count', { owned: cardUsage.owned, limit: cardUsage.limit })}
                  </span>
                }
              >
                {cardUsageDetail ? (
                  <CardUsagePanel detail={cardUsageDetail} />
                ) : (
                  <div className="h-24 animate-pulse rounded-xl bg-accent" aria-hidden />
                )}
                <div className="mt-5 border-t border-border pt-4">
                  <PlanSelector />
                </div>
              </CollapsibleSection>
            )
          })()}

          {/* ── Payment history (orders + subscriptions) ── */}
          <CollapsibleSection
            title={tBilling('paymentHistory.title')}
            icon={<span className="text-base">🧾</span>}
          >
            <PaymentHistory />
          </CollapsibleSection>
        </div>

        {/* ── Study ── */}
        <div className="space-y-3">
          <GroupLabel>{t('groups.study', 'Study')}</GroupLabel>
          {/* ── Study Settings ── */}
          <CollapsibleSection title={t('answerMode.title')} icon={<span className="text-base">📝</span>}>

          {/* Answer Mode cards */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => updateAnswerMode('button')}
              className={`p-4 rounded-xl border-2 text-left transition cursor-pointer ${
                inputSettings.mode === 'button'
                  ? 'border-brand bg-brand/10'
                  : 'border-border hover:border-border'
              }`}
            >
              <div className="text-2xl mb-2">👆</div>
              <div className="text-sm font-semibold text-foreground">{t('answerMode.button')}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('answerMode.buttonDesc')}</div>
            </button>
            <button
              type="button"
              onClick={() => updateAnswerMode('swipe')}
              className={`p-4 rounded-xl border-2 text-left transition cursor-pointer ${
                inputSettings.mode === 'swipe'
                  ? 'border-brand bg-brand/10'
                  : 'border-border hover:border-border'
              }`}
            >
              <div className="text-2xl mb-2">👋</div>
              <div className="text-sm font-semibold text-foreground">{t('answerMode.swipe')}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('answerMode.swipeDesc')}</div>
            </button>
          </div>

          {inputSettings.mode === 'swipe' && (
            <div className="p-3 bg-brand/10 rounded-lg mb-5">
              <p className="text-xs text-brand whitespace-pre-line">
                {t('answerMode.swipeAutoNote')}
              </p>
            </div>
          )}

          {/* Daily New Card Limit */}
          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-foreground mb-1">{t('srs.newCardLimit')}</h3>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={dailyNewLimit}
                onChange={(e) => {
                  const raw = e.target.value
                  setDailyNewLimit(raw === '' ? '' as any : parseInt(raw) || 0)
                }}
                onBlur={() => {
                  const n = typeof dailyNewLimit === 'number' ? dailyNewLimit : parseInt(String(dailyNewLimit)) || 1
                  setDailyNewLimit(Math.max(1, Math.min(9999, n)))
                }}
                min={1}
                max={9999}
                className="w-28 px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
              />
              <span className="text-sm text-muted-foreground">{t('srs.cards')}</span>
              <button
                onClick={handleSaveSrs}
                disabled={srsSaving || !srsChanged}
                className="px-4 py-2.5 text-sm text-white bg-brand rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer font-medium"
              >
                {srsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('profile.saveBtn')}
              </button>
            </div>
            <p className="text-xs text-content-tertiary mt-2">{t('srs.help')}</p>
          </div>

          {/* TTS */}
          <div className="pt-4 border-t border-border mt-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">{t('tts.title')}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t('tts.description')}</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => updateTtsEnabled(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-sm text-foreground">{t('tts.enable')}</span>
            </label>

            {ttsEnabled && (
              <>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground mb-2">{t('tts.provider')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => updateTtsProvider('web_speech')}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        ttsProvider === 'web_speech'
                          ? 'border-brand bg-brand/10'
                          : 'border-border hover:border-border'
                      }`}
                    >
                      <div className="text-sm font-semibold text-foreground">{t('tts.webSpeech')}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t('tts.webSpeechDesc')}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTtsProvider('edge_tts')}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        ttsProvider === 'edge_tts'
                          ? 'border-brand bg-brand/10'
                          : 'border-border hover:border-border'
                      }`}
                    >
                      <div className="text-sm font-semibold text-foreground">{t('tts.edgeTts')}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t('tts.edgeTtsDesc')}</div>
                      <div className="text-[11px] text-warning mt-1">{t('tts.edgeTtsNote')}</div>
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground mb-2">{t('tts.speed')}</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-content-tertiary w-8">0.5x</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={ttsSpeed}
                      onChange={(e) => updateTtsSpeed(parseFloat(e.target.value))}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-xs text-content-tertiary w-8">2.0x</span>
                    <span className="text-sm font-medium text-foreground w-12 text-right">{ttsSpeed.toFixed(1)}x</span>
                  </div>
                </div>
              </>
            )}
            <p className="text-xs text-content-tertiary mt-3">{t('tts.help')}</p>
          </div>
        </CollapsibleSection>

          {/* ── Daily Study Goal ── */}
          <CollapsibleSection title={t('goal.title', 'Daily Study Goal')} icon={<Target className="w-5 h-5 text-muted-foreground" />}>
            <p className="text-sm text-muted-foreground mb-3">{t('goal.description', 'Set a daily study target in minutes. Leave empty for no goal.')}</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={480}
                placeholder={t('goal.placeholder', 'e.g. 30')}
                value={dailyGoal ?? ''}
                onChange={(e) => setDailyGoal(e.target.value ? parseInt(e.target.value, 10) : null)}
                onBlur={async () => {
                  if (dailyGoal !== null && (dailyGoal < 1 || dailyGoal > 480)) return
                  if (user) {
                    const ok = await autoSaveProfile(user.id, 'daily_study_goal', dailyGoal)
                    if (ok) toast.success(t('autoSaved', 'Saved'))
                  }
                }}
                className="w-24 px-3 py-2 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm text-foreground"
              />
              <span className="text-sm text-muted-foreground">{t('goal.unit', 'minutes / day')}</span>
            </div>
          </CollapsibleSection>

          {/* ── Study Reminders ── */}
          <ReminderSettings />
        </div>

        {/* ── Preferences ── */}
        <div className="space-y-3">
          <GroupLabel>{t('groups.preferences', 'Preferences')}</GroupLabel>
          {/* ── Language ── */}
          <CollapsibleSection title={t('language.title')} icon={<Globe className="w-5 h-5 text-muted-foreground" />}>
            <select
              value={i18n.language}
              onChange={(e) => changeLanguage(e.target.value)}
              className="w-full sm:w-64 px-4 py-3 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236B7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              {(['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const).map((lng) => (
                <option key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </option>
              ))}
            </select>
          </CollapsibleSection>

          {/* ── Theme ── */}
          <CollapsibleSection title={t('theme.title')} icon={<Palette className="w-5 h-5 text-muted-foreground" />}>
            <p className="text-sm text-muted-foreground mb-3">{t('theme.description')}</p>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </CollapsibleSection>
        </div>

        {/* ── Data ── */}
        <div className="space-y-3">
          <GroupLabel>{t('groups.data', 'Data')}</GroupLabel>
          {/* ── Data Export ── */}
          <CollapsibleSection title={t('export.title', 'Export My Data')} icon={<Download className="w-5 h-5 text-muted-foreground" />}>
            <UserStatsExport />
          </CollapsibleSection>
        </div>

        {/* ── Account (bottom, clear separation, no label) ── */}
        <div className="border-t border-border pt-6">
          <button
            onClick={signOut}
            className="w-full py-3 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition cursor-pointer bg-card"
          >
            <span className="flex items-center justify-center gap-2">
              <LogOut className="w-4 h-4" />
              {t('account.logout')}
            </span>
          </button>
        </div>

        {/* ── Legal (compact inline, very bottom) ── */}
        <div className="flex items-center justify-center gap-3 py-2 text-sm text-content-tertiary">
          <a href="https://reeeeecallstudy.xyz/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition no-underline text-content-tertiary">
            {t('legal.privacy')}
          </a>
          <span>·</span>
          <a href="https://reeeeecallstudy.xyz/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition no-underline text-content-tertiary">
            {t('legal.terms')}
          </a>
        </div>
      </div>
    </div>
  )
}
