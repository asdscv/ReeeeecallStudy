import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Key, Eye, EyeOff, Trash2, Plus, BookOpen, ChevronDown, Globe, Loader2, Sparkles, Shield, Pencil, LogOut, Zap, Bot, Palette, Target, Download } from 'lucide-react'
import { toIntlLocale } from '../lib/locale-utils'
import { useLocale } from '../hooks/useLocale'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { formatLocalDateTime } from '../lib/date-utils'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import { useTheme } from '../hooks/useTheme'
import { ThemeToggle } from '../components/common/ThemeToggle'
import { UserStatsExport } from '../components/settings/UserStatsExport'
import {
  loadSettings,
  saveSettings,
  type StudyInputSettings,
} from '../lib/study-input-settings'
import type { Profile } from '../types/database'
import { maskApiKeyPartial } from '../lib/api-key'
import { aiKeyVault } from '../lib/ai/secure-storage'
import { getProviders, getProvider } from '../lib/ai/provider-registry'
import type { ProviderKeyMap } from '../lib/ai/secure-storage'

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(t('apiKey.copied'))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-gray-400 hover:text-gray-600 transition cursor-pointer"
      title={t('apiKey.copy')}
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}

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

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const dateLocale = toIntlLocale(i18n.language)
  const { changeLanguage } = useLocale()
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()
  const { theme, setTheme } = useTheme()

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

  // API key state
  const [apiKeyData, setApiKeyData] = useState<{ key: string; name: string; createdAt: string } | null>(null)
  const [keyDisplayMode, setKeyDisplayMode] = useState<'hidden' | 'partial' | 'full'>('hidden')
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeyForm, setShowKeyForm] = useState(false)

  // Study input settings (localStorage)
  const [inputSettings, setInputSettingsRaw] = useState<StudyInputSettings>(() => loadSettings())

  // AI Provider state
  const [aiKeys, setAiKeys] = useState<ProviderKeyMap>({})
  const [aiEditingId, setAiEditingId] = useState<string | null>(null)
  const [aiEditKey, setAiEditKey] = useState('')
  const [aiEditModel, setAiEditModel] = useState('')
  const [aiEditBaseUrl, setAiEditBaseUrl] = useState('')
  const [aiSaving, setAiSaving] = useState(false)
  const [aiCollapsed, setAiCollapsed] = useState(true)

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

    // Load API key from DB
    const fetchApiKey = async () => {
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('name, created_at, key_plain')
        .eq('user_id', user.id)
        .single()
      if (keyRow) {
        const row = keyRow as { name: string; created_at: string; key_plain: string | null }
        let plainKey = row.key_plain ?? ''
        if (!plainKey) {
          const saved = localStorage.getItem('reeeeecall-api-key-data')
          if (saved) {
            try { plainKey = JSON.parse(saved).key ?? '' } catch { /* ignore */ }
          }
        }
        setApiKeyData({ key: plainKey, name: row.name, createdAt: row.created_at })
      }
    }
    fetchApiKey()

    // Load AI provider keys
    const fetchAiKeys = async () => {
      try {
        const keys = await aiKeyVault.loadAll(user.id)
        setAiKeys(keys)
      } catch { /* ignore decrypt failures */ }
    }
    fetchAiKeys()
  }, [user])

  const [generating, setGenerating] = useState(false)

  const handleGenerateApiKey = async () => {
    if (!user || generating) return

    const { validateKeyName, generateApiKey: genKey, hashApiKey } = await import('../lib/api-key')
    const nameResult = validateKeyName(newKeyName)
    if (!nameResult.valid) {
      toast.error(t(nameResult.error!))
      return
    }
    const name = newKeyName.trim()

    setGenerating(true)
    try {
      const key = genKey()
      const keyHash = await hashApiKey(key)

      await supabase.from('api_keys').delete().eq('user_id', user.id)

      const { error } = await supabase
        .from('api_keys')
        .insert({
          user_id: user.id,
          key_hash: keyHash,
          key_plain: key,
          name,
        } as Record<string, unknown>)

      if (error) {
        toast.error(t('apiKey.generateError'))
        return
      }

      const data = { key, name, createdAt: new Date().toISOString() }
      setApiKeyData(data)
      localStorage.setItem('reeeeecall-api-key-data', JSON.stringify(data))
      setKeyDisplayMode('full')
      setShowKeyForm(false)
      setNewKeyName('')
      toast.success(t('apiKey.generated'))
    } catch (err) {
      toast.error(t('apiKey.generateError'))
      console.error('[API Key]', err)
    } finally {
      setGenerating(false)
    }
  }

  const revokeApiKey = async () => {
    if (!user) return

    await supabase
      .from('api_keys')
      .delete()
      .eq('user_id', user.id)

    setApiKeyData(null)
    setKeyDisplayMode('hidden')
    localStorage.removeItem('reeeeecall-api-key-data')
    toast.success(t('apiKey.deleted'))
  }

  // AI Provider handlers
  const aiProviders = getProviders()

  const CUSTOM_PROVIDER = {
    id: 'custom',
    name: t('aiProvider.custom'),
    baseUrl: '',
    models: [{ id: 'custom', name: 'Custom Model' }],
  }

  const allAiProviders = [...aiProviders, CUSTOM_PROVIDER]

  const handleAiEdit = (providerId: string) => {
    const existing = aiKeys[providerId]
    const provider = getProvider(providerId) ?? CUSTOM_PROVIDER
    setAiEditingId(providerId)
    setAiEditKey(existing?.apiKey ?? '')
    setAiEditModel(existing?.model ?? provider.models[0]?.id ?? '')
    setAiEditBaseUrl(existing?.baseUrl ?? '')
  }

  const handleAiCancel = () => {
    setAiEditingId(null)
    setAiEditKey('')
    setAiEditModel('')
    setAiEditBaseUrl('')
  }

  const handleAiSave = async () => {
    if (!user || !aiEditingId || !aiEditKey.trim()) return
    setAiSaving(true)
    try {
      await aiKeyVault.saveProvider(user.id, aiEditingId, {
        apiKey: aiEditKey.trim(),
        model: aiEditModel,
        baseUrl: aiEditingId === 'custom' ? aiEditBaseUrl.trim() : undefined,
        savedAt: new Date().toISOString(),
      })
      const keys = await aiKeyVault.loadAll(user.id)
      setAiKeys(keys)
      setAiEditingId(null)
      setAiEditKey('')
      setAiEditModel('')
      setAiEditBaseUrl('')
      toast.success(t('aiProvider.saved'))
    } catch {
      toast.error('Failed to save')
    } finally {
      setAiSaving(false)
    }
  }

  const handleAiDelete = async (providerId: string) => {
    if (!user) return
    await aiKeyVault.removeProvider(user.id, providerId)
    const keys = await aiKeyVault.loadAll(user.id)
    setAiKeys(keys)
    toast.success(t('aiProvider.deleted'))
  }

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'openai': return 'text-green-600 bg-green-50'
      case 'google': return 'text-blue-600 bg-blue-50'
      case 'anthropic': return 'text-orange-700 bg-orange-50'
      case 'xai': return 'text-gray-900 bg-gray-100'
      case 'custom': return 'text-purple-600 bg-purple-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  const nameChanged = displayName.trim() !== savedDisplayName
  const srsChanged = dailyNewLimit !== savedDailyNewLimit
  const userInitial = (displayName || user?.email || '?')[0].toUpperCase()

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">{t('title')}</h1>

      <div className="space-y-4 sm:space-y-6">

        {/* ── a) Profile Section ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-2xl font-bold text-white">{userInitial}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 mb-1">{user?.email}</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                false /* isPro -- add when available */
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-gray-100 text-gray-600 border border-gray-200'
              }`}>
                Free
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.displayName')}</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={t('profile.displayNamePlaceholder')}
                  maxLength={12}
                  className={`w-full px-4 py-2.5 rounded-lg border outline-none text-gray-900 ${
                    nameError
                      ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                      : nameAvailable
                        ? 'border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20'
                        : 'border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  }`}
                />
                {nameChecking && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                )}
                {!nameChecking && nameAvailable && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                )}
              </div>
              <button
                onClick={handleSaveName}
                disabled={nameSaving || !nameChanged || nameChecking || nameAvailable === false}
                className="px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer font-medium whitespace-nowrap"
              >
                {nameSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('profile.saveBtn')}
              </button>
            </div>
            {nameError && (
              <p className="text-xs text-red-500 mt-1">{nameError}</p>
            )}
            {nameAvailable && (
              <p className="text-xs text-green-500 mt-1">{t('profile.nameAvailable')}</p>
            )}
          </div>
        </section>

        {/* ── b) Quick Actions ── */}
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/quick-study')}
            className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-orange-100 transition cursor-pointer text-center"
          >
            <Zap className="w-6 h-6 text-orange-600" />
            <span className="text-sm font-semibold text-orange-700">{t('quickActions.quickStudy', 'Quick Study')}</span>
          </button>
          <button
            onClick={() => navigate('/ai-generate')}
            className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-purple-100 transition cursor-pointer text-center"
          >
            <Bot className="w-6 h-6 text-purple-600" />
            <span className="text-sm font-semibold text-purple-700">{t('quickActions.aiGenerate', 'AI Generate')}</span>
          </button>
          <button
            onClick={() => navigate('/guide')}
            className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-blue-100 transition cursor-pointer text-center"
          >
            <BookOpen className="w-6 h-6 text-blue-600" />
            <span className="text-sm font-semibold text-blue-700">{t('quickActions.guide', 'Guide')}</span>
          </button>
        </div>

        {/* ── c) Study Settings ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('answerMode.title')}</h2>

          {/* Answer Mode cards */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => updateAnswerMode('button')}
              className={`p-4 rounded-xl border-2 text-left transition cursor-pointer ${
                inputSettings.mode === 'button'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-2">👆</div>
              <div className="text-sm font-semibold text-gray-900">{t('answerMode.button')}</div>
              <div className="text-xs text-gray-500 mt-1">{t('answerMode.buttonDesc')}</div>
            </button>
            <button
              type="button"
              onClick={() => updateAnswerMode('swipe')}
              className={`p-4 rounded-xl border-2 text-left transition cursor-pointer ${
                inputSettings.mode === 'swipe'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-2">👋</div>
              <div className="text-sm font-semibold text-gray-900">{t('answerMode.swipe')}</div>
              <div className="text-xs text-gray-500 mt-1">{t('answerMode.swipeDesc')}</div>
            </button>
          </div>

          {inputSettings.mode === 'swipe' && (
            <div className="p-3 bg-blue-50 rounded-lg mb-5">
              <p className="text-xs text-blue-800 whitespace-pre-line">
                {t('answerMode.swipeAutoNote')}
              </p>
            </div>
          )}

          {/* Daily New Card Limit */}
          <div className="pt-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">{t('srs.newCardLimit')}</h3>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={dailyNewLimit}
                onChange={(e) => setDailyNewLimit(Math.max(1, Math.min(9999, parseInt(e.target.value) || 1)))}
                min={1}
                max={9999}
                className="w-28 px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
              />
              <span className="text-sm text-gray-500">{t('srs.cards')}</span>
              <button
                onClick={handleSaveSrs}
                disabled={srsSaving || !srsChanged}
                className="px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer font-medium"
              >
                {srsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('profile.saveBtn')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">{t('srs.help')}</p>
          </div>

          {/* TTS */}
          <div className="pt-4 border-t border-gray-100 mt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">{t('tts.title')}</h3>
            <p className="text-xs text-gray-500 mb-3">{t('tts.description')}</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => updateTtsEnabled(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-sm text-gray-700">{t('tts.enable')}</span>
            </label>

            {ttsEnabled && (
              <>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('tts.provider')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => updateTtsProvider('web_speech')}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        ttsProvider === 'web_speech'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900">{t('tts.webSpeech')}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('tts.webSpeechDesc')}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTtsProvider('edge_tts')}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        ttsProvider === 'edge_tts'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900">{t('tts.edgeTts')}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('tts.edgeTtsDesc')}</div>
                      <div className="text-[11px] text-amber-500 mt-1">{t('tts.edgeTtsNote')}</div>
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('tts.speed')}</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-8">0.5x</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={ttsSpeed}
                      onChange={(e) => updateTtsSpeed(parseFloat(e.target.value))}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-xs text-gray-400 w-8">2.0x</span>
                    <span className="text-sm font-medium text-gray-700 w-12 text-right">{ttsSpeed.toFixed(1)}x</span>
                  </div>
                </div>
              </>
            )}
            <p className="text-xs text-gray-400 mt-3">{t('tts.help')}</p>
          </div>
        </section>

        {/* ── e) AI Providers (collapsible) ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <button
            onClick={() => setAiCollapsed(!aiCollapsed)}
            className="w-full flex items-center justify-between cursor-pointer bg-transparent border-none p-0"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-500" />
              <h2 className="text-lg font-semibold text-gray-900">{t('aiProvider.title')}</h2>
            </div>
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${aiCollapsed ? '' : 'rotate-180'}`} />
          </button>

          {!aiCollapsed && (
            <>
              <p className="text-sm text-gray-500 mt-2 mb-5">{t('aiProvider.description')}</p>

              <div className="space-y-3">
                {allAiProviders.map((provider) => {
                  const isConfigured = !!aiKeys[provider.id]
                  const isEditing = aiEditingId === provider.id
                  const iconClasses = getProviderIcon(provider.id)
                  const models = provider.id === 'custom'
                    ? [{ id: 'custom', name: 'Custom Model' }]
                    : (getProvider(provider.id)?.models ?? provider.models)

                  return (
                    <div key={provider.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${iconClasses}`}>
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900">
                            {provider.id === 'custom' ? t('aiProvider.custom') : provider.name}
                          </div>
                          {provider.id === 'custom' && (
                            <div className="text-xs text-gray-400">{t('aiProvider.customDesc')}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isConfigured ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700">
                              {t('aiProvider.configured')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                              {t('aiProvider.notSet')}
                            </span>
                          )}
                          {!isEditing && (
                            <button
                              onClick={() => handleAiEdit(provider.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              {t('aiProvider.edit')}
                            </button>
                          )}
                          {!isEditing && isConfigured && (
                            <button
                              onClick={() => handleAiDelete(provider.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {t('aiProvider.delete')}
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('aiProvider.apiKey')}</label>
                            <input
                              type="password"
                              value={aiEditKey}
                              onChange={(e) => setAiEditKey(e.target.value)}
                              placeholder={t('aiProvider.apiKeyPlaceholder')}
                              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-sm font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('aiProvider.model')}</label>
                            <select
                              value={aiEditModel}
                              onChange={(e) => setAiEditModel(e.target.value)}
                              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-sm bg-white"
                            >
                              {models.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </div>
                          {provider.id === 'custom' && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">{t('aiProvider.baseUrl')}</label>
                              <input
                                type="url"
                                value={aiEditBaseUrl}
                                onChange={(e) => setAiEditBaseUrl(e.target.value)}
                                placeholder="https://api.example.com/v1"
                                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-sm font-mono"
                              />
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={handleAiSave}
                              disabled={aiSaving || !aiEditKey.trim()}
                              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer font-medium"
                            >
                              {aiSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('aiProvider.save')}
                            </button>
                            <button
                              onClick={handleAiCancel}
                              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition cursor-pointer"
                            >
                              {t('aiProvider.cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-start gap-2 mt-4 p-3 bg-gray-50 rounded-lg">
                <Shield className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <p className="text-xs text-gray-500">{t('aiProvider.securityNote')}</p>
              </div>
            </>
          )}
        </section>

        {/* ── f) Language ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">{t('language.title')}</h2>
          </div>
          <select
            value={i18n.language}
            onChange={(e) => changeLanguage(e.target.value)}
            className="w-full sm:w-64 px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236B7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
          >
            {(['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id'] as const).map((lng) => (
              <option key={lng} value={lng}>
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </section>

        {/* ── f2) Theme ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">{t('theme.title')}</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">{t('theme.description')}</p>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </section>

        {/* ── API Key Management ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">{t('apiKey.title')}</h2>
            {!apiKeyData && !showKeyForm && (
              <button
                onClick={() => setShowKeyForm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition cursor-pointer font-medium"
              >
                <Plus size={16} />
                {t('apiKey.generate')}
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-5">{t('apiKey.limit')}</p>

          {showKeyForm && !apiKeyData && (
            <div className="border border-gray-200 rounded-xl p-4 sm:p-5 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('apiKey.keyName')}</label>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder={t('apiKey.keyNamePlaceholder')}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateApiKey() }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateApiKey}
                    disabled={generating}
                    className="flex-1 sm:flex-none px-4 py-2.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition cursor-pointer font-medium"
                  >
                    {generating ? t('apiKey.generating') : t('apiKey.create')}
                  </button>
                  <button
                    onClick={() => { setShowKeyForm(false); setNewKeyName('') }}
                    className="flex-1 sm:flex-none px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition cursor-pointer"
                  >
                    {t('apiKey.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {apiKeyData && (
            <div className="border border-gray-200 rounded-xl p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Key size={18} className="text-gray-500" />
                  <span className="text-base font-semibold text-gray-900">{apiKeyData.name}</span>
                </div>
                <button
                  onClick={revokeApiKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer"
                  title={t('apiKey.delete')}
                >
                  <Trash2 size={14} />
                  {t('apiKey.delete')}
                </button>
              </div>

              {apiKeyData.key ? (
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 font-mono truncate">
                    {keyDisplayMode === 'full'
                      ? apiKeyData.key
                      : keyDisplayMode === 'partial'
                        ? maskApiKeyPartial(apiKeyData.key)
                        : 'rc_' + '\u2022'.repeat(32)}
                  </code>
                  <button
                    onClick={() => setKeyDisplayMode((prev) =>
                      prev === 'hidden' ? 'partial' : prev === 'partial' ? 'full' : 'hidden'
                    )}
                    className={`p-2 transition cursor-pointer ${
                      keyDisplayMode === 'full' ? 'text-blue-500 hover:text-blue-700' : 'text-gray-400 hover:text-gray-600'
                    }`}
                    title={
                      keyDisplayMode === 'hidden' ? t('apiKey.showPartial')
                        : keyDisplayMode === 'partial' ? t('apiKey.showFull')
                          : t('apiKey.hide')
                    }
                  >
                    {keyDisplayMode === 'hidden' ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <CopyButton text={apiKeyData.key} />
                </div>
              ) : (
                <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400 font-mono mb-3">
                  rc_{'\u2022'.repeat(32)}
                  <span className="ml-2 text-xs text-gray-400 font-sans">({t('apiKey.masked')})</span>
                </div>
              )}

              <div className="space-y-0.5">
                <p className="text-sm text-gray-400">
                  {t('apiKey.createdAt')}: {formatLocalDateTime(apiKeyData.createdAt, dateLocale)}
                </p>
              </div>
            </div>
          )}

          {!apiKeyData && !showKeyForm && (
            <div className="text-center py-6 text-sm text-gray-400">
              {t('apiKey.noKeys')}
            </div>
          )}
        </section>

        {/* ── i) Legal (compact inline) ── */}
        <div className="flex items-center justify-center gap-3 py-2 text-sm text-gray-400">
          <a href="https://reeeeecall.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition no-underline text-gray-400">
            Privacy Policy
          </a>
          <span>·</span>
          <a href="https://reeeeecall.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition no-underline text-gray-400">
            Terms of Service
          </a>
        </div>

        {/* ── Daily Study Goal ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">{t('goal.title', 'Daily Study Goal')}</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">{t('goal.description', 'Set a daily study target in minutes. Leave empty for no goal.')}</p>
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
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-gray-900"
            />
            <span className="text-sm text-gray-500">{t('goal.unit', 'minutes / day')}</span>
          </div>
        </section>

        {/* ── Data Export ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Download className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">{t('export.title', 'Export My Data')}</h2>
          </div>
          <UserStatsExport />
        </section>

        {/* ── j) Account (bottom, clear separation) ── */}
        <div className="border-t border-gray-200 pt-6">
          <button
            onClick={signOut}
            className="w-full py-3 text-sm font-medium text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50 transition cursor-pointer bg-white"
          >
            <span className="flex items-center justify-center gap-2">
              <LogOut className="w-4 h-4" />
              {t('account.logout')}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
