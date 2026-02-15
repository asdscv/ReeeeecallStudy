import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth-store'

type Mode = 'login' | 'signup' | 'forgot'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const resetPassword = useAuthStore((s) => s.resetPassword)
  const navigate = useNavigate()

  const switchMode = (newMode: Mode) => {
    setMode(newMode)
    setError(null)
    setSuccessMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'forgot') {
      const { error } = await resetPassword(email)
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setSuccessMessage('비밀번호 재설정 링크를 이메일로 보냈습니다.')
      }
      return
    }

    if (mode === 'signup') {
      if (password.length < 6) {
        setError('비밀번호는 6자 이상이어야 합니다.')
        setLoading(false)
        return
      }
      const { error } = await signUp(email, password)
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setSuccessMessage('인증 메일을 보냈습니다. 메일의 링크를 클릭하면 가입이 완료됩니다.')
      }
      return
    }

    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      navigate('/', { replace: true })
    }
  }

  if (successMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="text-5xl mb-4">📧</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">이메일을 확인해주세요</h2>
            <p className="text-gray-500 mb-2">
              <span className="font-medium text-gray-700">{email}</span>
            </p>
            <p className="text-gray-500 mb-6">{successMessage}</p>
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              로그인 페이지로 돌아가기
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = { login: '로그인', signup: '회원가입', forgot: '비밀번호 찾기' }[mode]
  const submitLabel = { login: '로그인', signup: '회원가입', forgot: '재설정 링크 보내기' }[mode]
  const loadingLabel = { login: '로그인 중...', signup: '가입 중...', forgot: '보내는 중...' }[mode]

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <img src="/favicon.png" alt="" className="w-16 h-16 mx-auto mb-3" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-10 mx-auto" />
            <p className="text-gray-500 mt-3">{title}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
            />

            {mode !== 'forgot' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 (6자 이상)"
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
              />
            )}

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm text-gray-400 hover:text-blue-600 cursor-pointer"
                >
                  비밀번호를 잊으셨나요?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || (mode !== 'forgot' && !password)}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {loading ? loadingLabel : submitLabel}
            </button>
          </form>

          <div className="text-sm text-center mt-6 text-gray-500 space-y-1">
            {mode === 'forgot' ? (
              <button
                onClick={() => switchMode('login')}
                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
              >
                로그인으로 돌아가기
              </button>
            ) : (
              <p>
                {mode === 'signup' ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}{' '}
                <button
                  onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                  className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                >
                  {mode === 'signup' ? '로그인' : '회원가입'}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
