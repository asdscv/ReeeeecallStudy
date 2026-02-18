import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Copy, Check, Key, Eye, EyeOff, Trash2, Plus, BookOpen, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { formatLocalDateTime } from '../lib/date-utils'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import {
  loadSettings,
  saveSettings,
  type StudyInputSettings,
  type SwipeAction,
  type SwipeDirectionMap,
} from '../lib/study-input-settings'
import type { Profile } from '../types/database'

const SWIPE_DIRECTIONS: { key: keyof SwipeDirectionMap; labelKey: string; icon: typeof ArrowLeft }[] = [
  { key: 'left', labelKey: 'answerMode.swipeLeft', icon: ArrowLeft },
  { key: 'right', labelKey: 'answerMode.swipeRight', icon: ArrowRight },
  { key: 'up', labelKey: 'answerMode.swipeUp', icon: ArrowUp },
  { key: 'down', labelKey: 'answerMode.swipeDown', icon: ArrowDown },
]

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

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const dateLocale = i18n.language?.startsWith('ko') ? 'ko-KR' : 'en-US'
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [dailyNewLimit, setDailyNewLimit] = useState(20)
  const [ttsEnabled, setTtsEnabled] = useState(false)

  // API key state
  const [apiKeyData, setApiKeyData] = useState<{ key: string; name: string; createdAt: string } | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeyForm, setShowKeyForm] = useState(false)

  // Study input settings (localStorage — auto-saved on change)
  const [inputSettings, setInputSettingsRaw] = useState<StudyInputSettings>(() => loadSettings())
  const updateInputSettings = (next: StudyInputSettings) => {
    setInputSettingsRaw(next)
    saveSettings(next)
  }

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
        setDailyNewLimit(p.daily_new_limit)
        setTtsEnabled(p.tts_enabled)
      }
      setLoading(false)
    }

    fetchProfile()

    // Load API key from DB (api_keys table)
    const fetchApiKey = async () => {
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('name, created_at')
        .eq('user_id', user.id)
        .single()
      if (keyRow) {
        const row = keyRow as { name: string; created_at: string }
        // Plain key is only available at creation time; show masked placeholder
        const saved = localStorage.getItem('reeeeecall-api-key-data')
        let plainKey = ''
        if (saved) {
          try { plainKey = JSON.parse(saved).key ?? '' } catch { /* ignore */ }
        }
        setApiKeyData({ key: plainKey, name: row.name, createdAt: row.created_at })
      }
    }
    fetchApiKey()
  }, [user])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)

    await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        daily_new_limit: dailyNewLimit,
        tts_enabled: ttsEnabled,
      } as Record<string, unknown>)
      .eq('id', user.id)

    setSaving(false)
    toast.success(t('saved'))
  }

  const [generating, setGenerating] = useState(false)

  const handleGenerateApiKey = async () => {
    if (!user || generating) return

    // Validate key name
    const { validateKeyName, generateApiKey: genKey, hashApiKey } = await import('../lib/api-key')
    const nameResult = validateKeyName(newKeyName)
    if (!nameResult.valid) {
      toast.error(t(nameResult.error!))
      return
    }
    const name = newKeyName.trim()

    setGenerating(true)
    try {
      // Generate key and hash
      const key = genKey()
      const keyHash = await hashApiKey(key)

      // Upsert: delete existing key first (one_key_per_user constraint)
      await supabase.from('api_keys').delete().eq('user_id', user.id)

      // Save hash to DB
      const { error } = await supabase
        .from('api_keys')
        .insert({
          user_id: user.id,
          key_hash: keyHash,
          name,
        } as Record<string, unknown>)

      if (error) {
        toast.error(t('apiKey.generateError'))
        return
      }

      const data = { key, name, createdAt: new Date().toISOString() }
      setApiKeyData(data)
      localStorage.setItem('reeeeecall-api-key-data', JSON.stringify(data))
      setShowApiKey(true)
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
    setShowApiKey(false)
    localStorage.removeItem('reeeeecall-api-key-data')
    toast.success(t('apiKey.deleted'))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">{t('title')}</h1>

      <div className="space-y-4 sm:space-y-6">
        {/* Guide links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/guide')}
            className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex items-center gap-3 hover:bg-gray-50 transition cursor-pointer text-left"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">{t('guide.title')}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t('guide.desc')}</div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
          </button>
          <button
            onClick={() => navigate('/api-docs')}
            className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex items-center gap-3 hover:bg-gray-50 transition cursor-pointer text-left"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-50 text-purple-600 shrink-0">
              <Key className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">{t('apiDocs.title')}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t('apiDocs.desc')}</div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
          </button>
        </div>

        {/* Profile */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('profile.title')}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.email')}</label>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.displayName')}</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('profile.displayNamePlaceholder')}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
              />
            </div>
          </div>
        </section>

        {/* SRS Study Settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('srs.title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('srs.description')}</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('srs.newCardLimit')}
            </label>
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
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {t('srs.help')}
            </p>
          </div>
        </section>

        {/* Answer Input Mode */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('answerMode.title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('answerMode.description')}</p>

          {/* Mode selection cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={() => updateInputSettings({ ...inputSettings, mode: 'button' })}
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
              onClick={() => updateInputSettings({ ...inputSettings, mode: 'swipe' })}
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

          {/* Direction settings (only in swipe mode) */}
          {inputSettings.mode === 'swipe' && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                {t('answerMode.directionsHelp')}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SWIPE_DIRECTIONS.map(({ key, labelKey, icon: Icon }) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        {t(labelKey)}
                      </label>
                      <select
                        value={inputSettings.directions[key]}
                        onChange={(e) => updateInputSettings({
                          ...inputSettings,
                          directions: { ...inputSettings.directions, [key]: e.target.value as SwipeAction },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                      >
                        <option value="">{t('answerMode.notSet')}</option>
                        <option value="again">{t('answerMode.again')}</option>
                        <option value="hard">{t('answerMode.hard')}</option>
                        <option value="good">{t('answerMode.good')}</option>
                        <option value="easy">{t('answerMode.easy')}</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800">
                  {t('answerMode.recommendation')}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* TTS settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('tts.title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('tts.description')}</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-sm text-gray-700">{t('tts.enable')}</span>
          </label>
          <p className="text-xs text-gray-400 mt-3">
            {t('tts.help')}
          </p>
        </section>

        {/* API Key Management */}
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

          {/* New key form */}
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

          {/* Existing key card */}
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

              {/* Key value row */}
              {apiKeyData.key ? (
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 font-mono truncate">
                    {showApiKey ? apiKeyData.key : apiKeyData.key.slice(0, 6) + '\u2022'.repeat(30)}
                  </code>
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition cursor-pointer"
                    title={showApiKey ? t('apiKey.hide') : t('apiKey.show')}
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <CopyButton text={apiKeyData.key} />
                </div>
              ) : (
                <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400 font-mono mb-3">
                  rc_{'\u2022'.repeat(32)}
                  <span className="ml-2 text-xs text-gray-400 font-sans">({t('apiKey.masked')})</span>
                </div>
              )}

              {/* Dates */}
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

        {/* Logout */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('account.title')}</h2>
            <button
              onClick={signOut}
              className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer"
            >
              {t('account.logout')}
            </button>
          </div>
        </section>

        {/* Save button — always at the very bottom */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}
