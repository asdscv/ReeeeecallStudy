import { useState } from 'react'
import { useAuthStore } from '../../stores/auth-store'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signInWithMagicLink(email)

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="text-5xl mb-4">📧</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">이메일을 확인해주세요</h2>
            <p className="text-gray-500 mb-6">
              <span className="font-medium text-gray-700">{email}</span>
              <br />로 로그인 링크를 보냈습니다.
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              다른 이메일로 다시 보내기
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <img src="/favicon.png" alt="" className="w-16 h-16 mx-auto mb-3" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-7 mx-auto" />
            <p className="text-gray-500 mt-3">이메일로 간편 로그인</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {loading ? '보내는 중...' : '로그인 링크 보내기'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-6">
            비밀번호 없이 이메일 링크로 안전하게 로그인합니다.
          </p>
        </div>
      </div>
    </div>
  )
}
