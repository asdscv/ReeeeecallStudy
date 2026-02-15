import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Copy, Check, Key, Eye, EyeOff, Trash2, Plus, Info } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'
import type { Profile } from '../types/database'

type SwipeAction = 'again' | 'hard' | 'good' | 'easy' | ''

interface SwipeSettings {
  enabled: boolean
  left: SwipeAction
  right: SwipeAction
  up: SwipeAction
  down: SwipeAction
}

const SWIPE_DIRECTIONS: { key: keyof Omit<SwipeSettings, 'enabled'>; label: string; icon: typeof ArrowLeft }[] = [
  { key: 'left', label: '왼쪽 스와이프', icon: ArrowLeft },
  { key: 'right', label: '오른쪽 스와이프', icon: ArrowRight },
  { key: 'up', label: '위쪽 스와이프', icon: ArrowUp },
  { key: 'down', label: '아래쪽 스와이프', icon: ArrowDown },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('클립보드에 복사되었습니다')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-gray-400 hover:text-gray-600 transition cursor-pointer"
      title="복사"
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}

export function SettingsPage() {
  const { user, signOut } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [dailyNewLimit, setDailyNewLimit] = useState(20)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [ttsLang, setTtsLang] = useState('en-US')

  // API key state
  const [apiKeyData, setApiKeyData] = useState<{ key: string; name: string; createdAt: string } | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeyForm, setShowKeyForm] = useState(false)

  // Swipe settings (localStorage)
  const [swipeSettings, setSwipeSettings] = useState<SwipeSettings>({
    enabled: false,
    left: '',
    right: '',
    up: '',
    down: '',
  })

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
        setTtsLang(p.tts_lang)
      }
      setLoading(false)
    }

    fetchProfile()

    // Load swipe settings from localStorage
    const saved = localStorage.getItem('reeecall-swipe-settings')
    if (saved) {
      try {
        setSwipeSettings(JSON.parse(saved))
      } catch { /* ignore */ }
    }

    // Load API key from localStorage
    const savedKeyData = localStorage.getItem('reeecall-api-key-data')
    if (savedKeyData) {
      try { setApiKeyData(JSON.parse(savedKeyData)) } catch { /* ignore */ }
    }
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
        tts_lang: ttsLang,
      } as Record<string, unknown>)
      .eq('id', user.id)

    // Save swipe settings to localStorage
    localStorage.setItem('reeecall-swipe-settings', JSON.stringify(swipeSettings))

    setSaving(false)
    toast.success('설정이 저장되었습니다!')
  }

  const generateApiKey = () => {
    const name = newKeyName.trim()
    if (!name) {
      toast.error('키 이름을 입력해주세요')
      return
    }
    const key = `rc_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`
    const data = { key, name, createdAt: new Date().toISOString() }
    setApiKeyData(data)
    localStorage.setItem('reeecall-api-key-data', JSON.stringify(data))
    setShowApiKey(true)
    setShowKeyForm(false)
    setNewKeyName('')
    toast.success('API 키가 생성되었습니다')
  }

  const revokeApiKey = () => {
    setApiKeyData(null)
    setShowApiKey(false)
    localStorage.removeItem('reeecall-api-key-data')
    toast.success('API 키가 삭제되었습니다')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">설정</h1>

      <div className="space-y-6">
        {/* Profile */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">프로필</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">표시 이름</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="이름을 입력하세요"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                하루 새 카드 한도
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  value={dailyNewLimit}
                  onChange={(e) => setDailyNewLimit(Math.max(1, Math.min(9999, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={9999}
                  className="w-32 px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
                />
                <span className="text-sm text-gray-500">장 (최대 9,999장)</span>
              </div>
            </div>
          </div>
        </section>

        {/* Swipe settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">스와이프 기능</h2>
              <p className="text-sm text-gray-500 mt-1">카드를 스와이프하여 답변을 선택할 수 있습니다</p>
            </div>
            <button
              type="button"
              onClick={() => setSwipeSettings({ ...swipeSettings, enabled: !swipeSettings.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                swipeSettings.enabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  swipeSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {swipeSettings.enabled && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                각 방향에 동작을 할당하세요. 설정하지 않은 방향은 비활성화됩니다.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SWIPE_DIRECTIONS.map(({ key, label, icon: Icon }) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        {label}
                      </label>
                      <select
                        value={swipeSettings[key]}
                        onChange={(e) => setSwipeSettings({ ...swipeSettings, [key]: e.target.value as SwipeAction })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                      >
                        <option value="">설정 안함</option>
                        <option value="again">Again (다시)</option>
                        <option value="hard">Hard (어려움)</option>
                        <option value="good">Good (적당)</option>
                        <option value="easy">Easy (쉬움)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800">
                  추천 설정: 왼쪽=Again, 오른쪽=Good (빠른 학습에 유용)
                </p>
              </div>
            </div>
          )}
        </section>

        {/* TTS settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">TTS (텍스트 음성 변환)</h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-sm text-gray-700">TTS 활성화</span>
            </label>
            {ttsEnabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  TTS 언어
                </label>
                <select
                  value={ttsLang}
                  onChange={(e) => setTtsLang(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-gray-900 outline-none"
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="ko-KR">한국어</option>
                  <option value="ja-JP">日本語</option>
                  <option value="zh-CN">中文 (简体)</option>
                  <option value="es-ES">Español</option>
                  <option value="fr-FR">Français</option>
                  <option value="de-DE">Deutsch</option>
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
        >
          {saving ? '저장 중...' : '설정 저장'}
        </button>

        {/* API Key Management */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">API 키 관리</h2>
            {!apiKeyData && !showKeyForm && (
              <button
                onClick={() => setShowKeyForm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition cursor-pointer font-medium"
              >
                <Plus size={16} />
                새 키 생성
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-5">최대 1개의 API 키를 생성할 수 있습니다</p>

          {/* New key form */}
          {showKeyForm && !apiKeyData && (
            <div className="border border-gray-200 rounded-xl p-5 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">키 이름</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="예: my-script"
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') generateApiKey() }}
                />
                <button
                  onClick={generateApiKey}
                  className="px-4 py-2.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition cursor-pointer font-medium"
                >
                  생성
                </button>
                <button
                  onClick={() => { setShowKeyForm(false); setNewKeyName('') }}
                  className="px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition cursor-pointer"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {/* Existing key card */}
          {apiKeyData && (
            <div className="border border-gray-200 rounded-xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Key size={18} className="text-gray-500" />
                <span className="text-base font-semibold text-gray-900">{apiKeyData.name}</span>
              </div>

              {/* Key value row */}
              <div className="flex items-center gap-2 mb-3">
                <code className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 font-mono truncate">
                  {showApiKey ? apiKeyData.key : apiKeyData.key.slice(0, 6) + '\u2022'.repeat(30)}
                </code>
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition cursor-pointer"
                  title={showApiKey ? '숨기기' : '보기'}
                >
                  {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
                <CopyButton text={apiKeyData.key} />
                <button
                  onClick={revokeApiKey}
                  className="p-2 text-red-400 hover:text-red-600 transition cursor-pointer"
                  title="삭제"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {/* Dates */}
              <div className="space-y-0.5">
                <p className="text-sm text-gray-400">
                  생성일: {new Date(apiKeyData.createdAt).toLocaleString('ko-KR')}
                </p>
                <p className="text-sm text-gray-400">
                  만료일: {(() => {
                    const exp = new Date(apiKeyData.createdAt)
                    exp.setDate(exp.getDate() + 30)
                    const now = new Date()
                    const daysLeft = Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
                    return `${exp.toLocaleString('ko-KR')} (${daysLeft}일 남음)`
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Info banner */}
          {apiKeyData && (
            <div className="flex items-center gap-2 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
              <Info size={16} className="text-yellow-600 flex-shrink-0" />
              <p className="text-sm text-yellow-700">
                새 API 키를 생성하려면 기존 키를 먼저 삭제해주세요.
              </p>
            </div>
          )}

          {!apiKeyData && !showKeyForm && (
            <div className="text-center py-6 text-sm text-gray-400">
              생성된 API 키가 없습니다.
            </div>
          )}
        </section>

        {/* Logout — always at the very bottom */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">계정</h2>
            <button
              onClick={signOut}
              className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
