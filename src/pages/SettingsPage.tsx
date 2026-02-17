import { useEffect, useState } from 'react'
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

const SWIPE_DIRECTIONS: { key: keyof SwipeDirectionMap; label: string; icon: typeof ArrowLeft }[] = [
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
    toast.success('설정이 저장되었습니다!')
  }

  const [generating, setGenerating] = useState(false)

  const handleGenerateApiKey = async () => {
    if (!user || generating) return

    // Validate key name
    const { validateKeyName, generateApiKey: genKey, hashApiKey } = await import('../lib/api-key')
    const nameResult = validateKeyName(newKeyName)
    if (!nameResult.valid) {
      toast.error(nameResult.error!)
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
        toast.error('키 생성에 실패했습니다: ' + error.message)
        return
      }

      const data = { key, name, createdAt: new Date().toISOString() }
      setApiKeyData(data)
      localStorage.setItem('reeeeecall-api-key-data', JSON.stringify(data))
      setShowApiKey(true)
      setShowKeyForm(false)
      setNewKeyName('')
      toast.success('API 키가 생성되었습니다. 이 키는 다시 볼 수 없으니 복사해두세요!')
    } catch (err) {
      toast.error('키 생성 중 오류가 발생했습니다')
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
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">설정</h1>

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
              <div className="text-sm font-semibold text-gray-900">사용법 가이드</div>
              <div className="text-xs text-gray-500 mt-0.5">기능 설명, 학습 팁, 공유 방법</div>
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
              <div className="text-sm font-semibold text-gray-900">API 문서</div>
              <div className="text-xs text-gray-500 mt-0.5">API 엔드포인트, 인증, 사용 예시</div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
          </button>
        </div>

        {/* Profile */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
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
          </div>
        </section>

        {/* SRS Study Settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">SRS 학습</h2>
          <p className="text-sm text-gray-500 mb-4">SRS (간격 반복) 모드에서 한 세션에 추가되는 새 카드 수를 설정합니다</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              새 카드 한도
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
              <span className="text-sm text-gray-500">장</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              SRS 학습 시 복습 카드 외에 추가로 나오는 새 카드의 최대 수입니다. 복습 카드는 이 한도에 영향을 받지 않습니다.
            </p>
          </div>
        </section>

        {/* Answer Input Mode */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">답변 방식</h2>
          <p className="text-sm text-gray-500 mb-4">학습 중 답변을 선택하는 방식을 설정합니다</p>

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
              <div className="text-sm font-semibold text-gray-900">버튼</div>
              <div className="text-xs text-gray-500 mt-1">버튼을 눌러 답변 선택</div>
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
              <div className="text-sm font-semibold text-gray-900">스와이프</div>
              <div className="text-xs text-gray-500 mt-1">카드를 밀어서 답변 선택</div>
            </button>
          </div>

          {/* Direction settings (only in swipe mode) */}
          {inputSettings.mode === 'swipe' && (
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
                        value={inputSettings.directions[key]}
                        onChange={(e) => updateInputSettings({
                          ...inputSettings,
                          directions: { ...inputSettings.directions, [key]: e.target.value as SwipeAction },
                        })}
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
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">자동 TTS 읽기</h2>
          <p className="text-sm text-gray-500 mb-4">카드 뒤집기 시 TTS 설정된 필드를 자동으로 읽어줍니다</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-sm text-gray-700">자동 읽기 활성화</span>
          </label>
          <p className="text-xs text-gray-400 mt-3">
            TTS 언어는 카드 템플릿의 필드별 설정을 따릅니다. 재생 버튼은 자동 읽기와 관계없이 항상 표시됩니다.
          </p>
        </section>

        {/* API Key Management */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
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
                  onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateApiKey() }}
                />
                <button
                  onClick={handleGenerateApiKey}
                  disabled={generating}
                  className="px-4 py-2.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition cursor-pointer font-medium"
                >
                  {generating ? '생성 중...' : '생성'}
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
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Key size={18} className="text-gray-500" />
                  <span className="text-base font-semibold text-gray-900">{apiKeyData.name}</span>
                </div>
                <button
                  onClick={revokeApiKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer"
                  title="삭제"
                >
                  <Trash2 size={14} />
                  삭제
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
                    title={showApiKey ? '숨기기' : '보기'}
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <CopyButton text={apiKeyData.key} />
                </div>
              ) : (
                <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400 font-mono mb-3">
                  rc_{'\u2022'.repeat(32)}
                  <span className="ml-2 text-xs text-gray-400 font-sans">(보안상 다시 볼 수 없습니다)</span>
                </div>
              )}

              {/* Dates */}
              <div className="space-y-0.5">
                <p className="text-sm text-gray-400">
                  생성일: {formatLocalDateTime(apiKeyData.createdAt)}
                </p>
              </div>
            </div>
          )}

          {!apiKeyData && !showKeyForm && (
            <div className="text-center py-6 text-sm text-gray-400">
              생성된 API 키가 없습니다.
            </div>
          )}
        </section>

        {/* Logout */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
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

        {/* Save button — always at the very bottom */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
        >
          {saving ? '저장 중...' : '설정 저장'}
        </button>
      </div>
    </div>
  )
}
