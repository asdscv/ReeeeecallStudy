import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.substring(1))
      const errorCode = params.get('error_code')
      const errorDesc = params.get('error_description')

      if (errorCode) {
        const messages: Record<string, string> = {
          otp_expired: '링크가 만료되었습니다. 다시 시도해주세요.',
          access_denied: '접근이 거부되었습니다. 다시 시도해주세요.',
        }
        setError(messages[errorCode] || errorDesc?.replace(/\+/g, ' ') || '인증에 실패했습니다.')
        return
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/auth/reset-password', { replace: true })
      } else if (event === 'SIGNED_IN') {
        navigate('/', { replace: true })
      }
    })

    const timeout = setTimeout(() => {
      setError('처리 시간이 초과되었습니다. 다시 시도해주세요.')
    }, 10000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-900 font-medium mb-2">{error}</p>
          <button
            onClick={() => navigate('/auth/login', { replace: true })}
            className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            로그인 페이지로 돌아가기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-spin">⏳</div>
        <p className="text-gray-500">처리 중...</p>
      </div>
    </div>
  )
}
